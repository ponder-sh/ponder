import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { createIndexes, createViews } from "@/database/actions.js";
import { getPonderMetaTable } from "@/database/index.js";
import { AggregatorMetricsService } from "@/internal/metrics.js";
import type { Chain } from "@/internal/types.js";
import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from "@/utils/promiseWithResolvers.js";
import { wait } from "@/utils/wait.js";
import { isTable, sql } from "drizzle-orm";
import type { PonderApp } from "../commands/start.js";
import type { CliOptions } from "../ponder.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type WorkerState =
  | "historical"
  | "realtime"
  | "complete"
  | "degraded"
  | "failed";

interface WorkerInfo {
  state: WorkerState;
  chain: Chain;
  worker: Worker;
  retryCount: number;
  timeout?: NodeJS.Timeout;
  messageHandler?: (message: any) => void;
  exitHandler?: (code: number) => void;
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
        (chain) =>
          appState[chain.name]!.state !== "historical" &&
          appState[chain.name]!.state !== "degraded",
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

  indexingBuild.chains.forEach((chain) => {
    appState[chain.name] = {
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
    };
  });

  common.metrics = new AggregatorMetricsService(appState);
  common.metrics.addListeners();

  const RETRY_COUNT = 9;
  const BASE_DURATION = 10_000;
  const TIMEOUT_DURATION = 30_000;

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
  };

  const createWorker = (chainName: string): Worker => {
    const workerInfo = appState[chainName]!;

    return new Worker(workerPath, {
      workerData: {
        cliOptions,
        crashRecoveryCheckpoint,
        chainId: workerInfo.chain.id,
      },
    });
  };

  const setupWorkerHandlers = (
    chainName: string,
    worker: Worker,
    pwr: PromiseWithResolvers<void>,
  ) => {
    const workerInfo = appState[chainName];
    if (!workerInfo) return;

    cleanupWorker(chainName);

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
        case "complete": {
          workerInfo.state = "complete";
          if (workerInfo.timeout) {
            clearTimeout(workerInfo.timeout);
            workerInfo.timeout = undefined;
          }
          pwr.resolve();
          break;
        }
      }
      callback();
    };

    const exitHandler = async (code: number) => {
      if (code === 75) {
        workerInfo.state = "degraded";

        if (workerInfo.retryCount >= RETRY_COUNT) {
          const error = new Error(
            `Chain '${chainName}' exited with code ${code} after ${workerInfo.retryCount + 1} consecutive retries.`,
          );

          common.logger.error({
            service: "app",
            msg: error.message,
          });

          workerInfo.state = "failed";
          pwr.reject(error);
        } else {
          const duration = BASE_DURATION * 2 ** workerInfo.retryCount;
          common.logger.warn({
            service: "app",
            msg: `Chain '${chainName}' exited with code ${code}, retrying after ${duration / 1_000} seconds.`,
          });

          await wait(duration);

          const newWorker = createWorker(chainName);
          workerInfo.worker = newWorker;
          workerInfo.retryCount++;

          workerInfo.timeout = setTimeout(() => {
            if (workerInfo.state === "degraded") {
              workerInfo.state = "historical";
            }
          }, TIMEOUT_DURATION);

          setupWorkerHandlers(chainName, newWorker, pwr);
        }
      } else if (code !== 0) {
        const error = new Error(
          `Chain '${chainName}' exited with code ${code}.`,
        );

        common.logger.error({
          service: "app",
          msg: error.message,
        });

        workerInfo.state = "failed";
        pwr.reject(error);
      }
      callback();
    };

    workerInfo.messageHandler = messageHandler;
    workerInfo.exitHandler = exitHandler;

    worker.on("message", messageHandler);
    worker.on("exit", exitHandler);
  };

  Promise.allSettled(
    Object.keys(appState).map(async (chainName) => {
      const pwr = promiseWithResolvers<void>();
      const workerInfo = appState[chainName]!;

      setupWorkerHandlers(chainName, workerInfo.worker, pwr);

      return pwr.promise.finally(() => {
        cleanupWorker(chainName);
        appState[chainName]!.worker.terminate();
      });
    }),
  );
}
