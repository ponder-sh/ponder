import { existsSync } from "node:fs";
import path from "node:path";
import { type BuildResult, BuildService } from "@/build/service.js";
import { LoggerService } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { TelemetryService } from "@/common/telemetry.js";
import { UiService } from "@/ui/service.js";
import { createQueue } from "@ponder/common";
import dotenv from "dotenv";
import type { CliOptions } from "../ponder.js";
import { run } from "../utils/run.js";
import { setupShutdown } from "../utils/shutdown.js";

export async function dev({ cliOptions }: { cliOptions: CliOptions }) {
  dotenv.config({ path: ".env.local" });
  const options = buildOptions({ cliOptions });

  const logger = new LoggerService({
    level: options.logLevel,
    dir: options.logDir,
  });

  const [major, minor, _patch] = process.versions.node.split(".").map(Number);
  if (major < 18 || (major === 18 && minor < 14)) {
    logger.fatal({
      service: "process",
      msg: `Invalid Node.js version. Expected >=18.14, detected ${major}.${minor}.`,
    });
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
  const telemetry = new TelemetryService({ options });
  const common = { options, logger, metrics, telemetry };

  const buildService = new BuildService({ common });
  await buildService.setup({ watch: true });

  const uiService = new UiService({ common });

  let cleanupReloadable = () => Promise.resolve();

  const cleanup = async () => {
    await cleanupReloadable();
    await buildService.kill();
    await telemetry.kill();
    uiService.kill();
  };

  const shutdown = setupShutdown({ common, cleanup });

  const initialResult = await buildService.initialLoad();
  if (initialResult.error) {
    logger.error({
      service: "process",
      msg: "Failed initial build with error:",
      error: initialResult.error,
    });
    await shutdown("Failed intial build");
    return cleanup;
  }

  telemetry.record({
    event: "App Started",
    properties: {
      command: "ponder dev",
      contractCount: initialResult.build.sources.length,
      databaseKind: initialResult.build.databaseConfig.kind,
    },
  });

  const buildQueue = createQueue({
    initialStart: true,
    concurrency: 1,
    worker: async (result: BuildResult) => {
      await cleanupReloadable();

      if (result.success) {
        uiService.reset(result.build.sources);
        metrics.resetMetrics();

        cleanupReloadable = await run({
          common,
          build: result.build,
          onFatalError: () => {
            shutdown("Received fatal error");
          },
          onReloadableError: (error) => {
            buildQueue.clear();
            buildQueue.add({ success: false, error });
          },
        });
      } else {
        // This handles build failures and indexing errors on hot reload.
        uiService.setReloadableError();
        cleanupReloadable = () => Promise.resolve();
      }
    },
  });

  buildService.on("rebuild", (build) => {
    buildQueue.clear();
    buildQueue.add(build);
  });

  buildQueue.add(initialResult);

  return async () => {
    buildQueue.pause();
    await cleanup();
  };
}
