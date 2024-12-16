import fs from "node:fs";
import path from "node:path";
import { type BuildResultDev, createBuild } from "@/build/index.js";
import { createLogger } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { buildPayload, createTelemetry } from "@/common/telemetry.js";
import { type Database, createDatabase } from "@/database/index.js";
import { createUi } from "@/ui/service.js";
import { mergeResults } from "@/utils/result.js";
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

  if (!fs.existsSync(path.join(options.rootDir, ".env.local"))) {
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

  const build = await createBuild({ common });

  const ui = createUi({ common });

  let indexingCleanupReloadable = () => Promise.resolve();
  let apiCleanupReloadable = () => Promise.resolve();

  const cleanup = async () => {
    await indexingCleanupReloadable();
    await apiCleanupReloadable();
    if (database) {
      await database.kill();
    }
    await build.kill();
    await telemetry.kill();
    ui.kill();
  };

  const shutdown = setupShutdown({ common, cleanup });

  const buildQueue = createQueue({
    initialStart: true,
    concurrency: 1,
    worker: async (result: BuildResultDev) => {
      if (result.kind === "indexing") {
        await indexingCleanupReloadable();
      }
      await apiCleanupReloadable();

      if (result.status === "success") {
        if (result.kind === "indexing") {
          metrics.resetIndexingMetrics();

          if (database) {
            await database.kill();
          }

          database = createDatabase({
            common,
            preBuild: result.result.preBuild,
            schemaBuild: result.result.schemaBuild,
          });

          indexingCleanupReloadable = await run({
            common,
            database,
            schemaBuild: result.result.schemaBuild,
            indexingBuild: result.result.indexingBuild,
            onFatalError: () => {
              shutdown({ reason: "Received fatal error", code: 1 });
            },
            onReloadableError: (error) => {
              buildQueue.clear();
              buildQueue.add({ status: "error", kind: "indexing", error });
            },
          });

          metrics.resetApiMetrics();

          apiCleanupReloadable = await runServer({
            common,
            database: database!,
            apiBuild: result.result.apiBuild,
          });
        } else {
          metrics.resetApiMetrics();

          apiCleanupReloadable = await runServer({
            common,
            database: database!,
            apiBuild: result.result,
          });
        }
      } else {
        // This handles indexing function build failures on hot reload.
        metrics.ponder_indexing_has_error.set(1);
        if (result.kind === "indexing") {
          indexingCleanupReloadable = () => Promise.resolve();
        }
        apiCleanupReloadable = () => Promise.resolve();
      }
    },
  });

  let database: Database | undefined;

  const executeResult = await build.execute();

  if (executeResult.configResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }
  if (executeResult.schemaResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }
  if (executeResult.indexingResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }
  if (executeResult.apiResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  const initialBuildResult = mergeResults([
    build.preCompile(executeResult.configResult.result),
    build.compileSchema(executeResult.schemaResult.result),
    await build.compileIndexing({
      configResult: executeResult.configResult.result,
      schemaResult: executeResult.schemaResult.result,
      indexingResult: executeResult.indexingResult.result,
    }),
    await build.compileApi({ apiResult: executeResult.apiResult.result }),
  ]);

  if (initialBuildResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  build.startDev({
    onBuild: (buildResult) => {
      buildQueue.clear();
      buildQueue.add(buildResult);
    },
  });

  telemetry.record({
    name: "lifecycle:session_start",
    properties: {
      cli_command: "dev",
      ...buildPayload({
        preBuild: initialBuildResult.result[0],
        schemaBuild: initialBuildResult.result[1],
        indexingBuild: initialBuildResult.result[2],
      }),
    },
  });

  buildQueue.add({
    status: "success",
    kind: "indexing",
    result: {
      preBuild: initialBuildResult.result[0],
      schemaBuild: initialBuildResult.result[1],
      indexingBuild: initialBuildResult.result[2],
      apiBuild: initialBuildResult.result[3],
    },
  });

  return async () => {
    buildQueue.pause();
    await cleanup();
  };
}
