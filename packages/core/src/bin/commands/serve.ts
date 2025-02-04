import path from "node:path";
import { createBuild } from "@/build/index.js";
import { createDatabase } from "@/database/index.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { buildPayload, createTelemetry } from "@/internal/telemetry.js";
import { createServer } from "@/server/index.js";
import { mergeResults } from "@/utils/result.js";
import type { CliOptions } from "../ponder.js";
import { createExit } from "../utils/exit.js";

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

  const build = await createBuild({ common, cliOptions });

  // let cleanupReloadable = () => Promise.resolve();

  // const cleanup = async () => {
  //   await cleanupReloadable();
  //   await telemetry.kill();
  // };

  const exit = createExit({ common });
  const namespaceResult = build.namespaceCompile();

  if (namespaceResult.status === "error") {
    await exit({
      callback: shutdown.kill,
      reason: "Failed to initialize namespace",
      code: 1,
    });
  }

  const configResult = await build.executeConfig();
  if (configResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  const schemaResult = await build.executeSchema({
    namespace: namespaceResult.result,
  });
  if (schemaResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  const buildResult1 = mergeResults([
    build.preCompile(configResult.result),
    build.compileSchema(schemaResult.result),
  ]);

  if (buildResult1.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  const [preBuild, schemaBuild] = buildResult1.result;

  if (preBuild.databaseConfig.kind === "pglite") {
    await shutdown({
      reason: "The 'ponder serve' command does not support PGlite",
      code: 1,
    });
    return cleanup;
  }

  const indexingResult = await build.executeIndexingFunctions();
  if (indexingResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  const indexingBuildResult = await build.compileIndexing({
    configResult: configResult.result,
    schemaResult: schemaResult.result,
    indexingResult: indexingResult.result,
  });

  if (indexingBuildResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  const database = await createDatabase({
    common,
    namespace: namespaceResult.result,
    preBuild,
    schemaBuild,
  });

  const apiResult = await build.executeApi({
    indexingBuild: indexingBuildResult.result,
    database,
  });
  if (apiResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  await build.kill();

  const buildResult2 = await build.compileApi({ apiResult: apiResult.result });

  if (buildResult2.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  const apiBuild = buildResult2.result;

  telemetry.record({
    name: "lifecycle:session_start",
    properties: {
      cli_command: "serve",
      ...buildPayload({
        preBuild,
        schemaBuild,
      }),
    },
  });

  const server = await createServer({
    common,
    database,
    apiBuild,
  });

  cleanupReloadable = async () => {
    await server.kill();
    await database.kill();
  };

  return cleanup;
}
