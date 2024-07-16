import { existsSync } from "node:fs";
import path from "node:path";
import {
  type ApiBuild,
  type ApiBuildResult,
  type IndexingBuild,
  type IndexingBuildResult,
  createBuildService,
} from "@/build/index.js";
import { createLogger } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { buildPayload, createTelemetry } from "@/common/telemetry.js";
import { UiService } from "@/ui/service.js";
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

  const uiService = new UiService({ common });

  let cleanupReloadable = () => Promise.resolve();
  let cleanupReloadableServer = () => Promise.resolve();

  const cleanup = async () => {
    await cleanupReloadable();
    await cleanupReloadableServer();
    await buildService.kill();
    await telemetry.kill();
    uiService.kill();
  };

  const shutdown = setupShutdown({ common, cleanup });

  let cachedIndexingBuild: IndexingBuild;
  let cachedApiBuild: ApiBuild | undefined;

  // Note: an update to the "indexing" build triggers a reload of the server runtime.
  // This is to ensure that updates to either the config or schema are reflected in
  // the server.
  const buildQueue = createQueue({
    initialStart: true,
    concurrency: 1,
    worker: async (
      result:
        | ({ type: "indexing" } & IndexingBuildResult)
        | ({ type: "server" } & ApiBuildResult),
    ) => {
      if (result.type === "indexing") {
        await cleanupReloadable();
        await cleanupReloadableServer();

        if (result.status === "success") {
          uiService.reset();
          metrics.resetMetrics();

          cachedIndexingBuild = result.build;

          cleanupReloadable = await run({
            common,
            build: result.build,
            onFatalError: () => {
              shutdown({ reason: "Received fatal error", code: 1 });
            },
            onReloadableError: (error) => {
              buildQueue.clear();
              buildQueue.add({ type: "indexing", status: "error", error });
            },
          });

          cleanupReloadableServer = await runServer({
            common,
            indexingBuild: cachedIndexingBuild,
            apiBuild: cachedApiBuild,
          });
        } else {
          // This handles build failures and indexing errors on hot reload.
          uiService.setReloadableError();
          cleanupReloadable = () => Promise.resolve();
        }
      } else {
        await cleanupReloadableServer();

        if (result.status === "success") {
          cachedApiBuild = result.build;

          cleanupReloadableServer = await runServer({
            common,
            indexingBuild: cachedIndexingBuild,
            apiBuild: result.build,
          });
        } else {
          // This handles build failures and indexing errors on hot reload.
          uiService.setReloadableError();
          cleanupReloadableServer = () => Promise.resolve();
        }
      }
    },
  });

  const initialIndexingResult = await buildService.start({
    watch: true,
    onBuild: (buildResult) => {
      buildQueue.clear();
      buildQueue.add({ type: "indexing", ...buildResult });
    },
  });
  const initialApiResult = await buildService.startServer({
    watch: true,
    onBuild: (buildResult) => {
      buildQueue.clear();
      buildQueue.add({ type: "server", ...buildResult });
    },
  });

  if (
    initialIndexingResult.status === "error" ||
    initialApiResult.status === "error"
  ) {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  telemetry.record({
    name: "lifecycle:session_start",
    properties: {
      cli_command: "dev",
      ...buildPayload(initialIndexingResult.build),
    },
  });

  cachedIndexingBuild = initialIndexingResult.build;
  cachedApiBuild = initialApiResult.build;

  buildQueue.add({ type: "indexing", ...initialIndexingResult });

  return async () => {
    buildQueue.pause();
    await cleanup();
  };
}
