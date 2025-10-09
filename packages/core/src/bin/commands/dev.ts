import fs from "node:fs";
import path from "node:path";
import { createBuild } from "@/build/index.js";
import { type Database, createDatabase } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import { NonRetryableUserError, ShutdownError } from "@/internal/errors.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { buildPayload, createTelemetry } from "@/internal/telemetry.js";
import type {
  CrashRecoveryCheckpoint,
  IndexingBuild,
} from "@/internal/types.js";
import { runMultichain } from "@/runtime/multichain.js";
import { runOmnichain } from "@/runtime/omnichain.js";
import { createServer } from "@/server/index.js";
import { createUi } from "@/ui/index.js";
import { createQueue } from "@/utils/queue.js";
import { type Result, mergeResults } from "@/utils/result.js";
import type { CliOptions } from "../ponder.js";
import { createExit } from "../utils/exit.js";

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
  const common = {
    options,
    logger,
    metrics,
    shutdown: createShutdown(),
    apiShutdown: createShutdown(),
    buildShutdown: createShutdown(),
  } as Common;

  const telemetry = createTelemetry(common);
  common.telemetry = telemetry;

  if (options.version) {
    metrics.ponder_version_info.set(
      {
        version: options.version.version,
        major: options.version.major,
        minor: options.version.minor,
        patch: options.version.patch,
      },
      1,
    );
  }

  const build = await createBuild({ common, cliOptions });

  if (cliOptions.disableUi !== true) {
    createUi({ common });
  }

  const exit = createExit({ common, options });

  let isInitialBuild = true;

  const buildQueue = createQueue({
    initialStart: true,
    concurrency: 1,
    worker: async (result: Result<never> & { kind: "indexing" | "api" }) => {
      if (result.kind === "indexing") {
        await Promise.all([common.shutdown.kill(), common.apiShutdown.kill()]);
        common.shutdown = createShutdown();
        common.apiShutdown = createShutdown();
      } else {
        await common.apiShutdown.kill();
        common.apiShutdown = createShutdown();
      }

      if (result.status === "error") {
        // This handles indexing function build failures on hot reload.
        metrics.hasError = true;
        return;
      }

      if (result.kind === "indexing") {
        metrics.resetIndexingMetrics();

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
          await build.preCompile(configResult.result),
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

        const indexingResult = await build.executeIndexingFunctions();
        if (indexingResult.status === "error") {
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: indexingResult.error,
          });
          return;
        }

        const indexingBuildResult = await build.compileIndexing({
          configResult: configResult.result,
          schemaResult: schemaResult.result,
          indexingResult: indexingResult.result,
        });

        if (indexingBuildResult.status === "error") {
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: indexingBuildResult.error,
          });
          return;
        }
        indexingBuild = indexingBuildResult.result;

        database = createDatabase({
          common,
          namespace: { schema, viewsSchema: undefined },
          preBuild,
          schemaBuild,
        });
        crashRecoveryCheckpoint = await database.migrate({
          buildId: indexingBuildResult.result.buildId,
          chains: indexingBuildResult.result.chains,
          finalizedBlocks: indexingBuildResult.result.finalizedBlocks,
        });

        await database.migrateSync();

        const apiResult = await build.executeApi({
          indexingBuild,
          database,
        });
        if (apiResult.status === "error") {
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: apiResult.error,
          });
          return;
        }

        const apiBuildResult = await build.compileApi({
          apiResult: apiResult.result,
        });

        if (apiBuildResult.status === "error") {
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: apiBuildResult.error,
          });
          return;
        }

        if (isInitialBuild) {
          isInitialBuild = false;

          telemetry.record({
            name: "lifecycle:session_start",
            properties: {
              cli_command: "dev",
              ...buildPayload({
                preBuild,
                schemaBuild,
                indexingBuild: indexingBuildResult.result,
              }),
            },
          });
        }

        metrics.resetApiMetrics();
        metrics.ponder_settings_info.set(
          {
            ordering: preBuild.ordering,
            database: preBuild.databaseConfig.kind,
            command: cliOptions.command,
          },
          1,
        );

        createServer({ common, database, apiBuild: apiBuildResult.result });

        metrics.initializeIndexingMetrics({
          indexingBuild: indexingBuildResult.result,
          schemaBuild,
        });

        if (preBuild.ordering === "omnichain") {
          runOmnichain({
            common,
            database,
            preBuild,
            namespaceBuild: { schema, viewsSchema: undefined },
            schemaBuild,
            indexingBuild: indexingBuildResult.result,
            crashRecoveryCheckpoint,
          });
        } else {
          runMultichain({
            common,
            database,
            preBuild,
            namespaceBuild: { schema, viewsSchema: undefined },
            schemaBuild,
            indexingBuild: indexingBuildResult.result,
            crashRecoveryCheckpoint,
          });
        }
      } else {
        metrics.resetApiMetrics();

        const apiResult = await build.executeApi({
          indexingBuild: indexingBuild!,
          database: database!,
        });
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

        createServer({ common, database: database!, apiBuild });
      }
    },
  });

  let indexingBuild: IndexingBuild | undefined;
  let database: Database | undefined;
  let crashRecoveryCheckpoint: CrashRecoveryCheckpoint;

  const schema = cliOptions.schema ?? process.env.DATABASE_SCHEMA ?? "public";

  globalThis.PONDER_NAMESPACE_BUILD = { schema, viewsSchema: undefined };

  process.on("uncaughtException", (error: Error) => {
    if (error instanceof ShutdownError) return;
    if (error instanceof NonRetryableUserError) {
      common.logger.error({
        service: "process",
        msg: "Caught uncaughtException event",
        error,
      });

      buildQueue.clear();
      buildQueue.add({ status: "error", kind: "indexing", error });
    } else {
      common.logger.error({
        service: "process",
        msg: "Caught uncaughtException event",
        error,
      });
      exit({ reason: "Received fatal error", code: 75 });
    }
  });
  process.on("unhandledRejection", (error: Error) => {
    if (error instanceof ShutdownError) return;
    if (error instanceof NonRetryableUserError) {
      common.logger.error({
        service: "process",
        msg: "Caught unhandledRejection event",
        error,
      });

      buildQueue.clear();
      buildQueue.add({ status: "error", kind: "indexing", error });
    } else {
      common.logger.error({
        service: "process",
        msg: "Caught unhandledRejection event",
        error,
      });
      exit({ reason: "Received fatal error", code: 75 });
    }
  });

  build.startDev({
    onReload: (kind) => {
      buildQueue.clear();
      buildQueue.add({ status: "success", kind });
    },
  });

  buildQueue.add({ status: "success", kind: "indexing" });

  return () =>
    Promise.all([
      common.shutdown.kill(),
      common.apiShutdown.kill(),
      common.buildShutdown.kill(),
    ]);
}
