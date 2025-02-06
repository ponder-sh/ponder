import path from "node:path";
import { createBuild } from "@/build/index.js";
import { type Database, createDatabase } from "@/database/index.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { buildPayload, createTelemetry } from "@/internal/telemetry.js";
import { mergeResults } from "@/utils/result.js";
import type { CliOptions } from "../ponder.js";
import { createExit } from "../utils/exit.js";
import { run } from "../utils/run.js";
import { runServer } from "../utils/runServer.js";

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
    process.exit(1);
  }

  const configRelPath = path.relative(options.rootDir, options.configFile);
  logger.debug({
    service: "app",
    msg: `Started using config file: ${configRelPath}`,
  });

  const metrics = new MetricsService();
  const shutdown = createShutdown();
  const telemetry = createTelemetry({ options, logger, shutdown });
  const common = { options, logger, metrics, telemetry, shutdown };
  const exit = createExit({ common });

  const build = await createBuild({ common, cliOptions });

  // biome-ignore lint/style/useConst: <explanation>
  let database: Database | undefined;

  // const shutdown = setupShutdown({ common, cleanup });

  const namespaceResult = build.namespaceCompile();
  if (namespaceResult.status === "error") {
    await exit({ reason: "Failed to initialize namespace", code: 1 });
    return;
  }

  const configResult = await build.executeConfig();
  if (configResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  const schemaResult = await build.executeSchema({
    namespace: namespaceResult.result,
  });
  if (schemaResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  const buildResult1 = mergeResults([
    build.preCompile(configResult.result),
    build.compileSchema(schemaResult.result),
  ]);

  if (buildResult1.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  const [preBuild, schemaBuild] = buildResult1.result;

  const indexingResult = await build.executeIndexingFunctions();
  if (indexingResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  const indexingBuildResult = await build.compileIndexing({
    configResult: configResult.result,
    schemaResult: schemaResult.result,
    indexingResult: indexingResult.result,
  });

  if (indexingBuildResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  database = await createDatabase({
    common,
    namespace: namespaceResult.result,
    preBuild,
    schemaBuild,
  });
  await database.migrate(indexingBuildResult.result);

  const apiResult = await build.executeApi({
    indexingBuild: indexingBuildResult.result,
    database,
  });
  if (apiResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  const apiBuildResult = await build.compileApi({
    apiResult: apiResult.result,
  });

  if (apiBuildResult.status === "error") {
    await exit({ reason: "Failed intial build", code: 1 });
    return;
  }

  telemetry.record({
    name: "lifecycle:session_start",
    properties: {
      cli_command: "start",
      ...buildPayload({
        preBuild,
        schemaBuild,
        indexingBuild: indexingBuildResult.result,
      }),
    },
  });

  run({
    common,
    database,
    preBuild,
    schemaBuild,
    indexingBuild: indexingBuildResult.result,
    onFatalError: () => {
      exit({ reason: "Received fatal error", code: 1 });
    },
    onReloadableError: () => {
      exit({ reason: "Encountered indexing error", code: 1 });
    },
  });

  runServer({
    common,
    database,
    apiBuild: apiBuildResult.result,
  });

  return shutdown.kill;
}
