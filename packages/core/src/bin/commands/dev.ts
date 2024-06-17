import { existsSync } from "node:fs";
import path from "node:path";
import { type BuildResult, createBuildService } from "@/build/index.js";
import { createLogger } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { buildPayload, createTelemetry } from "@/common/telemetry.js";
import { UiService } from "@/ui/service.js";
import { createQueue } from "@ponder/common";
import type { CliOptions } from "../ponder.js";
import { run } from "../utils/run.js";
import { setupShutdown } from "../utils/shutdown.js";

export async function dev({ cliOptions }: { cliOptions: CliOptions }) {
  const options = buildOptions({ cliOptions });

  const logger = createLogger({
    level: options.logLevel,
    mode: options.logFormat,
  });

  const [major, minor, _patch] = process.versions.node
    .split(".")
    .map(Number) as [number, number, number];
  if (major < 18 || (major === 18 && minor < 14)) {
    logger.fatal({
      service: "process",
      msg: `Invalid Node.js version. Expected >=18.14, detected ${major}.${minor}.`,
    });
    await logger.kill();
    process.exit(1);
  }

  if (!existsSync(path.join(options.rootDir, ".env.local"))) {
    logger.warn({
      service: "app",
      msg: "Local environment file (.env.local) not found",
    });
  }

  const configRelPath = path.relative(options.rootDir, options.configFile);
  logger.debug({
    service: "app",
    msg: `Started using config file: ${configRelPath}`,
  });

  const metrics = new MetricsService();
  const telemetry = createTelemetry({ options, logger });
  const common = { options, logger, metrics, telemetry };

  const buildService = await createBuildService({ common });

  const uiService = new UiService({ common });

  let cleanupReloadable = () => Promise.resolve();

  const cleanup = async () => {
    await cleanupReloadable();
    await buildService.kill();
    await telemetry.kill();
    uiService.kill();
  };

  const shutdown = setupShutdown({ common, cleanup });

  const buildQueue = createQueue({
    initialStart: true,
    concurrency: 1,
    worker: async (result: BuildResult) => {
      await cleanupReloadable();

      if (result.status === "success") {
        uiService.reset();
        metrics.resetMetrics();

        cleanupReloadable = await run({
          common,
          build: result.build,
          onFatalError: () => {
            shutdown({ reason: "Received fatal error", code: 1 });
          },
          onReloadableError: (error) => {
            buildQueue.clear();
            buildQueue.add({ status: "error", error });
          },
        });
      } else {
        // This handles build failures and indexing errors on hot reload.
        uiService.setReloadableError();
        cleanupReloadable = () => Promise.resolve();
      }
    },
  });

  const initialResult = await buildService.start({
    watch: true,
    onBuild: (buildResult) => {
      buildQueue.clear();
      buildQueue.add(buildResult);
    },
  });

  if (initialResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  telemetry.record({
    name: "lifecycle:session_start",
    properties: { cli_command: "dev", ...buildPayload(initialResult.build) },
  });

  buildQueue.add(initialResult);

  return async () => {
    buildQueue.pause();
    await cleanup();
  };
}
