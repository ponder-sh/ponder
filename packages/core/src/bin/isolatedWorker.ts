import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { createBuild } from "@/build/index.js";
import { createDatabase } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import { createLogger } from "@/internal/logger.js";
import { IsolatedMetricsService } from "@/internal/metrics.js";
import { createShutdown } from "@/internal/shutdown.js";
import { createTelemetry } from "@/internal/telemetry.js";
import type {
  CrashRecoveryCheckpoint,
  NamespaceBuild,
} from "@/internal/types.js";
import { runIsolated } from "@/runtime/isolated.js";

if (isMainThread) {
  throw new Error("'isolatedWorker.ts' must be run in a worker thread");
}

try {
  await isolatedWorker(workerData);

  parentPort!.postMessage({ type: "done" });
} catch (err) {
  const error = err as Error;

  parentPort!.postMessage({
    type: "error",
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
  });
}

export async function isolatedWorker({
  options,
  namespaceBuild,
  crashRecoveryCheckpoint,
  chainIds,
}: {
  options: Common["options"];
  namespaceBuild: NamespaceBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  chainIds: number[];
}) {
  // Note: telemetry is disabled because the main thread will report telemetry
  options.telemetryDisabled = true;

  const logger = createLogger({
    level: options.logLevel,
    mode: options.logFormat,
  });

  const metrics = new IsolatedMetricsService();
  const shutdown = createShutdown();
  const telemetry = createTelemetry({ options, logger, shutdown });
  const common = {
    options,
    logger,
    metrics,
    telemetry,
    shutdown,
    buildShutdown: shutdown,
    apiShutdown: shutdown,
  };

  let isKilled = false;
  parentPort!.on("message", async (msg) => {
    if (msg.type === "kill") {
      if (isKilled) return;
      isKilled = true;
      await shutdown.kill();
    }
  });

  const build = await createBuild({
    common,
    cliOptions: workerData.cliOptions,
  });

  // Note: build is guaranteed to be successful because the main thread
  // has already run the build.

  // Note: `namespaceCompile`
  globalThis.PONDER_NAMESPACE_BUILD = namespaceBuild;

  const configResult = await build.executeConfig();
  if (configResult.status === "error") {
    throw configResult.error;
  }

  const schemaResult = await build.executeSchema();
  if (schemaResult.status === "error") {
    throw schemaResult.error;
  }
  const preBuildResult = build.preCompile(configResult.result);
  if (preBuildResult.status === "error") {
    throw preBuildResult.error;
  }

  const schemaBuildResult = build.compileSchema({
    ...schemaResult.result,
    preBuild: preBuildResult.result,
  });
  if (schemaBuildResult.status === "error") {
    throw schemaBuildResult.error;
  }

  const configBuildResult = build.compileConfig({
    configResult: configResult.result,
  });
  if (configBuildResult.status === "error") {
    throw configBuildResult.error;
  }

  const indexingResult = await build.executeIndexingFunctions();
  if (indexingResult.status === "error") {
    throw indexingResult.error;
  }

  const indexingBuildResult = await build.compileIndexing({
    configResult: configResult.result,
    schemaResult: schemaResult.result,
    indexingResult: indexingResult.result,
    configBuild: configBuildResult.result,
  });
  if (indexingBuildResult.status === "error") {
    throw indexingBuildResult.error;
  }

  options.indexingCacheMaxBytes = Math.floor(
    options.indexingCacheMaxBytes / indexingBuildResult.result.chains.length,
  );
  options.rpcMaxConcurrency = Math.floor(
    options.rpcMaxConcurrency / indexingBuildResult.result.chains.length,
  );
  options.syncEventsQuerySize = Math.floor(
    options.syncEventsQuerySize / indexingBuildResult.result.chains.length,
  );

  const database = createDatabase({
    common,
    namespace: namespaceBuild,
    preBuild: preBuildResult.result,
    schemaBuild: schemaBuildResult.result,
  });

  await Promise.all(
    chainIds.map(async (chainId) => {
      const chainIndex = indexingBuildResult.result.chains.findIndex(
        (c) => c.id === chainId,
      );

      const indexingBuild = {
        ...indexingBuildResult.result,
        chains: [indexingBuildResult.result.chains[chainIndex]!],
        rpcs: [indexingBuildResult.result.rpcs[chainIndex]!],
        finalizedBlocks: [
          indexingBuildResult.result.finalizedBlocks[chainIndex]!,
        ],
        eventCallbacks: [
          indexingBuildResult.result.eventCallbacks[chainIndex]!,
        ],
        setupCallbacks: [
          indexingBuildResult.result.setupCallbacks[chainIndex]!,
        ],
        contracts: [indexingBuildResult.result.contracts[chainIndex]!],
      };

      common.metrics.initializeIndexingMetrics({
        indexingBuild,
        schemaBuild: schemaBuildResult.result,
      });

      await runIsolated({
        common,
        preBuild: preBuildResult.result,
        namespaceBuild,
        schemaBuild: schemaBuildResult.result,
        indexingBuild,
        crashRecoveryCheckpoint,
        database,
        onReady: () => {
          parentPort!.postMessage({ type: "ready", chainId });
        },
      });

      parentPort!.postMessage({ type: "done", chainId });
    }),
  );
}
