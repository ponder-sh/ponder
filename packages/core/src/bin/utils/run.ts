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
  isCheckpointGreaterThan,
  isCheckpointGreaterThanOrEqualTo,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { neva } from "@/utils/neva.js";
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

  const handleCheckpoint = async (newCheckpoint: Checkpoint) => {
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
      const events = decodeEvents(indexingService, rawEvents);
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
  };

  const handleReorg = async (safeCheckpoint: Checkpoint) => {
    // No-op if realtime indexing hasn't started
    if (isCheckpointGreaterThan(finalizedCheckpoint, checkpoint)) return;

    // TODO(kyle) "checkpoint" is confusing
    // TODO(kyle) move this to database service
    await indexingStore.revert({ checkpoint: safeCheckpoint });
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
          neva(syncEvent);
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

  const finalizedCheckpoint = await syncService.start();

  return async () => {
    runQueue.pause();
    runQueue.clear();
    kill(indexingService);
    await serverService.kill();
    await syncService.kill();
    await database.kill();
  };
}
