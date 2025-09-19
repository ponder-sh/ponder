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

if (isMainThread === false && parentPort) {
  try {
    await isolatedWorker({
      options: workerData.options,
      chainId: workerData.chainId,
      namespaceBuild: workerData.namespaceBuild,
      crashRecoveryCheckpoint: workerData.crashRecoveryCheckpoint,
    });

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
}

export async function isolatedWorker({
  options,
  chainId,
  namespaceBuild,
  crashRecoveryCheckpoint,
}: {
  options: Common["options"];
  chainId: number;
  namespaceBuild: NamespaceBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
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
  const common = { options, logger, metrics, telemetry, shutdown };

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

  globalThis.PONDER_NAMESPACE_BUILD = namespaceBuild;

  const configResult = await build.executeConfig();
  if (configResult.status === "error") {
    throw configResult.error;
  }

  const schemaResult = await build.executeSchema();
  if (schemaResult.status === "error") {
    throw schemaResult.error;
  }
  const preBuildResult = await build.preCompile(configResult.result);
  if (preBuildResult.status === "error") {
    throw preBuildResult.error;
  }

  const schemaBuildResult = build.compileSchema({
    ...schemaResult.result,
    ordering: preBuildResult.result.ordering,
  });
  if (schemaBuildResult.status === "error") {
    throw schemaBuildResult.error;
  }

  const indexingResult = await build.executeIndexingFunctions();
  if (indexingResult.status === "error") {
    throw indexingResult.error;
  }

  const indexingBuildResult = await build.compileIndexing({
    configResult: configResult.result,
    schemaResult: schemaResult.result,
    indexingResult: indexingResult.result,
  });
  if (indexingBuildResult.status === "error") {
    throw indexingBuildResult.error;
  }
  const chainCount = indexingBuildResult.result.chains.length;
  const chainIndex = indexingBuildResult.result.chains.findIndex(
    (c) => c.id === chainId,
  );
  indexingBuildResult.result.chains = [
    indexingBuildResult.result.chains[chainIndex]!,
  ];
  indexingBuildResult.result.rpcs = [
    indexingBuildResult.result.rpcs[chainIndex]!,
  ];
  indexingBuildResult.result.finalizedBlocks = [
    indexingBuildResult.result.finalizedBlocks[chainIndex]!,
  ];

  options.indexingCacheMaxBytes = Math.floor(
    options.indexingCacheMaxBytes / chainCount,
  );
  options.rpcMaxConcurrency = Math.floor(
    options.rpcMaxConcurrency / chainCount,
  );
  options.syncEventsQuerySize = Math.floor(
    options.syncEventsQuerySize / chainCount,
  );

  const database = createDatabase({
    common,
    namespace: namespaceBuild,
    preBuild: preBuildResult.result,
    schemaBuild: schemaBuildResult.result,
  });

  await runIsolated({
    common,
    preBuild: preBuildResult.result,
    namespaceBuild,
    schemaBuild: schemaBuildResult.result,
    indexingBuild: indexingBuildResult.result,
    crashRecoveryCheckpoint,
    database,
    onReady: () => {
      parentPort!.postMessage({ type: "ready" });
    },
  });
}
