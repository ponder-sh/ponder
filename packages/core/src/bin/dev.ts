import { existsSync } from "node:fs";
import path from "node:path";
import { type Build, type BuildResult, BuildService } from "@/build/service.js";
import { codegen } from "@/common/codegen.js";
import type { Common } from "@/common/common.js";
import { LoggerService } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { type Options } from "@/common/options.js";
import { TelemetryService } from "@/common/telemetry.js";
import { type DatabaseConfig } from "@/config/database.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { DatabaseService } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import { PostgresIndexingStore } from "@/indexing-store/postgres/store.js";
import { SqliteIndexingStore } from "@/indexing-store/sqlite/store.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { IndexingService } from "@/indexing/service.js";
import { ServerService } from "@/server/service.js";
import { PostgresSyncStore } from "@/sync-store/postgres/store.js";
import { SqliteSyncStore } from "@/sync-store/sqlite/store.js";
import type { SyncStore } from "@/sync-store/store.js";
import { SyncService } from "@/sync/service.js";
import { UiService } from "@/ui/service.js";
import { createQueue } from "@ponder/common";

export async function devFromCli({
  options,
  databaseConfigOverride,
}: { options: Options; databaseConfigOverride?: DatabaseConfig }) {
  const { logLevel, logDir } = options;
  const logger = new LoggerService({ level: logLevel, dir: logDir });
  const metrics = new MetricsService();
  const telemetry = new TelemetryService({ options });
  const common = { options, logger, metrics, telemetry };

  const dotEnvPath = path.join(common.options.rootDir, ".env.local");
  if (existsSync(dotEnvPath)) {
    // TODO: Load .env.local here.
  } else {
    common.logger.warn({
      service: "app",
      msg: "Local environment file (.env.local) not found",
    });
  }

  common.logger.debug({
    service: "app",
    msg: `Started using config file: ${path.relative(
      common.options.rootDir,
      common.options.configFile,
    )}`,
  });

  // Initialize the Vite server and Vite Node runner.
  const buildService = new BuildService({ common });
  await buildService.setup({ watch: true });

  // Initialize the UI service.
  const uiService = new UiService({ common });

  // TODO make better
  let cleanup = () => Promise.resolve();

  // Set up the shutdown handler.
  let isShuttingDown = false;
  const shutdown = async (reason: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    setTimeout(() => {
      common.logger.fatal({
        service: "process",
        msg: "Failed to shutdown within 5 seconds, terminating (exit code 1)",
      });
      process.exit(1);
    }, 5_000);

    common.logger.warn({
      service: "process",
      msg: `${reason}, starting shutdown sequence`,
    });
    common.telemetry.record({
      event: "App Killed",
      properties: { processDuration: process.uptime() },
    });

    await cleanup();
    await buildService.kill();
    await common.telemetry.kill();
    uiService.kill();

    common.logger.fatal({
      service: "process",
      msg: "Finished shutdown sequence, terminating (exit code 0)",
    });

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("Received SIGINT"));
  process.on("SIGTERM", () => shutdown("Received SIGINT"));
  process.on("uncaughtException", (error: Error) => {
    common.logger.error({
      service: "process",
      msg: "Caught uncaughtException event with error:",
      error,
    });
    shutdown("Received uncaughtException");
  });
  process.on("unhandledRejection", (error: Error) => {
    common.logger.error({
      service: "process",
      msg: "Caught unhandledRejection event with error:",
      error,
    });
    shutdown("Received unhandledRejection");
  });

  // Build and load user code once on startup.
  const initialResult = await buildService.initialLoad();
  if (initialResult.error) {
    common.logger.error({
      service: "process",
      msg: "Failed initial build with error:",
      error: initialResult.error,
    });
    await shutdown("Failed intial build");
    return;
  }
  initialResult.build.databaseConfig =
    databaseConfigOverride ?? initialResult.build.databaseConfig;

  telemetry.record({
    event: "App Started",
    properties: {
      command: "ponder dev",
      contractCount: initialResult.build.sources.length,
      databaseKind: initialResult.build.databaseConfig.kind,
    },
  });

  const buildQueue = createQueue({
    initialStart: true,
    concurrency: 1,
    worker: async (result: BuildResult) => {
      await cleanup();

      if (result.success) {
        uiService.reset(result.build.sources);
        metrics.resetMetrics();

        cleanup = await start({
          common,
          onFatalError: () => {
            shutdown("Received fatal error");
          },
          onIndexingError: (error) => {
            buildQueue.clear();
            buildQueue.add({ success: false, error });
          },
          ...result.build,
        });
      } else {
        uiService.setReloadableError();
        cleanup = () => Promise.resolve();
      }
    },
  });

  buildService.on("rebuild", (build) => {
    buildQueue.clear();
    buildQueue.add(build);
  });

  buildQueue.add(initialResult);
}

async function start({
  common,
  onFatalError,
  onIndexingError,
  databaseConfig,
  networks,
  sources,
  schema,
  graphqlSchema,
  indexingFunctions,
  tableAccess,
  tableIds,
  functionIds,
}: {
  common: Common;
  onFatalError: (error: Error) => void;
  onIndexingError: (error: Error) => void;
} & Build) {
  let database: DatabaseService;
  let indexingStore: IndexingStore;
  let syncStore: SyncStore;

  if (databaseConfig.kind === "sqlite") {
    const { directory } = databaseConfig;
    database = new SqliteDatabaseService({ common, directory });
    await database.setup({ schema, tableIds, functionIds, tableAccess });

    const indexingStoreConfig = database.getIndexingStoreConfig();
    indexingStore = new SqliteIndexingStore({
      common,
      schema,
      ...indexingStoreConfig,
    });

    const syncStoreConfig = database.getSyncStoreConfig();
    syncStore = new SqliteSyncStore({ common, ...syncStoreConfig });
    await syncStore.migrateUp();
  } else {
    const { poolConfig } = databaseConfig;
    database = new PostgresDatabaseService({ common, poolConfig });
    await database.setup({ schema, tableIds, functionIds, tableAccess });

    const indexingStoreConfig = database.getIndexingStoreConfig();
    indexingStore = new PostgresIndexingStore({
      common,
      schema,
      ...indexingStoreConfig,
    });

    const syncStoreConfig = await database.getSyncStoreConfig();
    syncStore = new PostgresSyncStore({ common, ...syncStoreConfig });
    await syncStore.migrateUp();
  }

  const serverService = new ServerService({ common, indexingStore, database });
  serverService.setup({ registerDevRoutes: true });
  await serverService.start();
  serverService.reloadGraphqlSchema({ graphqlSchema });

  codegen({ common, graphqlSchema });

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const indexingService = new IndexingService({
    common,
    database,
    indexingStore,
    sources,
    networks,
    syncService,
  });

  const cleanup = async () => {
    await serverService.kill();
    await syncService.kill();
    await indexingService.kill();

    indexingStore.kill();
    syncStore.kill();
    await database.kill();
  };

  syncService.on("checkpoint", async () => {
    await indexingService.processEvents();
  });

  syncService.on("reorg", async (checkpoint) => {
    await indexingService.handleReorg(checkpoint);
    await indexingService.processEvents();
  });

  syncService.on("fatal", onFatalError);

  indexingService.on("error", onIndexingError);

  indexingService.onSerial("eventsProcessed", async ({ toCheckpoint }) => {
    if (database.isPublished) return;
    // If a batch of events are processed AND the historical sync is complete AND
    // the new toTimestamp is greater than the historical sync completion timestamp,
    // historical event processing is complete, and the server should begin responding as healthy.

    if (
      syncService.isHistoricalSyncComplete &&
      toCheckpoint.blockTimestamp >=
        syncService.finalityCheckpoint.blockTimestamp
    ) {
      await database.publish();
      common.logger.info({
        service: "server",
        msg: "Started responding as healthy",
      });
    }
  });

  await syncService.start();

  await indexingService.start({
    indexingFunctions,
    schema,
    tableAccess,
    tableIds,
    functionIds,
  });

  indexingService.processEvents();

  return cleanup;
}
