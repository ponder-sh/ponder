import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { createIndexes, createViews } from "@/database/actions.js";
import { getPonderMetaTable } from "@/database/index.js";
import type { Chain } from "@/internal/types.js";
import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
import { isTable, sql } from "drizzle-orm";
import type { PonderApp } from "../commands/start.js";
import type { CliOptions } from "../ponder.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type WorkerState = "historical" | "realtime" | "complete" | "failed";

export interface WorkerInfo {
  state: WorkerState;
  chain: Chain;
  worker: Worker;
  retryCount: number;
  timeout?: NodeJS.Timeout;
  messageHandler?: (message: any) => void;
  exitHandler?: (code: number) => void;
  errorHandler?: (error: Error) => void;
  promise: Promise<void>;
}

export async function startIsolated(
  {
    common,
    namespaceBuild,
    schemaBuild,
    indexingBuild,
    crashRecoveryCheckpoint,
    database,
  }: PonderApp,
  cliOptions: CliOptions,
) {
  const appState: { [chainName: string]: WorkerInfo } = {};
  const workerPath = join(__dirname, "..", "..", "runtime", "isolated.js");

  let isAllReady = false;
  const callback = async () => {
    if (
      isAllReady === false &&
      indexingBuild.chains.every(
        (chain) => appState[chain.name]!.state !== "historical",
      )
    ) {
      isAllReady = true;
      await createIndexes(database.adminQB, {
        statements: schemaBuild.statements,
      });

      if (namespaceBuild.viewsSchema !== undefined) {
        const tables = Object.values(schemaBuild.schema).filter(isTable);
        await createViews(database.adminQB, {
          tables,
          namespaceBuild,
        });

        common.logger.info({
          service: "app",
          msg: `Created ${tables.length} views in schema "${namespaceBuild.viewsSchema}"`,
        });
      }

      await database.adminQB.wrap({ label: "update_ready" }, (db) =>
        db
          .update(getPonderMetaTable(namespaceBuild.schema))
          .set({ value: sql`jsonb_set(value, '{is_ready}', to_jsonb(1))` }),
      );

      common.logger.info({
        service: "server",
        msg: "Started returning 200 responses from /ready endpoint",
      });
    }
  };

  const cleanupWorker = (chainName: string) => {
    const workerInfo = appState[chainName];
    if (!workerInfo) return;

    if (workerInfo.timeout) {
      clearTimeout(workerInfo.timeout);
      workerInfo.timeout = undefined;
    }

    if (workerInfo.messageHandler) {
      workerInfo.worker.off("message", workerInfo.messageHandler);
      workerInfo.messageHandler = undefined;
    }

    if (workerInfo.exitHandler) {
      workerInfo.worker.off("exit", workerInfo.exitHandler);
      workerInfo.exitHandler = undefined;
    }

    workerInfo.worker.terminate();
  };

  const setupWorker = (chain: Chain) => {
    const pwr = promiseWithResolvers<void>();

    const workerInfo: WorkerInfo = {
      state: "historical",
      chain,
      worker: new Worker(workerPath, {
        workerData: {
          cliOptions,
          crashRecoveryCheckpoint,
          chainId: chain.id,
        },
      }),
      retryCount: 0,
      promise: pwr.promise,
    };

    const messageHandler = (message: any) => {
      switch (message.type) {
        case "ready": {
          workerInfo.state = "realtime";
          if (workerInfo.timeout) {
            clearTimeout(workerInfo.timeout);
            workerInfo.timeout = undefined;
          }
          break;
        }
      }
      callback();
    };

    const exitHandler = async (code: number) => {
      if (code === 0) {
        workerInfo.state = "complete";
        if (workerInfo.timeout) {
          clearTimeout(workerInfo.timeout);
          workerInfo.timeout = undefined;
        }
        pwr.resolve();
      } else {
        workerInfo.state = "failed";

        const error = new Error(
          `Chain '${chain.name}' exited with code ${code}.`,
        );

        common.logger.error({
          service: "app",
          msg: error.message,
        });
        pwr.reject(error);
      }

      callback();
    };

    workerInfo.messageHandler = messageHandler;
    workerInfo.exitHandler = exitHandler;

    workerInfo.worker.on("message", messageHandler);
    workerInfo.worker.on("exit", exitHandler);

    return workerInfo;
  };

  for (const chain of indexingBuild.chains) {
    appState[chain.name] = setupWorker(chain);
  }

  common.metrics.toAggregate(appState);
  common.metrics.addListeners();

  Promise.allSettled(
    Object.values(appState).map(async ({ promise, chain }) => {
      return promise.finally(() => {
        cleanupWorker(chain.name);
      });
    }),
  );
}
