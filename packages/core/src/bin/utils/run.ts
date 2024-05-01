import type { Build } from "@/build/index.js";
import { runCodegen } from "@/common/codegen.js";
import type { Common } from "@/common/common.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { DatabaseService, NamespaceInfo } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import { getHistoricalStore } from "@/indexing-store/historical.js";
import { getReadonlyStore } from "@/indexing-store/readonly.js";
import { getRealtimeStore } from "@/indexing-store/realtime.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { createIndexingService } from "@/indexing/index.js";
import { createServer } from "@/server/service.js";
import { PostgresSyncStore } from "@/sync-store/postgres/store.js";
import { SqliteSyncStore } from "@/sync-store/sqlite/store.js";
import type { SyncStore } from "@/sync-store/store.js";
import type { Event } from "@/sync/events.js";
import { decodeEvents } from "@/sync/events.js";
import { createSyncService } from "@/sync/index.js";
import {
  type Checkpoint,
  isCheckpointEqual,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { never } from "@/utils/never.js";
import { createQueue } from "@ponder/common";

export type RealtimeEvent =
  | {
      type: "newEvents";
      fromCheckpoint: Checkpoint;
      toCheckpoint: Checkpoint;
    }
  | {
      type: "reorg";
      safeCheckpoint: Checkpoint;
    }
  | {
      type: "finalize";
      checkpoint: Checkpoint;
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
  let initialCheckpoint: Checkpoint;

  if (databaseConfig.kind === "sqlite") {
    const { directory } = databaseConfig;
    database = new SqliteDatabaseService({ common, directory });
    [namespaceInfo, initialCheckpoint] = await database
      .setup({ schema, buildId })
      .then(({ namespaceInfo, checkpoint }) => [namespaceInfo, checkpoint]);

    syncStore = new SqliteSyncStore({ db: database.syncDb });
  } else {
    const { poolConfig, schema: userNamespace, publishSchema } = databaseConfig;
    database = new PostgresDatabaseService({
      common,
      poolConfig,
      userNamespace,
      publishSchema,
    });
    [namespaceInfo, initialCheckpoint] = await database
      .setup({ schema, buildId })
      .then(({ namespaceInfo, checkpoint }) => [namespaceInfo, checkpoint]);

    syncStore = new PostgresSyncStore({ db: database.syncDb });
  }

  const readonlyStore = getReadonlyStore({
    kind: database.kind,
    schema,
    namespaceInfo,
    db: database.readonlyDb,
  });

  const server = await createServer({ common, graphqlSchema, readonlyStore });

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
    onRealtimeEvent: (realtimeEvent) => {
      realtimeQueue.add(realtimeEvent);
    },
    onFatalError,
    initialCheckpoint,
  });

  const handleEvents = async (
    events: Event[],
    lastEventCheckpoint: Checkpoint | undefined,
  ) => {
    if (lastEventCheckpoint !== undefined) {
      indexingService.updateLastEventCheckpoint(lastEventCheckpoint);
    }

    if (events.length === 0) return { status: "success" } as const;

    return await indexingService.processEvents({ events });
  };

  const handleReorg = async (safeCheckpoint: Checkpoint) => {
    await database.revert({
      checkpoint: safeCheckpoint,
      namespaceInfo,
    });
  };

  const handleFinalize = async (checkpoint: Checkpoint) => {
    await database.updateFinalizedCheckpoint({ checkpoint });
  };

  const realtimeQueue = createQueue({
    initialStart: false,
    browser: false,
    concurrency: 1,
    worker: async (event: RealtimeEvent) => {
      switch (event.type) {
        case "newEvents": {
          const lastEventCheckpoint = await syncStore.getLastEventCheckpoint({
            sources: sources,
            fromCheckpoint: event.fromCheckpoint,
            toCheckpoint: event.toCheckpoint,
          });
          for await (const rawEvents of syncStore.getLogEvents({
            sources,
            fromCheckpoint: event.fromCheckpoint,
            toCheckpoint: event.toCheckpoint,
            limit: 1_000,
          })) {
            const result = await handleEvents(
              decodeEvents(syncService, rawEvents),
              lastEventCheckpoint,
            );
            if (result.status === "error") onReloadableError(result.error);
          }

          break;
        }
        case "reorg":
          await handleReorg(event.safeCheckpoint);
          break;

        case "finalize":
          await handleFinalize(event.checkpoint);
          break;

        default:
          never(event);
      }
    },
  });

  let indexingStore: IndexingStore = {
    ...getReadonlyStore({
      kind: database.kind,
      schema,
      namespaceInfo,
      db: database.indexingDb,
    }),
    ...getHistoricalStore({
      kind: database.kind,
      schema,
      namespaceInfo,
      db: database.indexingDb,
    }),
  };

  let indexingService = createIndexingService({
    indexingFunctions,
    common,
    indexingStore,
    sources,
    networks,
    syncService,
    schema,
  });

  (async () => {
    syncService.startHistorical();

    // If the initial checkpoint is zero, we need to run setup events.
    if (isCheckpointEqual(initialCheckpoint, zeroCheckpoint)) {
      const result = await indexingService.processSetupEvents({
        sources,
        networks,
      });
      if (result.status === "killed") {
        return;
      } else if (result.status === "error") {
        onReloadableError(result.error);
        return;
      }
    }

    // Run historical indexing until complete.
    for await (const {
      fromCheckpoint,
      toCheckpoint,
    } of syncService.getHistoricalCheckpoint()) {
      const lastEventCheckpoint = await syncStore.getLastEventCheckpoint({
        sources: sources,
        fromCheckpoint,
        toCheckpoint,
      });

      for await (const rawEvents of syncStore.getLogEvents({
        sources: sources,
        fromCheckpoint,
        toCheckpoint,
        limit: 1_000,
      })) {
        const result = await handleEvents(
          decodeEvents(syncService, rawEvents),
          lastEventCheckpoint,
        );

        if (result.status === "killed") {
          return;
        } else if (result.status === "error") {
          onReloadableError(result.error);
          return;
        }
      }
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

    indexingStore = {
      ...getReadonlyStore({
        kind: database.kind,
        schema,
        namespaceInfo,
        db: database.indexingDb,
      }),
      ...getRealtimeStore({
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

    await handleFinalize(syncService.finalizedCheckpoint);

    syncService.startRealtime();
    realtimeQueue.start();
  })();

  return async () => {
    realtimeQueue.pause();
    realtimeQueue.clear();
    indexingService.kill();
    await server.kill();
    await syncService.kill();
    await realtimeQueue.onIdle();
    await database.kill();
  };
}
