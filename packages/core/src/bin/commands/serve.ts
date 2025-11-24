import { createBuild } from "@/build/index.js";
import { SCHEMATA, createDatabase } from "@/database/index.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { buildPayload, createTelemetry } from "@/internal/telemetry.js";
import { createServer } from "@/server/index.js";
import { eq } from "drizzle-orm";
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
    logger.error({
      msg: "Invalid Node.js version",
      version: process.versions.node,
      expected: "18.14",
    });
    process.exit(1);
  }

  const metrics = new MetricsService();
  const shutdown = createShutdown();
  const telemetry = createTelemetry({ options, logger, shutdown });
  const common = {
    options,
    logger,
    metrics,
    telemetry,
    shutdown,
    buildShutdown: shutdown,
    apiShutdown: shutdown,
  };

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

  const exit = createExit({ common, options });
  const namespaceResult = build.namespaceCompile();

  if (namespaceResult.status === "error") {
    common.logger.error({
      msg: "Build failed",
      stage: "namespace",
      error: namespaceResult.error,
    });
    await exit({ code: 1 });
    return;
  }

  const configResult = await build.executeConfig();
  if (configResult.status === "error") {
    common.logger.error({
      msg: "Build failed",
      stage: "config",
      error: configResult.error,
    });
    await exit({ code: 1 });
    return;
  }

  const schemaResult = await build.executeSchema();
  if (schemaResult.status === "error") {
    common.logger.error({
      msg: "Build failed",
      stage: "schema",
      error: schemaResult.error,
    });
    await exit({ code: 1 });
    return;
  }

  const preCompileResult = build.preCompile(configResult.result);

  if (preCompileResult.status === "error") {
    common.logger.error({
      msg: "Build failed",
      stage: "pre-compile",
      error: preCompileResult.error,
    });
    await exit({ code: 1 });
    return;
  }

  if (preCompileResult.result.databaseConfig.kind === "pglite") {
    common.logger.error({
      msg: "The 'ponder serve' command does not support PGlite",
    });

    await exit({ code: 1 });
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
    await exit({ code: 75 });
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
    await exit({ code: 1 });
    return;
  }

  const configBuildResult = build.compileConfig({
    configResult: configResult.result,
  });

  if (configBuildResult.status === "error") {
    common.logger.error({
      msg: "Build failed",
      stage: "indexing",
      error: configBuildResult.error,
    });
    await exit({ code: 1 });
    return;
  }

  // Note: RPC diagnostic is skipped

  const database = createDatabase({
    common,
    namespace: namespaceResult.result,
    preBuild: preCompileResult.result,
    schemaBuild: compileSchemaResult.result,
  });

  const schemaExists = await database.adminQB
    .wrap((db) =>
      db
        .select()
        .from(SCHEMATA)
        .where(eq(SCHEMATA.schemaName, namespaceResult.result.schema)),
    )
    .then((res) => res.length > 0);

  if (schemaExists === false) {
    common.logger.error({
      msg: "Schema does not exist.",
      schema: namespaceResult.result.schema,
    });
    await exit({ code: 1 });
    return;
  }

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
    await exit({ code: 1 });
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
    await exit({ code: 1 });
    return;
  }

  telemetry.record({
    name: "lifecycle:session_start",
    properties: {
      cli_command: "serve",
      ...buildPayload({
        preBuild: preCompileResult.result,
        schemaBuild: compileSchemaResult.result,
      }),
    },
  });

  metrics.ponder_settings_info.set(
    {
      database: preCompileResult.result.databaseConfig.kind,
      command: cliOptions.command,
    },
    1,
  );

  createServer({ common, database, apiBuild: apiBuildResult.result });

  return shutdown.kill;
}
