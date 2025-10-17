import path from "node:path";
import url from "node:url";
import { Worker } from "node:worker_threads";
import { createIndexes, createViews } from "@/database/actions.js";
import { type Database, getPonderMetaTable } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import { AggregateMetricsService } from "@/internal/metrics.js";
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
import { startClock } from "@/utils/timer.js";
import { isTable, isView, sql } from "drizzle-orm";
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
  common,
  namespaceBuild,
  schemaBuild,
  indexingBuild,
  crashRecoveryCheckpoint,
  database,
}: {
  common: Common;
  namespaceBuild: NamespaceBuild;
  schemaBuild: SchemaBuild;
  indexingBuild: IndexingBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  database: Database;
}) {
  const workerPath = path.join(__dirname, "isolatedWorker.js");

  // TODO(kyle) should the progress update be logged here?

  // TODO(kyle) isAllComplete
  let isAllReady = false;
  const callback = async () => {
    if (
      isAllReady === false &&
      indexingBuild.chains.every(
        (chain) => perChainWorkerInfo.get(chain.id)!.state !== "historical",
      )
    ) {
      isAllReady = true;

      common.logger.info({
        msg: "Completed backfill indexing across all chains",
        duration: backfillEndClock(),
      });

      let endClock = startClock();
      await createIndexes(database.adminQB, {
        statements: schemaBuild.statements,
      });

      if (schemaBuild.statements.indexes.sql.length > 0) {
        common.logger.info({
          msg: "Created database indexes",
          count: schemaBuild.statements.indexes.sql.length,
          duration: endClock(),
        });
      }

      if (namespaceBuild.viewsSchema !== undefined) {
        endClock = startClock();

        const tables = Object.values(schemaBuild.schema).filter(isTable);
        const views = Object.values(schemaBuild.schema).filter(isView);
        await createViews(database.adminQB, { tables, views, namespaceBuild });

        common.logger.info({
          msg: "Created database views",
          schema: namespaceBuild.viewsSchema,
          count: tables.length,
          duration: endClock(),
        });
      }

      await database.adminQB.wrap({ label: "update_ready" }, (db) =>
        db
          .update(getPonderMetaTable(namespaceBuild.schema))
          .set({ value: sql`jsonb_set(value, '{is_ready}', to_jsonb(1))` }),
      );

      common.logger.info({
        msg: "Started returning 200 responses",
        endpoint: "/ready",
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
          options: common.options,
          chainId: chain.id,
          namespaceBuild,
          crashRecoveryCheckpoint,
        } satisfies Parameters<typeof isolatedWorker>[0],
        resourceLimits: {
          maxOldGenerationSizeMb: 1024,
        },
      }),
      pwr,
    };

    const messageHandler = (message: any) => {
      switch (message.type) {
        case "ready": {
          workerInfo.state = "realtime";
          callback();
          break;
        }
        case "done": {
          workerInfo.state = "complete";
          callback();
          pwr.resolve();
          break;
        }
        case "error": {
          // const prevState = workerInfo.state;
          workerInfo.state = "failed";
          callback();
          // common.logger.error({
          //   msg: `Failed '${chain.name}' ${prevState} indexing.`,
          //   error: message.error,
          // });
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
        // common.logger.error({
        //   msg: error.message,
        // });
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

  const backfillEndClock = startClock();

  common.metrics = new AggregateMetricsService(
    Array.from(perChainWorkerInfo.values()).map(({ worker }) => worker),
  );

  common.shutdown.add(async () => {
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
