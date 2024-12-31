import fs from "node:fs";
import path from "node:path";
import { createBuild } from "@/build/index.js";
import { createLogger } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { buildPayload, createTelemetry } from "@/common/telemetry.js";
import { type Database, createDatabase } from "@/database/index.js";
import { createUi } from "@/ui/service.js";
import { type Result, mergeResults } from "@/utils/result.js";
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

  const build = await createBuild({ common, cliOptions });

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

  let isInitialBuild = true;

  const buildQueue = createQueue({
    initialStart: true,
    concurrency: 1,
    worker: async (result: Result<never> & { kind: "indexing" | "api" }) => {
      if (result.kind === "indexing") {
        await indexingCleanupReloadable();
      }
      await apiCleanupReloadable();

      if (result.status === "error") {
        // This handles indexing function build failures on hot reload.
        metrics.ponder_indexing_has_error.set(1);
        if (result.kind === "indexing") {
          indexingCleanupReloadable = () => Promise.resolve();
        }
        apiCleanupReloadable = () => Promise.resolve();
        return;
      }

      if (result.kind === "indexing") {
        metrics.resetIndexingMetrics();

        if (database) {
          await database.kill();
        }

        const configResult = await build.executeConfig();
        if (configResult.status === "error") {
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: configResult.error,
          });
          return;
        }

        const schemaResult = await build.executeSchema();
        if (schemaResult.status === "error") {
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: schemaResult.error,
          });
          return;
        }

        const buildResult1 = mergeResults([
          build.preCompile(configResult.result),
          build.compileSchema(schemaResult.result),
        ]);

        if (buildResult1.status === "error") {
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: buildResult1.error,
          });
          return;
        }

        const [preBuild, schemaBuild] = buildResult1.result;

        database = await createDatabase({
          common,
          preBuild,
          schemaBuild,
        });

        const indexingResult = await build.executeIndexingFunctions();
        if (indexingResult.status === "error") {
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: indexingResult.error,
          });
          return;
        }

        const apiResult = await build.executeApi({ database });
        if (apiResult.status === "error") {
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: apiResult.error,
          });
          return;
        }

        const buildResult2 = mergeResults([
          await build.compileIndexing({
            configResult: configResult.result,
            schemaResult: schemaResult.result,
            indexingResult: indexingResult.result,
          }),
          await build.compileApi({ apiResult: apiResult.result }),
        ]);

        if (buildResult2.status === "error") {
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: buildResult2.error,
          });
          return;
        }

        const [indexingBuild, apiBuild] = buildResult2.result;

        if (isInitialBuild) {
          isInitialBuild = false;

          telemetry.record({
            name: "lifecycle:session_start",
            properties: {
              cli_command: "dev",
              ...buildPayload({
                preBuild,
                schemaBuild,
                indexingBuild,
              }),
            },
          });
        }

        indexingCleanupReloadable = await run({
          common,
          database,
          schemaBuild,
          indexingBuild,
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
          database,
          apiBuild,
        });
      } else {
        metrics.resetApiMetrics();

        const apiResult = await build.executeApi({ database: database! });
        if (apiResult.status === "error") {
          buildQueue.add({
            status: "error",
            kind: "api",
            error: apiResult.error,
          });
          return;
        }

        const buildResult = await build.compileApi({
          apiResult: apiResult.result,
        });
        if (buildResult.status === "error") {
          buildQueue.add({
            status: "error",
            kind: "api",
            error: buildResult.error,
          });
          return;
        }

        const apiBuild = buildResult.result;

        apiCleanupReloadable = await runServer({
          common,
          database: database!,
          apiBuild,
        });
      }
    },
  });

  let database: Database | undefined;

  build.initNamespace({ isSchemaRequired: false });

  build.startDev({
    onReload: (kind) => {
      buildQueue.clear();
      buildQueue.add({ status: "success", kind });
    },
  });

  buildQueue.add({ status: "success", kind: "indexing" });

  return async () => {
    buildQueue.pause();
    await cleanup();
  };
}
