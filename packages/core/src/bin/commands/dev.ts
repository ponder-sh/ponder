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
  PreBuild,
} from "@/internal/types.js";
import { runMultichain } from "@/runtime/multichain.js";
import { runOmnichain } from "@/runtime/omnichain.js";
import { createServer } from "@/server/index.js";
import { createUi } from "@/ui/index.js";
import { createQueue } from "@/utils/queue.js";
import type { Result } from "@/utils/result.js";
import { isolatedController } from "../isolatedController.js";
import type { CliOptions } from "../ponder.js";
import { runCodegen } from "../utils/codegen.js";
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
    logger.error({
      msg: "Invalid Node.js version",
      version: process.versions.node,
      expected: "18.14",
    });
    process.exit(1);
  }

  if (!fs.existsSync(path.join(options.rootDir, ".env.local"))) {
    logger.warn({
      msg: "Local environment file (.env.local) not found",
    });
  }

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

  runCodegen({ common });

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
        if (isInitialBuild === false) {
          common.logger.error({
            error: result.error,
          });
        }

        // This handles indexing function build failures on hot reload.
        metrics.hasError = true;
        return;
      }

      if (result.kind === "indexing") {
        metrics.resetIndexingMetrics();

        const configResult = await build.executeConfig();
        if (configResult.status === "error") {
          common.logger.error({
            msg: "Build failed",
            stage: "config",
            error: configResult.error,
          });
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: configResult.error,
          });
          return;
        }

        const schemaResult = await build.executeSchema();
        if (schemaResult.status === "error") {
          common.logger.error({
            msg: "Build failed",
            stage: "schema",
            error: schemaResult.error,
          });
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: schemaResult.error,
          });
          return;
        }

        const preCompileResult = build.preCompile(configResult.result);

        if (preCompileResult.status === "error") {
          common.logger.error({
            msg: "Build failed",
            stage: "pre-compile",
            error: preCompileResult.error,
          });
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: preCompileResult.error,
          });
          return;
        }

        const databaseDiagnostic = await build.databaseDiagnostic({
          preBuild: preCompileResult.result,
        });
        if (databaseDiagnostic.status === "error") {
          common.logger.error({
            msg: "Build failed",
            stage: "diagnostic",
            error: databaseDiagnostic.error,
          });
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: databaseDiagnostic.error,
          });
          return;
        }

        const compileSchemaResult = build.compileSchema({
          ...schemaResult.result,
          preBuild: preCompileResult.result,
        });

        if (compileSchemaResult.status === "error") {
          common.logger.error({
            msg: "Build failed",
            stage: "schema",
            error: compileSchemaResult.error,
          });
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: compileSchemaResult.error,
          });
          return;
        }

        const configBuildResult = build.compileConfig({
          configResult: configResult.result,
        });
        if (configBuildResult.status === "error") {
          common.logger.error({
            msg: "Build failed",
            stage: "config",
            error: configBuildResult.error,
          });
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: configBuildResult.error,
          });
          return;
        }
        preBuild = preCompileResult.result;
        configBuild = configBuildResult.result;

        const rpcDiagnosticResult = await build.rpcDiagnostic({
          configBuild: configBuildResult.result,
        });
        if (rpcDiagnosticResult.status === "error") {
          common.logger.error({
            msg: "Build failed",
            stage: "diagnostic",
            error: rpcDiagnosticResult.error,
          });
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: rpcDiagnosticResult.error,
          });
          return;
        }

        const indexingResult = await build.executeIndexingFunctions();
        if (indexingResult.status === "error") {
          common.logger.error({
            msg: "Build failed",
            stage: "indexing",
            error: indexingResult.error,
          });
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
          configBuild: configBuildResult.result,
        });

        if (indexingBuildResult.status === "error") {
          common.logger.error({
            msg: "Build failed",
            stage: "indexing",
            error: indexingBuildResult.error,
          });
          buildQueue.add({
            status: "error",
            kind: "indexing",
            error: indexingBuildResult.error,
          });
          return;
        }

        database = createDatabase({
          common,
          namespace: { schema, viewsSchema: undefined },
          preBuild: preCompileResult.result,
          schemaBuild: compileSchemaResult.result,
        });
        crashRecoveryCheckpoint = await database.migrate({
          buildId: indexingBuildResult.result.buildId,
          chains: indexingBuildResult.result.chains,
          finalizedBlocks: indexingBuildResult.result.finalizedBlocks,
        });

        await database.migrateSync();

        const apiResult = await build.executeApi({
          preBuild: preCompileResult.result,
          configBuild: configBuildResult.result,
          database,
        });
        if (apiResult.status === "error") {
          common.logger.error({
            msg: "Build failed",
            stage: "api",
            error: apiResult.error,
          });
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
          common.logger.error({
            msg: "Build failed",
            stage: "api",
            error: apiBuildResult.error,
          });
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
                preBuild: preCompileResult.result,
                schemaBuild: compileSchemaResult.result,
                indexingBuild: indexingBuildResult.result,
              }),
            },
          });
        }

        metrics.resetApiMetrics();
        metrics.ponder_settings_info.set(
          {
            ordering: preCompileResult.result.ordering,
            database: preCompileResult.result.databaseConfig.kind,
            command: cliOptions.command,
          },
          1,
        );

        createServer({ common, database, apiBuild: apiBuildResult.result });

        metrics.initializeIndexingMetrics({
          indexingBuild: indexingBuildResult.result,
          schemaBuild: compileSchemaResult.result,
        });

        switch (preCompileResult.result.ordering) {
          case "omnichain":
            runOmnichain({
              common,
              database,
              preBuild: preCompileResult.result,
              namespaceBuild: { schema, viewsSchema: undefined },
              schemaBuild: compileSchemaResult.result,
              indexingBuild: indexingBuildResult.result,
              crashRecoveryCheckpoint,
            });
            break;
          case "multichain":
            runMultichain({
              common,
              database,
              preBuild: preCompileResult.result,
              namespaceBuild: { schema, viewsSchema: undefined },
              schemaBuild: compileSchemaResult.result,
              indexingBuild: indexingBuildResult.result,
              crashRecoveryCheckpoint,
            });
            break;
          case "experimental_isolated": {
            isolatedController({
              common,
              database,
              preBuild: preCompileResult.result,
              namespaceBuild: { schema, viewsSchema: undefined },
              schemaBuild: compileSchemaResult.result,
              indexingBuild: indexingBuildResult.result,
              crashRecoveryCheckpoint,
            });
            break;
          }
        }
      } else {
        metrics.resetApiMetrics();

        const apiResult = await build.executeApi({
          preBuild: preBuild!,
          configBuild: configBuild!,
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

  let preBuild: PreBuild | undefined;
  let configBuild: Pick<IndexingBuild, "chains" | "rpcs"> | undefined;
  let database: Database | undefined;
  let crashRecoveryCheckpoint: CrashRecoveryCheckpoint;

  const schema = cliOptions.schema ?? process.env.DATABASE_SCHEMA ?? "public";

  globalThis.PONDER_NAMESPACE_BUILD = { schema, viewsSchema: undefined };

  process.on("uncaughtException", (error: Error) => {
    if (error instanceof ShutdownError) return;
    if (error instanceof NonRetryableUserError) {
      common.logger.error({
        msg: "uncaughtException",
        error,
      });

      buildQueue.clear();
      buildQueue.add({ status: "error", kind: "indexing", error });
    } else {
      common.logger.error({
        msg: "uncaughtException",
        error,
      });
      exit({ code: 75 });
    }
  });
  process.on("unhandledRejection", (error: Error) => {
    if (error instanceof ShutdownError) return;
    if (error instanceof NonRetryableUserError) {
      common.logger.error({
        msg: "unhandledRejection",
        error,
      });

      buildQueue.clear();
      buildQueue.add({ status: "error", kind: "indexing", error });
    } else {
      common.logger.error({
        msg: "unhandledRejection",
        error,
      });
      exit({ code: 75 });
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
