import { type Build } from "@/build/service.js";
import { runCodegen } from "@/common/codegen.js";
import type { Common } from "@/common/common.js";
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

/**
 * Starts the server, sync, and indexing services for the specified build.
 */
export async function run({
  common,
  build,
  onFatalError,
  onReloadableError,
}: {
  common: Common;
  build: Build;
  onFatalError: (error: Error) => void;
  onReloadableError: (error: Error) => void;
}) {
  const {
    databaseConfig,
    networks,
    sources,
    schema,
    graphqlSchema,
    indexingFunctions,
    tableAccess,
    tableIds,
    functionIds,
  } = build;

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
  serverService.setup();
  await serverService.start();
  serverService.reloadGraphqlSchema({ graphqlSchema });

  runCodegen({ common, graphqlSchema });

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const indexingService = new IndexingService({
    common,
    database,
    indexingStore,
    sources,
    networks,
    syncService,
  });

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

  return async () => {
    await serverService.kill();
    await syncService.kill();
    await indexingService.kill();
    indexingStore.kill();
    syncStore.kill();
    await database.kill();
  };
}
