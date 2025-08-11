import fs from "node:fs";
import path, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { createBuild } from "@/build/index.js";
import { type Database, createDatabase } from "@/database/index.js";
import { NonRetryableUserError, ShutdownError } from "@/internal/errors.js";
import { createLogger } from "@/internal/logger.js";
import {
  AggregatorMetricsService,
  MetricsService,
} from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { buildPayload, createTelemetry } from "@/internal/telemetry.js";
import type {
  Chain,
  CrashRecoveryCheckpoint,
  IndexingBuild,
} from "@/internal/types.js";
import { createServer } from "@/server/index.js";
import { createUi } from "@/ui/index.js";
import type { PromiseWithResolvers } from "@/utils/promiseWithResolvers.js";
import { createQueue } from "@/utils/queue.js";
import type { Result } from "@/utils/result.js";
import type { CliOptions } from "../ponder.js";
import { createExit } from "../utils/exit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type WorkerState = "historical" | "realtime" | "complete" | "failed";

interface WorkerInfo {
  state: WorkerState;
  chain: Chain;
  worker: Worker;
  retryCount: number;
  timeout?: NodeJS.Timeout;
  messageHandler?: (message: any) => void;
  exitHandler?: (code: number) => void;
}

export async function devIsolated({ cliOptions }: { cliOptions: CliOptions }) {
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
  let indexingShutdown = createShutdown();
  let apiShutdown = createShutdown();
  const shutdown = createShutdown();
  const telemetry = createTelemetry({ options, logger, shutdown });
  const common = { options, logger, metrics, telemetry };

  const build = await createBuild({
    common: { ...common, shutdown },
    cliOptions,
  });

  shutdown.add(async () => {
    await indexingShutdown.kill();
    await apiShutdown.kill();
  });

  if (cliOptions.disableUi !== true) {
    createUi({ common: { ...common, shutdown } });
  }

  const exit = createExit({ common: { ...common, shutdown }, options });

  let isInitialBuild = true;

  const appState: { [chainName: string]: WorkerInfo } = {};
  const workerPath = join(__dirname, "..", "..", "runtime", "isolated.js");

  const buildQueue = createQueue({
    initialStart: true,
    concurrency: 1,
    worker: async (result: Result<never> & { kind: "indexing" | "api" }) => {
      if (result.kind === "indexing") {
        await indexingShutdown.kill();
        indexingShutdown = createShutdown();
      }
      await apiShutdown.kill();
      apiShutdown = createShutdown();

      if (result.status === "error") {
        // This handles indexing function build failures on hot reload.
        metrics.ponder_indexing_has_error.set(1);
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

        const preBuildResult = await build.preCompile(configResult.result);
        if (preBuildResult.status === "error") {
          await exit({ reason: "Failed intial build", code: 1 });
          return;
        }

        const preBuild = preBuildResult.result;

        const schemaBuildResult = build.compileSchema({
          ...schemaResult.result,
          ordering: preBuild.ordering,
        });
        if (schemaBuildResult.status === "error") {
          await exit({ reason: "Failed intial build", code: 1 });
          return;
        }
        const schemaBuild = schemaBuildResult.result;

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

        database = await createDatabase({
          common: { ...common, shutdown: indexingShutdown },
          namespace: { schema, viewsSchema: undefined },
          preBuild,
          schemaBuild,
        });
        crashRecoveryCheckpoint = await database.migrate({
          buildId: indexingBuildResult.result.buildId,
          ordering: preBuild.ordering,
        });

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

        createServer({
          common: { ...common, shutdown: apiShutdown },
          database,
          apiBuild: apiBuildResult.result,
        });

        switch (preBuild.ordering) {
          case "omnichain":
          case "multichain":
          case "isolated": {
            common.metrics = new AggregatorMetricsService(appState);
            common.metrics.addListeners();

            indexingBuild.chains.forEach((chain) => {
              appState[chain.name] = {
                state: "historical",
                chain,
                worker: new Worker(workerPath, {
                  workerData: {
                    cliOptions,
                    crashRecoveryCheckpoint,
                    chainId: chain.id,
                  },
                }),
                retryCount: 0,
              };
            });

            const cleanupWorker = (chainName: string) => {
              const workerInfo = appState[chainName];
              if (!workerInfo) return;

              if (workerInfo.timeout) {
                clearTimeout(workerInfo.timeout);
                workerInfo.timeout = undefined;
              }

              if (workerInfo.messageHandler) {
                workerInfo.worker.off("message", workerInfo.messageHandler);
                workerInfo.messageHandler = undefined;
              }

              if (workerInfo.exitHandler) {
                workerInfo.worker.off("exit", workerInfo.exitHandler);
                workerInfo.exitHandler = undefined;
              }
            };

            const createWorker = (chainName: string): Worker => {
              const workerInfo = appState[chainName]!;

              return new Worker(workerPath, {
                workerData: {
                  cliOptions,
                  crashRecoveryCheckpoint,
                  chainId: workerInfo.chain.id,
                },
              });
            };

            const setupWorkerHandlers = (
              chainName: string,
              worker: Worker,
              pwr: PromiseWithResolvers<void>,
            ) => {
              const workerInfo = appState[chainName];
              if (!workerInfo) return;

              cleanupWorker(chainName);

              const messageHandler = (message: any) => {
                switch (message.type) {
                  case "ready": {
                    workerInfo.state = "realtime";
                    if (workerInfo.timeout) {
                      clearTimeout(workerInfo.timeout);
                      workerInfo.timeout = undefined;
                    }
                    break;
                  }
                  case "complete": {
                    workerInfo.state = "complete";
                    if (workerInfo.timeout) {
                      clearTimeout(workerInfo.timeout);
                      workerInfo.timeout = undefined;
                    }
                    pwr.resolve();
                    break;
                  }
                }

                callback();
              };

              const exitHandler = async (code: number) => {
                if (code !== 0) {
                  workerInfo.state === "failed";
                  const error = new Error(
                    `Chain '${chainName}' exited with code ${code}.`,
                  );

                  common.logger.error({
                    service: "app",
                    msg: error.message,
                  });

                  workerInfo.state = "failed";
                  pwr.reject(error);
                }
              };
            };
          }
        }

        // if (preBuild.ordering === "omnichain") {
        //   runOmnichain({
        //     common: { ...common, shutdown: indexingShutdown },
        //     database,
        //     preBuild,
        //     namespaceBuild: { schema, viewsSchema: undefined },
        //     schemaBuild,
        //     indexingBuild: indexingBuildResult.result,
        //     crashRecoveryCheckpoint,
        //   });
        // } else {
        //   runMultichain({
        //     common: { ...common, shutdown: indexingShutdown },
        //     database,
        //     preBuild,
        //     namespaceBuild: { schema, viewsSchema: undefined },
        //     schemaBuild,
        //     indexingBuild: indexingBuildResult.result,
        //     crashRecoveryCheckpoint,
        //   });
        // }
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

        createServer({
          common: { ...common, shutdown: apiShutdown },
          database: database!,
          apiBuild,
        });
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

  return shutdown.kill;
}

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
  let indexingShutdown = createShutdown();
  let apiShutdown = createShutdown();
  const shutdown = createShutdown();
  const telemetry = createTelemetry({ options, logger, shutdown });
  const common = { options, logger, metrics, telemetry };

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

  const build = await createBuild({
    common: { ...common, shutdown },
    cliOptions,
  });

  shutdown.add(async () => {
    await indexingShutdown.kill();
    await apiShutdown.kill();
  });

  if (cliOptions.disableUi !== true) {
    createUi({ common: { ...common, shutdown } });
  }

  const exit = createExit({ common: { ...common, shutdown }, options });

  let isInitialBuild = true;

  const buildQueue = createQueue({
    initialStart: true,
    concurrency: 1,
    worker: async (result: Result<never> & { kind: "indexing" | "api" }) => {
      if (result.kind === "indexing") {
        await indexingShutdown.kill();
        indexingShutdown = createShutdown();
      }
      await apiShutdown.kill();
      apiShutdown = createShutdown();

      if (result.status === "error") {
        // This handles indexing function build failures on hot reload.
        metrics.ponder_indexing_has_error.set(1);
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

        const preBuildResult = await build.preCompile(configResult.result);
        if (preBuildResult.status === "error") {
          await exit({ reason: "Failed intial build", code: 1 });
          return;
        }

        const preBuild = preBuildResult.result;

        const schemaBuildResult = build.compileSchema({
          ...schemaResult.result,
          ordering: preBuild.ordering,
        });
        if (schemaBuildResult.status === "error") {
          await exit({ reason: "Failed intial build", code: 1 });
          return;
        }
        const schemaBuild = schemaBuildResult.result;

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

        database = await createDatabase({
          common: { ...common, shutdown: indexingShutdown },
          namespace: { schema, viewsSchema: undefined },
          preBuild,
          schemaBuild,
        });
        crashRecoveryCheckpoint = await database.migrate({
          buildId: indexingBuildResult.result.buildId,
          ordering: preBuild.ordering,
        });

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

        createServer({
          common: { ...common, shutdown: apiShutdown },
          database,
          apiBuild: apiBuildResult.result,
        });

        // if (preBuild.ordering === "omnichain") {
        //   runOmnichain({
        //     common: { ...common, shutdown: indexingShutdown },
        //     database,
        //     preBuild,
        //     namespaceBuild: { schema, viewsSchema: undefined },
        //     schemaBuild,
        //     indexingBuild: indexingBuildResult.result,
        //     crashRecoveryCheckpoint,
        //   });
        // } else {
        //   runMultichain({
        //     common: { ...common, shutdown: indexingShutdown },
        //     database,
        //     preBuild,
        //     namespaceBuild: { schema, viewsSchema: undefined },
        //     schemaBuild,
        //     indexingBuild: indexingBuildResult.result,
        //     crashRecoveryCheckpoint,
        //   });
        // }
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

        createServer({
          common: { ...common, shutdown: apiShutdown },
          database: database!,
          apiBuild,
        });
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

  return shutdown.kill;
}
