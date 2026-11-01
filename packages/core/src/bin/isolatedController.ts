import path from "node:path";
import url from "node:url";
import v8 from "node:v8";
import { Worker } from "node:worker_threads";
import { isTable, isView, sql } from "drizzle-orm";
import {
  Cause,
  Deferred,
  Effect,
  Fiber,
  Queue,
  type Scope,
  Stream,
} from "effect";
import { createIndexes, createViews } from "@/database/actions.js";
import { Db } from "@/database/db.js";
import { getPonderMetaTable } from "@/database/index.js";
import {
  NonRetryableUserError,
  nonRetryableUserErrorNames,
} from "@/internal/errors.js";
import { Metrics } from "@/internal/metrics.js";
import { Options } from "@/internal/options.js";
import type {
  CrashRecoveryCheckpoint,
  IndexingBuild,
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
} from "@/internal/types.js";
import { logBackfillProgress } from "@/runtime/index.js";
import { runIsolated } from "@/runtime/isolated.js";
import { chunk } from "@/utils/chunk.js";
import { startClockEffect } from "@/utils/timer.js";
import type {
  IsolatedWorkerData,
  IsolatedWorkerMessage,
} from "./isolatedWorker.js";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type WorkerState = "backfill" | "live" | "complete";

/**
 * Run each chain with isolated ordering, in this thread or in worker threads.
 * Once every chain completes its backfill, create the indexes and views, and
 * start returning 200 responses from `/ready`.
 */
export const isolatedController = ({
  preBuild,
  namespaceBuild,
  schemaBuild,
  indexingBuild,
  crashRecoveryCheckpoint,
}: {
  preBuild: PreBuild;
  namespaceBuild: NamespaceBuild;
  schemaBuild: SchemaBuild;
  indexingBuild: IndexingBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
}): Effect.Effect<void, Error, Db | Options | Metrics | Scope.Scope> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const options = yield* Options;
    const metrics = yield* Metrics;

    const backfillEndClock = yield* startClockEffect;
    const perChainState = new Map<number, WorkerState>();
    const isReady = yield* Deferred.make<void>();

    for (const chain of indexingBuild.chains) {
      perChainState.set(chain.id, "backfill");
    }

    const setChainState = (chainId: number, state: WorkerState) =>
      Effect.gen(function* () {
        perChainState.set(chainId, state);

        if (
          indexingBuild.chains.every(
            (chain) => perChainState.get(chain.id) !== "backfill",
          )
        ) {
          yield* Deferred.succeed(isReady, undefined);
        }
      });

    const etaFiber = yield* Effect.forkScoped(logBackfillProgress);

    /** Wait for the backfill of every chain, then create the indexes and views. */
    const ready = Effect.gen(function* () {
      yield* Deferred.await(isReady);

      yield* Effect.logInfo({
        msg: "Completed backfill indexing across all chains",
        duration: yield* backfillEndClock,
      });
      yield* Fiber.interrupt(etaFiber);

      let endClock = yield* startClockEffect;
      yield* createIndexes(db.admin, { statements: schemaBuild.statements });

      if (schemaBuild.statements.indexes.sql.length > 0) {
        yield* Effect.logInfo({
          msg: "Created database indexes",
          count: schemaBuild.statements.indexes.sql.length,
          duration: yield* endClock,
        });
      }

      if (namespaceBuild.viewsSchema !== undefined) {
        endClock = yield* startClockEffect;

        const tables = Object.values(schemaBuild.schema).filter(isTable);
        const views = Object.values(schemaBuild.schema).filter(isView);
        yield* createViews(db.admin, { tables, views, namespaceBuild });

        yield* Effect.logInfo({
          msg: "Created database views",
          schema: namespaceBuild.viewsSchema,
          count: tables.length,
          duration: yield* endClock,
        });
      }

      yield* db.admin.query(
        (db) =>
          db
            .update(getPonderMetaTable(namespaceBuild.schema))
            .set({ value: sql`jsonb_set(value, '{is_ready}', to_jsonb(1))` }),
        { label: "update_ready" },
      );

      yield* Effect.logInfo({
        msg: "Started returning 200 responses",
        endpoint: "/ready",
      });
    });

    let chains: Effect.Effect<
      void,
      Error,
      Db | Options | Metrics | Scope.Scope
    >;

    if (
      options.command === "dev" ||
      indexingBuild.chains.length === 1 ||
      db.dialect === "pglite" ||
      options.maxThreads === 1
    ) {
      const isolatedOptions = {
        ...options,
        indexingCacheMaxBytes: Math.floor(
          options.indexingCacheMaxBytes / indexingBuild.chains.length,
        ),
        rpcMaxConcurrency: Math.floor(
          options.rpcMaxConcurrency / indexingBuild.chains.length,
        ),
        syncEventsQuerySize: Math.floor(
          options.syncEventsQuerySize / indexingBuild.chains.length,
        ),
      };

      chains = Effect.forEach(
        indexingBuild.chains,
        (chain) =>
          Effect.gen(function* () {
            yield* runIsolated({
              preBuild,
              namespaceBuild,
              schemaBuild,
              indexingBuild: getChainIndexingBuild(indexingBuild, chain.id),
              crashRecoveryCheckpoint,
              onReady: setChainState(chain.id, "live"),
            });

            yield* setChainState(chain.id, "complete");
          }),
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.provideService(Options, isolatedOptions));
    } else {
      const workerPath = path.join(__dirname, "isolatedWorker.js");

      const perThreadChains = chunk(
        indexingBuild.chains,
        Math.ceil(indexingBuild.chains.length / options.maxThreads),
      );

      const workers = yield* Effect.forEach(perThreadChains, (chains) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            // Note: This is a hack to force color support in the worker threads
            if (process.stdout.isTTY) {
              process.env.FORCE_COLOR = "1";
            }

            const heapSizeLimit = v8.getHeapStatistics().heap_size_limit;
            const perThreadHeapSizeLimit = Math.floor(
              heapSizeLimit / (options.maxThreads + 1) / 1024 / 1024,
            );

            // Note: This sets `--max-old-space-size` for the worker thread.
            // `resourceLimits` does not work because it gets overridden by
            // CLI flags or environment variables. It does not change the heap
            // size limit for the current main thread
            v8.setFlagsFromString(
              `--max-old-space-size=${perThreadHeapSizeLimit}`,
            );

            return new Worker(workerPath, {
              workerData: {
                options,
                chainIds: chains.map((chain) => chain.id),
                finalizedBlocks: chains.map(
                  (chain) =>
                    indexingBuild.finalizedBlocks[
                      indexingBuild.chains.indexOf(chain)
                    ]!,
                ),
                namespaceBuild,
                crashRecoveryCheckpoint,
              } satisfies IsolatedWorkerData,
            });
          }),
          (worker) => Effect.sync(() => worker.postMessage({ type: "kill" })),
        ),
      );

      yield* Effect.logDebug({
        msg: "Created worker threads",
        count: workers.length,
        duration: yield* backfillEndClock,
      });

      metrics.aggregateWorkerMetrics(workers);

      chains = Effect.forEach(
        workers,
        (worker) =>
          getWorkerMessages(worker).pipe(
            Stream.runForEach((message) => {
              switch (message.type) {
                case "ready":
                  return setChainState(message.chainId, "live");
                case "done":
                  return message.chainId === undefined
                    ? Effect.void
                    : setChainState(message.chainId, "complete");
              }
            }),
          ),
        { concurrency: "unbounded", discard: true },
      );
    }

    yield* Effect.all([ready, chains], {
      concurrency: "unbounded",
      discard: true,
    });
  });

/** Returns the indexing build of one chain. */
const getChainIndexingBuild = (
  indexingBuild: IndexingBuild,
  chainId: number,
): IndexingBuild => {
  const chainIndex = indexingBuild.chains.findIndex((c) => c.id === chainId);

  return {
    ...indexingBuild,
    chains: [indexingBuild.chains[chainIndex]!],
    rpcs: [indexingBuild.rpcs[chainIndex]!],
    finalizedBlocks: [indexingBuild.finalizedBlocks[chainIndex]!],
    eventCallbacks: [indexingBuild.eventCallbacks[chainIndex]!],
    setupCallbacks: [indexingBuild.setupCallbacks[chainIndex]!],
    contracts: [indexingBuild.contracts[chainIndex]!],
  };
};

/**
 * Stream the state messages of a worker thread. Fails when the worker thread
 * fails or exits.
 */
const getWorkerMessages = (worker: Worker) =>
  Stream.callback<Exclude<IsolatedWorkerMessage, { type: "error" }>, Error>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const onMessage = (message: IsolatedWorkerMessage) => {
            switch (message.type) {
              case "ready":
              case "done":
                Queue.offerUnsafe(queue, message);
                break;
              case "error": {
                const error = toWorkerError(message.error);
                error.stack = message.error.stack;
                Queue.failCauseUnsafe(queue, Cause.fail(error));
                break;
              }
            }
          };
          const onError = (error: Error) => {
            Queue.failCauseUnsafe(queue, Cause.fail(toWorkerError(error)));
          };
          const onExit = (code: number) => {
            const error = new Error(`Worker thread exited with code ${code}.`);
            error.stack = undefined;
            Queue.failCauseUnsafe(queue, Cause.fail(error));
          };

          worker.on("message", onMessage);
          worker.on("error", onError);
          worker.on("exit", onExit);

          return { onMessage, onError, onExit };
        }),
        ({ onMessage, onError, onExit }) =>
          Effect.sync(() => {
            worker.off("message", onMessage);
            worker.off("error", onError);
            worker.off("exit", onExit);
          }),
      ),
  );

/** Returns the error of a worker thread, with the class of a user error. */
const toWorkerError = (error: { name: string; message: string }) => {
  const workerError = nonRetryableUserErrorNames.includes(error.name)
    ? new NonRetryableUserError(error.message)
    : new Error(error.message);
  workerError.name = error.name;
  return workerError;
};
