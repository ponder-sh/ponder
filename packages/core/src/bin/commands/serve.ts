import path from "node:path";
import { createBuildService } from "@/build/index.js";
import { createLogger } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { buildPayload, createTelemetry } from "@/common/telemetry.js";
import { createDatabase } from "@/database/index.js";
import { createServer } from "@/server/index.js";
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

  const buildResult = await buildService.start({ watch: false });
  // Once we have the initial build, we can kill the build service.
  await buildService.kill();

  if (buildResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  telemetry.record({
    name: "lifecycle:session_start",
    properties: {
      cli_command: "serve",
      ...buildPayload(buildResult.indexingBuild),
    },
  });

  const { databaseConfig, schema, instanceId, buildId, statements, namespace } =
    buildResult.apiBuild;

  if (databaseConfig.kind === "pglite") {
    await shutdown({
      reason: "The 'ponder serve' command does not support PGlite",
      code: 1,
    });
    return cleanup;
  }

  const database = createDatabase({
    common,
    schema,
    databaseConfig,
    instanceId,
    buildId,
    statements,
    namespace,
  });

  const server = await createServer({
    common,
    app: buildResult.apiBuild.app,
    routes: buildResult.apiBuild.routes,
    graphqlSchema: buildResult.indexingBuild.graphqlSchema,
    database,
    instanceId:
      process.env.PONDER_EXPERIMENTAL_INSTANCE_ID === undefined
        ? undefined
        : instanceId,
  });

  cleanupReloadable = async () => {
    await server.kill();
    await database.kill();
  };

  return cleanup;
}
