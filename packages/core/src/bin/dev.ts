import { existsSync } from "node:fs";
import path from "node:path";
import { type BuildResult, BuildService } from "@/build/service.js";
import { codegen } from "@/common/codegen.js";
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

export type Common = {
  options: Options;
  logger: LoggerService;
  metrics: MetricsService;
  telemetry: TelemetryService;
};

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

    // Now all resources should be cleaned up. The process should exit gracefully.
    common.logger.fatal({
      service: "process",
      msg: "Finished shutdown sequence, terminating (exit code 0)",
    });

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("Received SIGINT"));
  process.on("SIGTERM", () => shutdown("Received SIGINT"));
  process.on("uncaughtException", (error) => {
    common.logger.error({ service: "process", error });
    shutdown("Received uncaughtException");
  });
  process.on("unhandledRejection", (error: Error) => {
    common.logger.error({ service: "process", error });
    shutdown("Received unhandledRejection");
  });

  // Build and load user code once on startup.
  const result = await buildService.initialLoad();
  if (result.error) {
    common.logger.error({ service: "build", error: result.error });
    await shutdown("Failed intial build");
    return;
  }
  result.databaseConfig = databaseConfigOverride ?? result.databaseConfig;

  telemetry.record({
    event: "App Started",
    properties: {
      command: "ponder dev",
      contractCount: result.sources.length,
      databaseKind: result.databaseConfig.kind,
    },
  });

  const buildQueue = createQueue({
    initialStart: true,
    concurrency: 1,
    worker: async (
      task:
        | { type: "build"; build: BuildResult }
        | { type: "error"; error: Error },
    ) => {
      await cleanup();

      if (task.type === "error") {
        cleanup = () => Promise.resolve();
      } else {
        cleanup = await start({
          common,
          onFatalError: (error) => {
            common.logger.fatal({ service: "app", error });
            shutdown("Received fatal error");
          },
          onReloadableError: (error) => {
            buildQueue.add({ type: "error", error });
          },
          ...task.build,
        });
      }
    },
  });

  buildService.on("reload", async (build) => {
    buildQueue.add({ type: "build", build });
  });

  buildService.on("error", ({ error }) => {
    buildQueue.add({ type: "error", error });
  });

  buildQueue.add({ type: "build", build: result });
}

/**
 * Two event types
 * - reload
 * -> shuts down previous stuff, runs it again
 *
 * - reloadable error (eg config validation error, indexing error)
 * -> shuts down previous stuff, sets the ui hint, waits for "reload"
 *
 * need to only handle one of these events at at time
 *
 *
 *
 * let isStarting = false
 *
 * on("reload", async () => {
 *  if (isLoading) return
 *  isLoading = true
 *  await start()
 * })
 *
 *
 *
 *
 *
 *
 *
 */

async function start({
  common,
  onFatalError,
  onReloadableError,
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
  onReloadableError: (error: Error) => void;
} & BuildResult) {
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

  const uiService = new UiService({ common, sources });

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
    uiService.kill();
    await serverService.kill();
    await syncService.kill();
    await indexingService.kill();
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

  indexingService.on("error", onReloadableError);

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
