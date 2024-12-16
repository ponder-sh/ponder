import path from "node:path";
import { createBuild } from "@/build/index.js";
import { createLogger } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { buildPayload, createTelemetry } from "@/common/telemetry.js";
import { type Database, createDatabase } from "@/database/index.js";
import { mergeResults } from "@/utils/result.js";
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

  const build = await createBuild({ common });

  let cleanupReloadable = () => Promise.resolve();
  let cleanupReloadableServer = () => Promise.resolve();

  // biome-ignore lint/style/useConst: <explanation>
  let database: Database | undefined;

  const cleanup = async () => {
    await cleanupReloadable();
    await cleanupReloadableServer();
    if (database) {
      await database.kill();
    }
    await telemetry.kill();
  };

  const shutdown = setupShutdown({ common, cleanup });

  const executeResult = await build.execute();
  await build.kill();

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

  const buildResult = mergeResults([
    build.preCompile(executeResult.configResult.result),
    build.compileSchema(executeResult.schemaResult.result),
    await build.compileIndexing({
      configResult: executeResult.configResult.result,
      schemaResult: executeResult.schemaResult.result,
      indexingResult: executeResult.indexingResult.result,
    }),
    await build.compileApi({ apiResult: executeResult.apiResult.result }),
  ]);

  if (buildResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  const [preBuild, schemaBuild, indexingBuild, apiBuild] = buildResult.result;

  telemetry.record({
    name: "lifecycle:session_start",
    properties: {
      cli_command: "start",
      ...buildPayload({
        preBuild,
        schemaBuild,
        indexingBuild,
      }),
    },
  });

  database = createDatabase({
    common,
    preBuild,
    schemaBuild,
  });

  cleanupReloadable = await run({
    common,
    database,
    schemaBuild,
    indexingBuild,
    onFatalError: () => {
      shutdown({ reason: "Received fatal error", code: 1 });
    },
    onReloadableError: () => {
      shutdown({ reason: "Encountered indexing error", code: 1 });
    },
  });

  cleanupReloadableServer = await runServer({
    common,
    database,
    apiBuild,
  });

  return cleanup;
}
