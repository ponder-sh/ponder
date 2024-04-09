import path from "node:path";
import { BuildService } from "@/build/service.js";
import { LoggerService } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { TelemetryService } from "@/common/telemetry.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { NamespaceInfo } from "@/database/service.js";
import { RealtimeIndexingStore } from "@/indexing-store/realtimeStore.js";
import { createServer } from "@/server/service.js";
import type { CliOptions } from "../ponder.js";
import { setupShutdown } from "../utils/shutdown.js";

export async function serve({ cliOptions }: { cliOptions: CliOptions }) {
  const options = buildOptions({ cliOptions });

  const logger = new LoggerService({
    level: options.logLevel,
    dir: options.logDir,
  });

  const [major, minor, _patch] = process.versions.node.split(".").map(Number);
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
  const telemetry = new TelemetryService({ options });
  const common = { options, logger, metrics, telemetry };

  const buildService = new BuildService({ common });
  await buildService.setup({ watch: false });

  let cleanupReloadable = () => Promise.resolve();

  const cleanup = async () => {
    await cleanupReloadable();
    await telemetry.kill();
  };

  const shutdown = setupShutdown({ common, cleanup });

  const initialResult = await buildService.initialLoad();
  // Once we have the initial build, we can kill the build service.
  await buildService.kill();

  if (!initialResult.success) {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  telemetry.record({
    event: "App Started",
    properties: {
      command: "ponder serve",
      contractCount: initialResult.build.sources.length,
      databaseKind: initialResult.build.databaseConfig.kind,
    },
  });

  const { databaseConfig, schema, graphqlSchema } = initialResult.build;

  if (databaseConfig.kind === "sqlite") {
    await shutdown({
      reason: "The 'ponder serve' command does not support SQLite",
      code: 1,
    });
    return cleanup;
  }

  const { poolConfig, schema: userNamespace } = databaseConfig;
  const database = new PostgresDatabaseService({
    common,
    poolConfig,
    userNamespace,
  });

  const indexingStore = new RealtimeIndexingStore({
    kind: "postgres",
    schema,
    // Note: `ponder serve` only uses findUnique and findMany, which only
    // use the user namespace tables. Eventually, they should probably be
    // in their own PublicStore class.
    namespaceInfo: { userNamespace } as unknown as NamespaceInfo,
    db: database.indexingDb,
  });

  const server = await createServer({ graphqlSchema, indexingStore, common });
  server.setHealthy();

  cleanupReloadable = async () => {
    await server.kill();
    await database.kill();
  };

  return cleanup;
}
