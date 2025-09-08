import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { createBuild } from "@/build/index.js";
import { createDatabase } from "@/database/index.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { createTelemetry } from "@/internal/telemetry.js";
import type {
  CrashRecoveryCheckpoint,
  NamespaceBuild,
} from "@/internal/types.js";
import { runIsolated } from "@/runtime/isolated.js";
import type { CliOptions } from "../ponder.js";

if (isMainThread === false && parentPort) {
  try {
    await isolatedWorker({
      cliOptions: workerData.cliOptions,
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
  cliOptions,
  chainId,
  namespaceBuild,
  crashRecoveryCheckpoint,
}: {
  cliOptions: CliOptions;
  chainId: number;
  namespaceBuild: NamespaceBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
}) {
  const options = buildOptions({ cliOptions });

  // Note: telemetry is disabled because the main thread will report telemetry
  options.telemetryDisabled = true;

  const logger = createLogger({
    level: options.logLevel,
    mode: options.logFormat,
  });

  const metrics = new MetricsService();
  const shutdown = createShutdown();
  const telemetry = createTelemetry({ options, logger, shutdown });
  const common = { options, logger, metrics, telemetry, shutdown };
  metrics.addListeners();

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
    chainId,
    onReady: () => {
      parentPort!.postMessage({ type: "ready" });
    },
  });
}
