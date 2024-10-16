import { existsSync } from "node:fs";
import path from "node:path";
import {
  type ApiBuildResult,
  type IndexingBuildResult,
  createBuildService,
} from "@/build/index.js";
import { createLogger } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { buildPayload, createTelemetry } from "@/common/telemetry.js";
import { createUi } from "@/ui/service.js";
import { createQueue } from "@ponder/common";
import type { CliOptions } from "../ponder.js";
import { run } from "../utils/run.js";
import { runServer } from "../utils/runServer.js";
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

  const ui = createUi({ common });

  let indexingCleanupReloadable = () => Promise.resolve();
  let apiCleanupReloadable = () => Promise.resolve();

  const cleanup = async () => {
    await indexingCleanupReloadable();
    await apiCleanupReloadable();
    await buildService.kill();
    await telemetry.kill();
    ui.kill();
  };

  const shutdown = setupShutdown({ common, cleanup });

  const indexingBuildQueue = createQueue({
    initialStart: true,
    concurrency: 1,
    worker: async (result: IndexingBuildResult) => {
      await indexingCleanupReloadable();

      if (result.status === "success") {
        metrics.resetIndexingMetrics();

        indexingCleanupReloadable = await run({
          common,
          build: result.build,
          onFatalError: () => {
            shutdown({ reason: "Received fatal error", code: 1 });
          },
          onReloadableError: (error) => {
            indexingBuildQueue.clear();
            indexingBuildQueue.add({ status: "error", error });
          },
        });
      } else {
        // This handles indexing function build failures on hot reload.
        metrics.ponder_indexing_has_error.set(1);
        indexingCleanupReloadable = () => Promise.resolve();
      }
    },
  });

  const apiBuildQueue = createQueue({
    initialStart: true,
    concurrency: 1,
    worker: async (result: ApiBuildResult) => {
      await apiCleanupReloadable();

      if (result.status === "success") {
        metrics.resetApiMetrics();

        apiCleanupReloadable = await runServer({ common, build: result.build });
      } else {
        // This handles API function build failures on hot reload.
        metrics.ponder_indexing_has_error.set(1);
        apiCleanupReloadable = () => Promise.resolve();
      }
    },
  });

  const { api, indexing } = await buildService.start({
    watch: true,
    onIndexingBuild: (buildResult) => {
      indexingBuildQueue.clear();
      indexingBuildQueue.add(buildResult);
    },
    onApiBuild: (buildResult) => {
      apiBuildQueue.clear();
      apiBuildQueue.add(buildResult);
    },
  });

  if (indexing.status === "error" || api.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  telemetry.record({
    name: "lifecycle:session_start",
    properties: {
      cli_command: "dev",
      ...buildPayload(indexing.build),
    },
  });

  indexingBuildQueue.add(indexing);
  apiBuildQueue.add(api);

  return async () => {
    indexingBuildQueue.pause();
    apiBuildQueue.pause();
    await cleanup();
  };
}
