import type { Build } from "@/build/index.js";
import { runCodegen } from "@/common/codegen.js";
import type { Common } from "@/common/common.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { DatabaseService, NamespaceInfo } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import { getHistoricalIndexingStore } from "@/indexing-store/historicalStore.js";
import { getReadIndexingStore } from "@/indexing-store/readStore.js";
import { getRealtimeIndexingStore } from "@/indexing-store/realtimeStore.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { createIndexingService } from "@/indexing/index.js";
import { createServer } from "@/server/service.js";
import { PostgresSyncStore } from "@/sync-store/postgres/store.js";
import { SqliteSyncStore } from "@/sync-store/sqlite/store.js";
import type { SyncStore } from "@/sync-store/store.js";
import type { Event } from "@/sync/events.js";
import { createSyncService } from "@/sync/index.js";
import { type Checkpoint } from "@/utils/checkpoint.js";
import { never } from "@/utils/never.js";
import { createQueue } from "@ponder/common";

export type RealtimeEvent =
  | {
      type: "newEvents";
      events: Event[];
      lastEventCheckpoint: Checkpoint | undefined;
    }
  | {
      type: "reorg";
      safeCheckpoint: Checkpoint;
    };

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
    buildId,
    databaseConfig,
    networks,
    sources,
    schema,
    graphqlSchema,
    indexingFunctions,
  } = build;

  let database: DatabaseService;
  let syncStore: SyncStore;
  let namespaceInfo: NamespaceInfo;

  if (databaseConfig.kind === "sqlite") {
    const { directory } = databaseConfig;
    database = new SqliteDatabaseService({ common, directory });
    namespaceInfo = await database
      .setup({ schema, buildId })
      .then(({ namespaceInfo }) => namespaceInfo);

    syncStore = new SqliteSyncStore({ db: database.syncDb });
  } else {
    const { poolConfig, schema: userNamespace, publishSchema } = databaseConfig;
    database = new PostgresDatabaseService({
      common,
      poolConfig,
      userNamespace,
      publishSchema,
    });
    namespaceInfo = await database
      .setup({ schema, buildId })
      .then(({ namespaceInfo }) => namespaceInfo);

    syncStore = new PostgresSyncStore({ db: database.syncDb });
  }

  let indexingStore: IndexingStore = {
    ...getReadIndexingStore({
      kind: database.kind,
      schema,
      namespaceInfo,
      db: database.indexingDb,
    }),
    ...getHistoricalIndexingStore({
      kind: database.kind,
      schema,
      namespaceInfo,
      db: database.indexingDb,
    }),
  };

  const server = await createServer({ common, graphqlSchema, indexingStore });

  // This can be a long-running operation, so it's best to do it after
  // starting the server so the app can become responsive more quickly.
  await database.migrateSyncStore();

  runCodegen({ common, graphqlSchema });

  // Note: can throw
  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    // Note: this is not great because it references the
    // `realtimeQueue` which isn't defined yet
    onRealtimeEvent: (realtimeEvent) => realtimeQueue.add(realtimeEvent),
    onFatalError,
  });

  syncService.startHistorical();

  let indexingService = createIndexingService({
    indexingFunctions,
    common,
    indexingStore,
    sources,
    networks,
    syncService,
    schema,
  });

  // process setup events
  const result = await indexingService.processSetupEvents({
    sources,
    networks,
  });
  if (result.status === "error") {
    onReloadableError(result.error);

    return async () => {
      indexingService.kill();
      await server.kill();
      await syncService.kill();
      await database.kill();
    };
  }

  const handleEvents = async (
    events: Event[],
    lastEventCheckpoint: Checkpoint | undefined,
  ) => {
    if (events.length === 0) return;

    if (lastEventCheckpoint !== undefined) {
      indexingService.updateLastEventCheckpoint(lastEventCheckpoint);
    }

    const result = await indexingService.processEvents({
      events,
    });

    if (result.status === "error") {
      onReloadableError(result.error);
      return;
    } else if (indexingService.isKilled) {
      return;
    }
  };

  // Run historical indexing until complete.
  for await (const {
    events,
    lastEventCheckpoint,
  } of syncService.getHistoricalEvents()) {
    await handleEvents(events, lastEventCheckpoint);
  }

  // Become healthy
  common.logger.info({
    service: "indexing",
    msg: "Completed historical indexing",
  });

  if (database.kind === "postgres") {
    await database.publish();
  }

  server.setHealthy();
  common.logger.info({
    service: "server",
    msg: "Started responding as healthy",
  });

  const handleReorg = async (safeCheckpoint: Checkpoint) => {
    await database.revert({
      checkpoint: safeCheckpoint,
      namespaceInfo,
    });
  };

  indexingStore = {
    ...getReadIndexingStore({
      kind: database.kind,
      schema,
      namespaceInfo,
      db: database.indexingDb,
    }),
    ...getRealtimeIndexingStore({
      kind: database.kind,
      schema,
      namespaceInfo,
      db: database.indexingDb,
    }),
  };

  indexingService = createIndexingService({
    indexingFunctions,
    common,
    indexingStore,
    sources,
    networks,
    syncService,
    schema,
  });

  const realtimeQueue = createQueue({
    initialStart: true,
    browser: false,
    concurrency: 1,
    worker: async (realtimeEvent: RealtimeEvent) => {
      switch (realtimeEvent.type) {
        case "newEvents":
          await handleEvents(
            realtimeEvent.events,
            realtimeEvent.lastEventCheckpoint,
          );
          break;

        case "reorg":
          await handleReorg(realtimeEvent.safeCheckpoint);
          break;

        default:
          never(realtimeEvent);
      }
    },
  });

  syncService.startRealtime();

  return async () => {
    realtimeQueue.pause();
    realtimeQueue.clear();
    indexingService.kill();
    await syncService.kill();
    await server.kill();
    await database.kill();
  };
}
