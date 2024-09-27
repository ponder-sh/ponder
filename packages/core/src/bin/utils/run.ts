import type { IndexingBuild } from "@/build/index.js";
import type { Common } from "@/common/common.js";
import { createDatabase } from "@/database/index.js";
import { getMetadataStore } from "@/indexing-store/metadata.js";
import { createIndexingService } from "@/indexing/index.js";
import { createSyncStore } from "@/sync-store/index.js";
import type { Event } from "@/sync/events.js";
import { decodeEvents } from "@/sync/events.js";
import { type RealtimeEvent, createSync } from "@/sync/index.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { never } from "@/utils/never.js";
import { createQueue } from "@ponder/common";

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
    networks,
    sources,
    schema,
    indexingFunctions,
  } = build;

  let isKilled = false;

  const database = await createDatabase({
    common,
    schema,
    databaseConfig,
  });
  const { checkpoint: initialCheckpoint } = await database.setup({
    buildId,
  });

  const syncStore = createSyncStore({
    common,
    db: database.qb.sync,
    dialect: database.dialect,
  });

  const metadataStore = getMetadataStore({
    db: database.qb.user,
  });

  // This can be a long-running operation, so it's best to do it after
  // starting the server so the app can become responsive more quickly.
  await database.migrateSync();

  // runCodegen({ common, graphqlSchema });

  // Note: can throw
  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    // Note: this is not great because it references the
    // `realtimeQueue` which isn't defined yet
    onRealtimeEvent: (realtimeEvent) => {
      return realtimeQueue.add(realtimeEvent);
    },
    onFatalError,
    initialCheckpoint,
  });

  const handleEvents = async (events: Event[], checkpoint: string) => {
    if (events.length === 0) return { status: "success" } as const;

    indexingService.updateTotalSeconds(decodeCheckpoint(checkpoint));

    return await indexingService.processEvents({ events });
  };

  const realtimeQueue = createQueue({
    initialStart: true,
    browser: false,
    concurrency: 1,
    worker: async (event: RealtimeEvent) => {
      switch (event.type) {
        case "block": {
          /**
           * Note: `status` should be assigned before any other
           * synchronous statements in order to prevent race conditions and
           * ensure its correctness.
           */
          const status = sync.getStatus();

          const result = await handleEvents(
            decodeEvents(common, sources, event.events),
            event.checkpoint,
          );

          if (result.status === "error") onReloadableError(result.error);

          await metadataStore.setStatus(status);

          break;
        }
        case "reorg":
          await database.revert({ checkpoint: event.checkpoint });
          break;

        case "finalize":
          await database.finalize({ checkpoint: event.checkpoint });
          break;

        default:
          never(event);
      }
    },
  });

  const indexingService = createIndexingService({
    indexingFunctions,
    common,
    sources,
    networks,
    sync,
    database,
  });

  await metadataStore.setStatus(sync.getStatus());

  const start = async () => {
    // If the initial checkpoint is zero, we need to run setup events.
    if (encodeCheckpoint(zeroCheckpoint) === initialCheckpoint) {
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

    // Track the last processed checkpoint, used to set metrics
    let end: string | undefined;

    // Run historical indexing until complete.
    for await (const { events, checkpoint } of sync.getEvents()) {
      end = checkpoint;

      const result = await handleEvents(
        decodeEvents(common, sources, events),
        checkpoint,
      );
      await metadataStore.setStatus(sync.getStatus());
      if (result.status === "killed") {
        return;
      } else if (result.status === "error") {
        onReloadableError(result.error);
        return;
      }
    }

    if (isKilled) return;

    // await historicalStore.flush({ isFullFlush: true });

    // Manually update metrics to fix a UI bug that occurs when the end
    // checkpoint is between the last processed event and the finalized
    // checkpoint.
    const start = sync.getStartCheckpoint();
    common.metrics.ponder_indexing_completed_seconds.set(
      decodeCheckpoint(end ?? start).blockTimestamp -
        decodeCheckpoint(start).blockTimestamp,
    );
    common.metrics.ponder_indexing_completed_timestamp.set(
      decodeCheckpoint(end ?? start).blockTimestamp,
    );

    // Become healthy
    common.logger.info({
      service: "indexing",
      msg: "Completed historical indexing",
    });

    await database.finalize({ checkpoint: sync.getFinalizedCheckpoint() });

    database.drizzle.mode = "realtime";

    // await database.createIndexes({ schema });

    sync.startRealtime();

    await metadataStore.setStatus(sync.getStatus());

    common.logger.info({
      service: "server",
      msg: "Started responding as healthy",
    });
  };

  const startPromise = start();

  return async () => {
    isKilled = true;
    indexingService.kill();
    await sync.kill();
    realtimeQueue.pause();
    realtimeQueue.clear();
    await realtimeQueue.onIdle();
    await startPromise;
    await database.kill();
  };
}
