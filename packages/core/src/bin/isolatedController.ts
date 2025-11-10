import path from "node:path";
import url from "node:url";
import v8 from "node:v8";
import { Worker } from "node:worker_threads";
import { createIndexes, createViews } from "@/database/actions.js";
import { type Database, getPonderMetaTable } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import {
  NonRetryableUserError,
  nonRetryableUserErrorNames,
} from "@/internal/errors.js";
import { AggregateMetricsService, getAppProgress } from "@/internal/metrics.js";
import type {
  CrashRecoveryCheckpoint,
  IndexingBuild,
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
} from "@/internal/types.js";
import { runIsolated } from "@/runtime/isolated.js";
import { chunk } from "@/utils/chunk.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import { startClock } from "@/utils/timer.js";
import { isTable, isView, sql } from "drizzle-orm";
import type { isolatedWorker } from "./isolatedWorker.js";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type WorkerState = "backfill" | "live" | "complete";

export async function isolatedController({
  common,
  preBuild,
  namespaceBuild,
  schemaBuild,
  indexingBuild,
  crashRecoveryCheckpoint,
  database,
}: {
  common: Common;
  preBuild: PreBuild;
  namespaceBuild: NamespaceBuild;
  schemaBuild: SchemaBuild;
  indexingBuild: IndexingBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  database: Database;
}) {
  const backfillEndClock = startClock();
  const perChainState = new Map<number, WorkerState>();

  const etaInterval = setInterval(async () => {
    const { eta, progress } = await getAppProgress(common.metrics);

    if (eta === undefined && progress === undefined) {
      return;
    }

    common.logger.info({
      msg: "Updated backfill indexing progress",
      progress: progress === undefined ? undefined : formatPercentage(progress),
      estimate: eta === undefined ? undefined : formatEta(eta * 1_000),
    });
  }, 5_000);

  common.shutdown.add(() => {
    clearInterval(etaInterval);
  });

  let isAllReady = false;
  let isAllComplete = false;
  const callback = async () => {
    if (
      isAllReady === false &&
      indexingBuild.chains.every(
        (chain) => perChainState.get(chain.id) !== "backfill",
      )
    ) {
      isAllReady = true;

      common.logger.info({
        msg: "Completed backfill indexing across all chains",
        duration: backfillEndClock(),
      });
      clearInterval(etaInterval);

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

        endClock = startClock();
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

    if (
      isAllComplete === false &&
      indexingBuild.chains.every(
        (chain) => perChainState.get(chain.id) === "complete",
      )
    ) {
      isAllComplete = true;
    }
  };

  if (
    common.options.command === "dev" ||
    indexingBuild.chains.length === 1 ||
    database.driver.dialect === "pglite" ||
    common.options.maxThreads === 1
  ) {
    common.options.indexingCacheMaxBytes = Math.floor(
      common.options.indexingCacheMaxBytes / indexingBuild.chains.length,
    );
    common.options.rpcMaxConcurrency = Math.floor(
      common.options.rpcMaxConcurrency / indexingBuild.chains.length,
    );
    common.options.syncEventsQuerySize = Math.floor(
      common.options.syncEventsQuerySize / indexingBuild.chains.length,
    );

    await Promise.all(
      indexingBuild.chains.map(async (chain) => {
        const chainIndex = indexingBuild.chains.findIndex(
          (c) => c.id === chain.id,
        );
        const _indexingBuild = {
          ...indexingBuild,
          chains: [indexingBuild.chains[chainIndex]!],
          rpcs: [indexingBuild.rpcs[chainIndex]!],
          finalizedBlocks: [indexingBuild.finalizedBlocks[chainIndex]!],
          eventCallbacks: [indexingBuild.eventCallbacks[chainIndex]!],
          setupCallbacks: [indexingBuild.setupCallbacks[chainIndex]!],
          contracts: [indexingBuild.contracts[chainIndex]!],
        };

        perChainState.set(chain.id, "backfill");

        await runIsolated({
          common,
          preBuild,
          namespaceBuild,
          schemaBuild,
          indexingBuild: _indexingBuild,
          crashRecoveryCheckpoint,
          database,
          onReady: () => {
            perChainState.set(chain.id, "live");
            callback();
          },
        });

        perChainState.set(chain.id, "complete");
        callback();
      }),
    );
  } else {
    const workerPath = path.join(__dirname, "isolatedWorker.js");

    const perThreadChains = chunk(
      indexingBuild.chains,
      Math.ceil(indexingBuild.chains.length / common.options.maxThreads),
    );

    const perThreadWorkers: Worker[] = [];
    for (const chains of perThreadChains) {
      const chainIds = chains.map((chain) => chain.id);

      // Note: This is a hack to force color support in the worker threads
      if (process.stdout.isTTY) {
        process.env.FORCE_COLOR = "1";
      }

      const heapSizeLimit = v8.getHeapStatistics().heap_size_limit;
      const perThreadHeapSizeLimit = Math.floor(
        heapSizeLimit / (common.options.maxThreads + 1) / 1024 / 1024,
      );

      // Note: This sets `--max-old-space-size` for the worker thread.
      // `resourceLimits` does not work because it gets overridden by
      // CLI flags or environment variables. It does not change the heap
      // size limit for the current main thread
      v8.setFlagsFromString(`--max-old-space-size=${perThreadHeapSizeLimit}`);

      const worker = new Worker(workerPath, {
        workerData: {
          options: common.options,
          chainIds,
          namespaceBuild,
          crashRecoveryCheckpoint,
        } satisfies Parameters<typeof isolatedWorker>[0],
      });

      for (const chainId of chainIds) {
        perChainState.set(chainId, "backfill");
      }

      worker.on(
        "message",
        (
          message:
            | { type: "ready"; chainId: number }
            | { type: "done"; chainId: number }
            | { type: "error"; error: Error },
        ) => {
          switch (message.type) {
            case "ready": {
              perChainState.set(message.chainId, "live");
              callback();
              break;
            }
            case "done": {
              perChainState.set(message.chainId, "complete");
              callback();
              break;
            }
            case "error": {
              let error: Error;
              if (nonRetryableUserErrorNames.includes(message.error.name)) {
                error = new NonRetryableUserError(message.error.message);
              } else {
                error = new Error(message.error.message);
              }
              error.name = message.error.name;
              error.stack = message.error.stack;
              throw error;
            }
          }
        },
      );

      worker.on("error", (error: Error) => {
        if (nonRetryableUserErrorNames.includes(error.name)) {
          error = new NonRetryableUserError(error.message);
        } else {
          error = new Error(error.message);
        }
        throw error;
      });

      worker.on("exit", (code: number) => {
        const error = new Error(`Worker thread exited with code ${code}.`);
        error.stack = undefined;
        throw error;
      });

      perThreadWorkers.push(worker);
    }

    common.logger.debug({
      msg: "Created worker threads",
      count: perThreadWorkers.length,
      duration: backfillEndClock(),
    });

    common.metrics = new AggregateMetricsService(
      common.metrics,
      perThreadWorkers,
    );

    common.shutdown.add(() => {
      for (const worker of perThreadWorkers) {
        worker.postMessage({ type: "kill" });
      }
    });
  }
}
