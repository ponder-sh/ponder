import path from "node:path";
import { createBuildService } from "@/build/index.js";
import { LoggerService } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { buildPayload, createTelemetry } from "@/common/telemetry.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { NamespaceInfo } from "@/database/service.js";
import { getReadIndexingStore } from "@/indexing-store/readStore.js";
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
  const telemetry = createTelemetry({ options, logger });
  const common = { options, logger, metrics, telemetry };

  const buildService = await createBuildService({ common });

  let cleanupReloadable = () => Promise.resolve();

  const cleanup = async () => {
    await cleanupReloadable();
    await telemetry.kill();
  };

  const shutdown = setupShutdown({ common, cleanup });

  const initialResult = await buildService.start({ watch: false });
  // Once we have the initial build, we can kill the build service.
  await buildService.kill();

  if (initialResult.status === "error") {
    await shutdown({ reason: "Failed intial build", code: 1 });
    return cleanup;
  }

  telemetry.record({
    name: "lifecycle:session_start",
    properties: { cli_command: "serve", ...buildPayload(initialResult.build) },
  });

  const { databaseConfig, schema, graphqlSchema } = initialResult.build;

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
  });

  const indexingStore = getReadIndexingStore({
    kind: "postgres",
    schema,
    // Note: `ponder serve` serves data from the `publishSchema`. Also, it does
    // not need the other fields in NamespaceInfo because it only uses findUnique
    // and findMany. We should ultimately add a PublicStore interface for this.
    namespaceInfo: {
      userNamespace: databaseConfig.publishSchema,
    } as unknown as NamespaceInfo,
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
