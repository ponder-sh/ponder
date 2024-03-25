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
import { createServer, killServer, setHealthy } from "@/server/service.js";
import { PostgresSyncStore } from "@/sync-store/postgres/store.js";
import { SqliteSyncStore } from "@/sync-store/sqlite/store.js";
import type { SyncStore } from "@/sync-store/store.js";
import { SyncService } from "@/sync/service.js";
import { isCheckpointGreaterThanOrEqualTo } from "@/utils/checkpoint.js";

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

  const server = createServer({ common, graphqlSchema, indexingStore });

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

  const finalizedCheckpoint = await syncService.start();

  let isHealthy = false;
  indexingService.onSerial("eventsProcessed", async ({ toCheckpoint }) => {
    if (isHealthy) return;

    if (isCheckpointGreaterThanOrEqualTo(toCheckpoint, finalizedCheckpoint)) {
      isHealthy = true;
      await database.publish();
      setHealthy(server);
      common.logger.info({ service: "server", msg: "Responding as healthy" });
    }
  });

  await indexingService.start({
    indexingFunctions,
    schema,
    tableAccess,
    tableIds,
    functionIds,
  });

  indexingService.processEvents();

  return async () => {
    await killServer(server);
    await syncService.kill();
    await indexingService.kill();
    indexingStore.kill();
    syncStore.kill();
    await database.kill();
  };
}
