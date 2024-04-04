import { type Build } from "@/build/service.js";
import { runCodegen } from "@/common/codegen.js";
import type { Common } from "@/common/common.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { DatabaseService } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import { RealtimeIndexingStore } from "@/indexing-store/realtimeStore.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { decodeEvents } from "@/indexing/events.js";
import {
  createIndexingService,
  kill,
  processEvents,
  processSetupEvents,
  updateLastEventCheckpoint,
} from "@/indexing/service.js";
import { ServerService } from "@/server/service.js";
import { PostgresSyncStore } from "@/sync-store/postgres/store.js";
import { SqliteSyncStore } from "@/sync-store/sqlite/store.js";
import type { SyncStore } from "@/sync-store/store.js";
import { SyncService } from "@/sync/service.js";
import {
  type Checkpoint,
  isCheckpointGreaterThanOrEqualTo,
  zeroCheckpoint,
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
    appId,
  } = build;

  let database: DatabaseService;
  let indexingStore: IndexingStore;
  let syncStore: SyncStore;

  if (databaseConfig.kind === "sqlite") {
    const { directory } = databaseConfig;
    database = new SqliteDatabaseService({ common, directory });
    const result = await database.setup({ schema, appId });

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

  const indexingService = createIndexingService({
    indexingFunctions,
    common,
    indexingStore,
    sources,
    networks,
    syncService,
    schema,
  });

  // process setup events
  const result = await processSetupEvents(indexingService, {
    sources,
    networks,
  });
  if (result.status === "error") {
    onReloadableError(result.error);
  }

  let checkpoint: Checkpoint = zeroCheckpoint;

  // TODO(kyle) only one runs at a time
  syncService.onSerial("checkpoint", async (newCheckpoint) => {
    const updateLastEventPromise = syncStore
      .getLastEventCheckpoint({
        sources,
        toCheckpoint: newCheckpoint,
      })
      .then((lastEventCheckpoint) => {
        if (lastEventCheckpoint !== undefined)
          updateLastEventCheckpoint(indexingService, lastEventCheckpoint);
      });

    for await (const rawEvents of syncService.getEvents({
      sources,
      fromCheckpoint: checkpoint,
      toCheckpoint: newCheckpoint,
      limit: 1_000,
    })) {
      const events = decodeEvents(rawEvents, indexingService.sourceById);
      const result = await processEvents(indexingService, {
        events,
      });

      if (result.status === "error") {
        onReloadableError(result.error);
        break;
      } else if (indexingService.isKilled) {
        break;
      }
    }

    await updateLastEventPromise;

    checkpoint = newCheckpoint;

    let isHealthy = false;
    if (
      !isHealthy &&
      isCheckpointGreaterThanOrEqualTo(checkpoint, finalizedCheckpoint)
    ) {
      isHealthy = true;
      serverService.setIsHealthy(true);
      common.logger.info({ service: "server", msg: "Responding as healthy" });
    }

    // TODO(kyle) update per network checkpoint
  });

  // TODO(kyle) reorg
  // syncService.on("reorg", async (checkpoint) => {
  //   await indexingService.handleReorg(checkpoint);
  //   await indexingService.processEvents();
  // });

  syncService.on("fatal", onFatalError);

  const finalizedCheckpoint = await syncService.start();

  return async () => {
    kill(indexingService);
    await serverService.kill();
    await syncService.kill();
    await database.kill();
  };
}
