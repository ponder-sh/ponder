import path from "node:path";
import { createBuildService } from "@/build/index.js";
import { createLogger } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { buildPayload, createTelemetry } from "@/common/telemetry.js";
import { createDatabase } from "@/database/index.js";
import type { CliOptions } from "../ponder.js";
import { run } from "../utils/run.js";
import { runServer } from "../utils/runServer.js";
import { setupShutdown } from "../utils/shutdown.js";

export async function start({ cliOptions }: { cliOptions: CliOptions }) {
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
  let cleanupReloadableServer = () => Promise.resolve();

  const cleanup = async () => {
    await cleanupReloadable();
    await cleanupReloadableServer();
    if (database) {
      await database.kill();
    }
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
      cli_command: "start",
      ...buildPayload(buildResult.indexingBuild),
    },
  });

  const database = createDatabase({
    common,
    schema: buildResult.indexingBuild.schema,
    databaseConfig: buildResult.indexingBuild.databaseConfig,
    buildId: buildResult.indexingBuild.buildId,
    instanceId: buildResult.indexingBuild.instanceId,
    namespace: buildResult.indexingBuild.namespace,
    statements: buildResult.indexingBuild.statements,
  });

  cleanupReloadable = await run({
    common,
    build: buildResult.indexingBuild!,
    database,
    onFatalError: () => {
      shutdown({ reason: "Received fatal error", code: 1 });
    },
    onReloadableError: () => {
      shutdown({ reason: "Encountered indexing error", code: 1 });
    },
  });

  cleanupReloadableServer = await runServer({
    common,
    build: buildResult.apiBuild,
    database,
  });

  return cleanup;
}
