import { runCodegen } from "@/bin/utils/codegen.js";
import { createBuild } from "@/build/index.js";
import { type Database, createDatabase } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { buildPayload, createTelemetry } from "@/internal/telemetry.js";
import type {
  ApiBuild,
  CrashRecoveryCheckpoint,
  IndexingBuild,
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
} from "@/internal/types.js";
import { runMultichain } from "@/runtime/multichain.js";
import { runOmnichain } from "@/runtime/omnichain.js";
import { createServer } from "@/server/index.js";
import { isolatedController } from "../isolatedController.js";
import type { CliOptions } from "../ponder.js";
import { createExit } from "../utils/exit.js";

export type PonderApp = {
  common: Common;
  preBuild: PreBuild;
  namespaceBuild: NamespaceBuild;
  schemaBuild: SchemaBuild;
  indexingBuild: IndexingBuild;
  apiBuild: ApiBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  database: Database;
};

export async function start({
  cliOptions,
  onBuild,
}: {
  cliOptions: CliOptions;
  onBuild?: (app: PonderApp) => Promise<PonderApp>;
}) {
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
  const exit = createExit({ common, options });

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

  // biome-ignore lint/style/useConst: <explanation>
  let database: Database | undefined;

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
      stage: "config",
      error: configBuildResult.error,
    });
    await exit({ code: 1 });
    return;
  }

  const rpcDiagnosticResult = await build.rpcDiagnostic({
    configBuild: configBuildResult.result,
  });
  if (rpcDiagnosticResult.status === "error") {
    common.logger.error({
      msg: "Build failed",
      stage: "diagnostic",
      error: rpcDiagnosticResult.error,
    });
    await exit({ code: 75 });
    return;
  }

  const indexingResult = await build.executeIndexingFunctions();
  if (indexingResult.status === "error") {
    common.logger.error({
      msg: "Build failed",
      stage: "indexing",
      error: indexingResult.error,
    });
    await exit({ code: 1 });
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
    await exit({ code: 1 });
    return;
  }

  database = createDatabase({
    common,
    namespace: namespaceResult.result,
    preBuild: preCompileResult.result,
    schemaBuild: compileSchemaResult.result,
  });
  const crashRecoveryCheckpoint = await database.migrate({
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
      cli_command: "start",
      ...buildPayload({
        preBuild: preCompileResult.result,
        schemaBuild: compileSchemaResult.result,
        indexingBuild: indexingBuildResult.result,
      }),
    },
  });

  metrics.ponder_settings_info.set(
    {
      ordering: preCompileResult.result.ordering,
      database: preCompileResult.result.databaseConfig.kind,
      command: cliOptions.command,
    },
    1,
  );

  let app: PonderApp = {
    common,
    preBuild: preCompileResult.result,
    namespaceBuild: namespaceResult.result,
    schemaBuild: compileSchemaResult.result,
    indexingBuild: indexingBuildResult.result,
    apiBuild: apiBuildResult.result,
    crashRecoveryCheckpoint,
    database,
  };

  if (onBuild) {
    app = await onBuild(app);
  }

  metrics.initializeIndexingMetrics(app);

  switch (preCompileResult.result.ordering) {
    case "omnichain":
      runOmnichain(app);
      break;
    case "multichain":
      runMultichain(app);
      break;
    case "experimental_isolated": {
      isolatedController(app);
      break;
    }
  }

  createServer(app);

  return shutdown.kill;
}
