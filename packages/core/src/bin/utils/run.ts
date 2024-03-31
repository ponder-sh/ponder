import { type Build } from "@/build/service.js";
import { runCodegen } from "@/common/codegen.js";
import type { Common } from "@/common/common.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { DatabaseService } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import { RealtimeIndexingStore } from "@/indexing-store/realtimeStore.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { IndexingService } from "@/indexing/service.js";
import { ServerService } from "@/server/service.js";
import { PostgresSyncStore } from "@/sync-store/postgres/store.js";
import { SqliteSyncStore } from "@/sync-store/sqlite/store.js";
import type { SyncStore } from "@/sync-store/store.js";
import { SyncService } from "@/sync/service.js";
import {
  type Checkpoint,
  isCheckpointGreaterThanOrEqualTo,
} from "@/utils/checkpoint.js";

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
    appId,
  } = build;

  let database: DatabaseService;
  let cachedToCheckpoint: Checkpoint;
  let indexingStore: IndexingStore;
  let syncStore: SyncStore;

  if (databaseConfig.kind === "sqlite") {
    const { directory } = databaseConfig;
    database = new SqliteDatabaseService({ common, directory });
    const result = await database.setup({ schema, appId });
    cachedToCheckpoint = result.checkpoint;

    indexingStore = new RealtimeIndexingStore({
      kind: "sqlite",
      schema,
      namespaceInfo: result.namespaceInfo,
      db: database.indexingDb,
    });

    syncStore = new SqliteSyncStore({ common, db: database.syncDb });
    await syncStore.migrateUp();
  } else {
    const { poolConfig } = databaseConfig;
    database = new PostgresDatabaseService({ common, poolConfig });
    const result = await database.setup({ schema, appId });
    cachedToCheckpoint = result.checkpoint;

    indexingStore = new RealtimeIndexingStore({
      kind: "postgres",
      schema,
      namespaceInfo: result.namespaceInfo,
      db: database.indexingDb,
    });

    syncStore = new PostgresSyncStore({ common, db: database.syncDb });
    await syncStore.migrateUp();
  }

  const serverService = new ServerService({ common, indexingStore });
  serverService.setup();
  await serverService.start();
  serverService.reloadGraphqlSchema({ graphqlSchema });

  runCodegen({ common, graphqlSchema });

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const indexingService = new IndexingService({
    common,
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
      serverService.setIsHealthy(true);
      common.logger.info({ service: "server", msg: "Responding as healthy" });
    }
  });

  await indexingService.start({
    indexingFunctions,
    schema,
    tableAccess,
    cachedToCheckpoint,
  });

  indexingService.processEvents();

  return async () => {
    await serverService.kill();
    await syncService.kill();
    await indexingService.kill();
    await database.kill();
  };
}
