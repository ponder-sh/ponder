import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { Cause, Effect, Exit, Fiber, Layer } from "effect";
import { createBuild } from "@/build/index.js";
import { Db, makeDb } from "@/database/db.js";
import { layerLogger } from "@/internal/logger.js";
import { IsolatedMetricsService, Metrics } from "@/internal/metrics.js";
import { Options } from "@/internal/options.js";
import type {
  CrashRecoveryCheckpoint,
  LightBlock,
  NamespaceBuild,
} from "@/internal/types.js";
import { runIsolated } from "@/runtime/isolated.js";

export type IsolatedWorkerData = {
  options: Options["Service"];
  namespaceBuild: NamespaceBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  chainIds: number[];
  /**
   * The finalized block of each chain in `chainIds`, which the main thread
   * checked against the previous app.
   */
  finalizedBlocks: LightBlock[];
};

/** Messages from a worker thread to the main thread. */
export type IsolatedWorkerMessage =
  | { type: "ready"; chainId: number }
  /** A chain completed, or, without `chainId`, every chain completed. */
  | { type: "done"; chainId?: number }
  | { type: "error"; error: { name: string; message: string; stack?: string } };

const postMessage = (message: IsolatedWorkerMessage) =>
  parentPort!.postMessage(message);

/**
 * Build the app again in the worker thread, and run each chain of `chainIds`
 * with isolated ordering.
 */
export const isolatedWorker = ({
  namespaceBuild,
  crashRecoveryCheckpoint,
  chainIds,
  finalizedBlocks,
}: IsolatedWorkerData) =>
  Effect.gen(function* () {
    const options = yield* Options;
    const metrics = yield* Metrics;

    const build = yield* createBuild({
      cliOptions: {
        schema: namespaceBuild.schema,
        viewsSchema: namespaceBuild.viewsSchema,
      },
    });

    // Note: build is guaranteed to be successful because the main thread
    // has already run the build.

    // Note: `namespaceCompile`
    globalThis.PONDER_NAMESPACE_BUILD = namespaceBuild;

    const configResult = yield* build.executeConfig;
    const schemaResult = yield* build.executeSchema;
    const preBuild = yield* build.preCompile(configResult);
    const schemaBuild = yield* build.compileSchema({
      ...schemaResult,
      preBuild,
    });
    const configBuild = yield* build.compileConfig({ configResult });
    const indexingResult = yield* build.executeIndexingFunctions;
    const indexingBuild = yield* build.compileIndexing({
      configResult,
      schemaResult,
      indexingResult,
      configBuild,
    });

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

    const db = yield* makeDb({
      namespace: namespaceBuild,
      preBuild,
      schemaBuild,
    });

    yield* Effect.forEach(
      chainIds,
      (chainId) =>
        Effect.gen(function* () {
          const chainIndex = indexingBuild.chains.findIndex(
            (c) => c.id === chainId,
          );

          const chainIndexingBuild = {
            ...indexingBuild,
            chains: [indexingBuild.chains[chainIndex]!],
            rpcs: [indexingBuild.rpcs[chainIndex]!],
            finalizedBlocks: [finalizedBlocks[chainIds.indexOf(chainId)]!],
            eventCallbacks: [indexingBuild.eventCallbacks[chainIndex]!],
            setupCallbacks: [indexingBuild.setupCallbacks[chainIndex]!],
            contracts: [indexingBuild.contracts[chainIndex]!],
          };

          metrics.initializeIndexingMetrics({
            indexingBuild: chainIndexingBuild,
            schemaBuild,
          });

          yield* runIsolated({
            preBuild,
            namespaceBuild,
            schemaBuild,
            indexingBuild: chainIndexingBuild,
            crashRecoveryCheckpoint,
            onReady: Effect.sync(() => postMessage({ type: "ready", chainId })),
          });

          postMessage({ type: "done", chainId });
        }),
      { concurrency: "unbounded", discard: true },
    ).pipe(
      Effect.provideService(Db, db),
      Effect.provideService(Options, isolatedOptions),
    );
  });

if (isMainThread) {
  throw new Error("'isolatedWorker.ts' must be run in a worker thread");
}

const data = workerData as IsolatedWorkerData;

const services = Layer.mergeAll(
  Layer.succeed(Options, data.options),
  Layer.succeed(Metrics, new IsolatedMetricsService()),
  layerLogger({ level: data.options.logLevel, mode: data.options.logFormat }),
);

const fiber = Effect.runFork(
  Effect.scoped(isolatedWorker(data)).pipe(Effect.provide(services)),
);

// Note: The main thread kills the worker thread when it shuts down.
parentPort!.on("message", (message: { type: string }) => {
  if (message.type === "kill") Effect.runFork(Fiber.interrupt(fiber));
});

fiber.addObserver((exit) => {
  if (Exit.isSuccess(exit)) {
    postMessage({ type: "done" });
    return;
  }

  if (Cause.hasInterruptsOnly(exit.cause)) return;

  const error = Cause.squash(exit.cause) as Error;
  postMessage({
    type: "error",
    error: { name: error.name, message: error.message, stack: error.stack },
  });
});
