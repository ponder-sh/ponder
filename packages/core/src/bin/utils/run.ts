import type { IndexingBuild } from "@/build/index.js";
import { runCodegen } from "@/common/codegen.js";
import type { Common } from "@/common/common.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { DatabaseService, NamespaceInfo } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import { getHistoricalStore } from "@/indexing-store/historical.js";
import { getMetadataStore } from "@/indexing-store/metadata.js";
import { getReadonlyStore } from "@/indexing-store/readonly.js";
import { getRealtimeStore } from "@/indexing-store/realtime.js";
import type { IndexingStore, Status } from "@/indexing-store/store.js";
import { createIndexingService } from "@/indexing/index.js";
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
 * Starts the sync and indexing services for the specified build.
 */
export async function run({
  common,
  build,
  onFatalError,
  onReloadableError,
}: {
  common: Common;
  build: IndexingBuild;
  onFatalError: (error: Error) => void;
  onReloadableError: (error: Error) => void;
}) {
  const {
    buildId,
    databaseConfig,
    optionsConfig,
    networks,
    sources,
    graphqlSchema,
    schema,
    indexingFunctions,
  } = build;

  common.options = { ...common.options, ...optionsConfig };

  let database: DatabaseService;
  let syncStore: SyncStore;
  let namespaceInfo: NamespaceInfo;
  let initialCheckpoint: Checkpoint;

  const status: Status = {};
  for (const network of networks) {
    status[network.name] = {
      ready: false,
      block: null,
    };
  }

  if (databaseConfig.kind === "sqlite") {
    const { directory } = databaseConfig;
    database = new SqliteDatabaseService({ common, directory });
    [namespaceInfo, initialCheckpoint] = await database
      .setup({ schema, buildId })
      .then(({ namespaceInfo, checkpoint }) => [namespaceInfo, checkpoint]);

    syncStore = new SqliteSyncStore({ db: database.syncDb, common });
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

    syncStore = new PostgresSyncStore({ db: database.syncDb, common });
  }

  const metadataStore = getMetadataStore({
    encoding: database.kind,
    namespaceInfo,
    db: database.indexingDb,
  });

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

  const handleEvents = async (events: Event[], toCheckpoint: Checkpoint) => {
    indexingService.updateTotalSeconds(toCheckpoint);

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
    initialStart: true,
    browser: false,
    concurrency: 1,
    worker: async (event: RealtimeEvent) => {
      switch (event.type) {
        case "newEvents": {
          // Note: statusBlocks should be assigned before any other
          // asynchronous statements in order to prevent race conditions and
          // ensure its correctness.
          const statusBlocks = syncService.getStatusBlocks(event.toCheckpoint);

          for await (const rawEvents of syncStore.getEvents({
            sources,
            fromCheckpoint: event.fromCheckpoint,
            toCheckpoint: event.toCheckpoint,
          })) {
            const result = await handleEvents(
              decodeEvents(syncService, rawEvents),
              event.toCheckpoint,
            );
            if (result.status === "error") onReloadableError(result.error);
          }

          // set status to most recently processed realtime block or end block
          // for each chain.
          for (const network of networks) {
            if (statusBlocks[network.name] !== undefined) {
              status[network.name]!.block = statusBlocks[network.name]!;
            }
          }

          await metadataStore.setStatus(status);

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

  const readonlyStore = getReadonlyStore({
    encoding: database.kind,
    schema,
    namespaceInfo,
    db: database.indexingDb,
    common,
  });

  const historicalStore = getHistoricalStore({
    encoding: database.kind,
    schema,
    readonlyStore,
    namespaceInfo,
    db: database.indexingDb,
    common,
    isCacheExhaustive: isCheckpointEqual(zeroCheckpoint, initialCheckpoint),
  });

  let indexingStore: IndexingStore = historicalStore;

  const indexingService = createIndexingService({
    indexingFunctions,
    common,
    indexingStore,
    sources,
    networks,
    syncService,
    schema,
  });

  const start = async () => {
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
      for await (const rawEvents of syncStore.getEvents({
        sources: sources,
        fromCheckpoint,
        toCheckpoint,
      })) {
        const result = await handleEvents(
          decodeEvents(syncService, rawEvents),
          toCheckpoint,
        );

        if (result.status === "killed") {
          return;
        } else if (result.status === "error") {
          onReloadableError(result.error);
          return;
        }
      }
    }

    await historicalStore.flush({ isFullFlush: true });

    // Manually update metrics to fix a UI bug that occurs when the end
    // checkpoint is between the last processed event and the finalized
    // checkpoint.
    common.metrics.ponder_indexing_completed_seconds.set(
      syncService.checkpoint.blockTimestamp -
        syncService.startCheckpoint.blockTimestamp,
    );
    common.metrics.ponder_indexing_completed_timestamp.set(
      syncService.checkpoint.blockTimestamp,
    );

    // Become healthy
    common.logger.info({
      service: "indexing",
      msg: "Completed historical indexing",
    });

    if (database.kind === "postgres") {
      await database.publish();
    }
    await handleFinalize(syncService.finalizedCheckpoint);

    await database.createIndexes({ schema });

    indexingStore = {
      ...readonlyStore,
      ...getRealtimeStore({
        encoding: database.kind,
        schema,
        namespaceInfo,
        db: database.indexingDb,
        common,
      }),
    };

    indexingService.updateIndexingStore({ indexingStore, schema });

    syncService.startRealtime();

    // set status to ready and set blocks to most recently processed
    // or end block
    const statusBlocks = syncService.getStatusBlocks();
    for (const network of networks) {
      status[network.name] = {
        ready: true,
        block: statusBlocks[network.name] ?? null,
      };
    }

    await metadataStore.setStatus(status);

    common.logger.info({
      service: "server",
      msg: "Started responding as healthy",
    });
  };

  const startPromise = start();

  return async () => {
    indexingService.kill();
    await syncService.kill();
    realtimeQueue.pause();
    realtimeQueue.clear();
    await realtimeQueue.onIdle();
    await startPromise;
    await database.kill();
  };
}
