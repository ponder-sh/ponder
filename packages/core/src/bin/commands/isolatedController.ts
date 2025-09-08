import path from "node:path";
import url from "node:url";
import { Worker } from "node:worker_threads";
import { createIndexes, createViews } from "@/database/actions.js";
import { type Database, getPonderMetaTable } from "@/database/index.js";
import type { Logger } from "@/internal/logger.js";
import type { Shutdown } from "@/internal/shutdown.js";
import type {
  Chain,
  CrashRecoveryCheckpoint,
  IndexingBuild,
  NamespaceBuild,
  SchemaBuild,
} from "@/internal/types.js";
import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from "@/utils/promiseWithResolvers.js";
import { isTable, sql } from "drizzle-orm";
import type { CliOptions } from "../ponder.js";
import type { isolatedWorker } from "./isolatedWorker.js";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type WorkerState = "historical" | "realtime" | "complete" | "failed";

export interface WorkerInfo {
  state: WorkerState;
  chain: Chain;
  worker: Worker;
  messageHandler?: (message: any) => void;
  exitHandler?: (code: number) => void;
  errorHandler?: (error: Error) => void;
  pwr: PromiseWithResolvers<void>;
}

export const perChainWorkerInfo = new Map<number, WorkerInfo>();

export async function isolatedController({
  cliOptions,
  logger,
  shutdown,
  namespaceBuild,
  schemaBuild,
  indexingBuild,
  crashRecoveryCheckpoint,
  database,
}: {
  cliOptions: CliOptions;
  logger: Logger;
  shutdown: Shutdown;
  namespaceBuild: NamespaceBuild;
  schemaBuild: SchemaBuild;
  indexingBuild: IndexingBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  database: Database;
}) {
  const workerPath = path.join(__dirname, "isolatedWorker.js");

  let isAllReady = false;
  const callback = async () => {
    if (
      isAllReady === false &&
      indexingBuild.chains.every(
        (chain) => perChainWorkerInfo.get(chain.id)!.state !== "historical",
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

        logger.info({
          service: "app",
          msg: `Created ${tables.length} views in schema "${namespaceBuild.viewsSchema}"`,
        });
      }

      await database.adminQB.wrap({ label: "update_ready" }, (db) =>
        db
          .update(getPonderMetaTable(namespaceBuild.schema))
          .set({ value: sql`jsonb_set(value, '{is_ready}', to_jsonb(1))` }),
      );

      logger.info({
        service: "server",
        msg: "Started returning 200 responses from /ready endpoint",
      });
    }
  };

  const cleanupWorker = (chain: Chain) => {
    const workerInfo = perChainWorkerInfo.get(chain.id);
    if (workerInfo === undefined) return;

    if (workerInfo.messageHandler) {
      workerInfo.worker.off("message", workerInfo.messageHandler);
      workerInfo.messageHandler = undefined;
    }

    if (workerInfo.exitHandler) {
      workerInfo.worker.off("exit", workerInfo.exitHandler);
      workerInfo.exitHandler = undefined;
    }
  };

  const setupWorker = (chain: Chain) => {
    const pwr = promiseWithResolvers<void>();

    const workerInfo: WorkerInfo = {
      state: "historical",
      chain,
      worker: new Worker(workerPath, {
        workerData: {
          cliOptions,
          chainId: chain.id,
          namespaceBuild,
          crashRecoveryCheckpoint,
        } satisfies Parameters<typeof isolatedWorker>[0],
      }),
      pwr,
    };

    const messageHandler = (message: any) => {
      switch (message.type) {
        case "ready": {
          workerInfo.state = "realtime";
          callback();
          logger.info({
            service: "app",
            msg: `Completed '${chain.name}' historical indexing.`,
          });
          break;
        }
        case "done": {
          workerInfo.state = "complete";
          callback();
          logger.info({
            service: "app",
            msg: `Completed '${chain.name}' indexing.`,
          });
          pwr.resolve();
          break;
        }
        case "error": {
          const prevState = workerInfo.state;
          workerInfo.state = "failed";
          callback();
          logger.error({
            service: "app",
            msg: `Failed '${chain.name}' ${prevState} indexing.`,
            error: message.error,
          });
          pwr.reject(message.error);
        }
      }
    };

    const exitHandler = async (code: number) => {
      if (code !== 0) {
        const prevState = workerInfo.state;
        workerInfo.state = "failed";
        callback();
        const error = new Error(
          `Failed '${chain.name}' ${prevState} indexing with exit code ${code}.`,
        );
        logger.error({
          service: "app",
          msg: error.message,
        });
        pwr.reject(error);
      }
    };

    workerInfo.messageHandler = messageHandler;
    workerInfo.exitHandler = exitHandler;

    workerInfo.worker.on("message", messageHandler);
    workerInfo.worker.on("exit", exitHandler);

    return workerInfo;
  };

  for (const chain of indexingBuild.chains) {
    perChainWorkerInfo.set(chain.id, setupWorker(chain));
  }

  // TODO(kyle) metrics
  // common.metrics.toAggregate(appState);
  // common.metrics.addListeners();

  shutdown.add(async () => {
    for (const { pwr } of perChainWorkerInfo.values()) {
      pwr.resolve();
    }
  });

  Promise.allSettled(
    Array.from(perChainWorkerInfo.values()).map(
      async ({ pwr, chain, worker }) => {
        return pwr.promise.finally(() => {
          cleanupWorker(chain);
          worker.postMessage({ type: "kill" });
        });
      },
    ),
  );
}
