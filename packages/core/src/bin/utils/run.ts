import type { Build } from "@/build/service.js";
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
import { createServer } from "@/server/service.js";
import { PostgresSyncStore } from "@/sync-store/postgres/store.js";
import { SqliteSyncStore } from "@/sync-store/sqlite/store.js";
import type { SyncStore } from "@/sync-store/store.js";
import { SyncService } from "@/sync/service.js";
import {
  type Checkpoint,
  isCheckpointGreaterThan,
  isCheckpointGreaterThanOrEqualTo,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { never } from "@/utils/never.js";
import { createQueue } from "@ponder/common";

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
  let indexingStore: IndexingStore;
  let syncStore: SyncStore;

  if (databaseConfig.kind === "sqlite") {
    const { directory } = databaseConfig;
    database = new SqliteDatabaseService({ common, directory });
    const result = await database.setup({ schema, buildId });

    indexingStore = new RealtimeIndexingStore({
      kind: "sqlite",
      schema,
      namespaceInfo: result.namespaceInfo,
      db: database.indexingDb,
    });

    syncStore = new SqliteSyncStore({ db: database.syncDb });
  } else {
    const { poolConfig, schema: userNamespace, publishSchema } = databaseConfig;
    database = new PostgresDatabaseService({
      common,
      poolConfig,
      userNamespace,
      publishSchema,
    });
    const result = await database.setup({ buildId, schema });

    indexingStore = new RealtimeIndexingStore({
      kind: "postgres",
      schema,
      namespaceInfo: result.namespaceInfo,
      db: database.indexingDb,
    });

    syncStore = new PostgresSyncStore({ db: database.syncDb });
  }

  const server = await createServer({ common, graphqlSchema, indexingStore });

  // This can be a long-running operation, so it's best to do it after
  // starting the server so the app can become responsive more quickly.
  await database.migrateSyncStore();

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

    return async () => {
      kill(indexingService);
      await server.kill();
      await syncService.kill();
      await database.kill();
    };
  }

  let checkpoint: Checkpoint = zeroCheckpoint;
  let isHealthy = false;

  const handleCheckpoint = async (newCheckpoint: Checkpoint) => {
    const updateLastEventPromise = syncStore
      .getLastEventCheckpoint({
        sources,
        fromCheckpoint: checkpoint,
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
      if (rawEvents.length === 0) break;

      const events = decodeEvents(indexingService, rawEvents);
      const result = await processEvents(indexingService, {
        events,
      });

      if (result.status === "error") {
        onReloadableError(result.error);
        return;
      } else if (indexingService.isKilled) {
        return;
      }
    }

    await updateLastEventPromise;

    checkpoint = newCheckpoint;

    if (
      !isHealthy &&
      isCheckpointGreaterThanOrEqualTo(checkpoint, finalizedCheckpoint)
    ) {
      isHealthy = true;

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
    }

    // TODO(kyle) update per network checkpoint
  };

  const handleReorg = async (safeCheckpoint: Checkpoint) => {
    // No-op if realtime indexing hasn't started
    if (isCheckpointGreaterThan(finalizedCheckpoint, checkpoint)) return;

    await indexingStore.revert({
      checkpoint: safeCheckpoint,
      isCheckpointSafe: true,
    });
    checkpoint = safeCheckpoint;
    await handleCheckpoint(syncService.checkpoint);
  };

  type SyncEvent =
    | {
        type: "checkpoint";
        newCheckpoint: Checkpoint;
      }
    | {
        type: "reorg";
        safeCheckpoint: Checkpoint;
      };

  const runQueue = createQueue({
    initialStart: true,
    browser: false,
    concurrency: 1,
    worker: async (syncEvent: SyncEvent) => {
      switch (syncEvent.type) {
        case "checkpoint":
          await handleCheckpoint(syncEvent.newCheckpoint);
          break;

        case "reorg":
          await handleReorg(syncEvent.safeCheckpoint);
          break;

        default:
          never(syncEvent);
      }
    },
  });

  syncService.on("checkpoint", async (newCheckpoint) =>
    runQueue.add({
      type: "checkpoint",
      newCheckpoint,
    }),
  );

  syncService.on("reorg", async (safeCheckpoint) =>
    runQueue.add({
      type: "reorg",
      safeCheckpoint,
    }),
  );

  syncService.on("fatal", onFatalError);

  // start sync
  const finalizedCheckpoint = await syncService.start();

  return async () => {
    runQueue.pause();
    runQueue.clear();
    kill(indexingService);
    await server.kill();
    await syncService.kill();
    await database.kill();
  };
}
