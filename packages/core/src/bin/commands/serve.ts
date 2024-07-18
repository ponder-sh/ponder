import path from "node:path";
import { createBuildService } from "@/build/index.js";
import { createLogger } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { buildPayload, createTelemetry } from "@/common/telemetry.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import { createServer } from "@/server/service.js";
import type { CliOptions } from "../ponder.js";
import { setupShutdown } from "../utils/shutdown.js";

export async function serve({ cliOptions }: { cliOptions: CliOptions }) {
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

  const configRelPath = path.relative(options.rootDir, options.configFile);
  logger.debug({
    service: "app",
    msg: `Started using config file: ${configRelPath}`,
  });

  const metrics = new MetricsService();
  const telemetry = createTelemetry({ options, logger });
  const common = { options, logger, metrics, telemetry };

  const buildService = await createBuildService({ common });

  let cleanupReloadable = () => Promise.resolve();

  const cleanup = async () => {
    await cleanupReloadable();
    await telemetry.kill();
  };

  const shutdown = setupShutdown({ common, cleanup });

  const { api, indexing } = await buildService.start({ watch: false });
  // Once we have the initial build, we can kill the build service.
  await buildService.kill();

  if (api.status === "error" || indexing.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  telemetry.record({
    name: "lifecycle:session_start",
    properties: {
      cli_command: "serve",
      ...buildPayload(indexing.build),
    },
  });

  const { databaseConfig, optionsConfig, schema } = api.build;

  common.options = { ...common.options, ...optionsConfig };

  if (databaseConfig.kind === "sqlite") {
    await shutdown({
      reason: "The 'ponder serve' command does not support SQLite",
      code: 1,
    });
    return cleanup;
  }

  if (databaseConfig.publishSchema === undefined) {
    await shutdown({
      reason: "The 'ponder serve' command requires 'publishSchema' to be set",
      code: 1,
    });
    return cleanup;
  }

  const { poolConfig, schema: userNamespace } = databaseConfig;
  const database = new PostgresDatabaseService({
    common,
    poolConfig,
    userNamespace,
    // Ensures that the `readonly` connection pool gets
    // allocated the maximum number of connections.
    isReadonly: true,
  });

  const server = await createServer({
    app: api.build.app,
    routes: api.build.routes,
    common,
    schema,
    database,
    dbNamespace: databaseConfig.publishSchema,
  });

  cleanupReloadable = async () => {
    await server.kill();
    await database.kill();
  };

  return cleanup;
}
