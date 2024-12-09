import type { IndexingBuild } from "@/build/index.js";
import { runCodegen } from "@/common/codegen.js";
import type { Common } from "@/common/common.js";
import type { Database } from "@/database/index.js";
import { createHistoricalIndexingStore } from "@/indexing-store/historical.js";
import { getMetadataStore } from "@/indexing-store/metadata.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { createIndexingService } from "@/indexing/index.js";
import { createSyncStore } from "@/sync-store/index.js";
import type { Event } from "@/sync/events.js";
import { decodeEvents } from "@/sync/events.js";
import { type RealtimeEvent, createSync, splitEvents } from "@/sync/index.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { never } from "@/utils/never.js";
import { createQueue } from "@ponder/common";

/** Starts the sync and indexing services for the specified build. */
export async function run({
  common,
  build,
  database,
  onFatalError,
  onReloadableError,
}: {
  common: Common;
  build: IndexingBuild;
  database: Database;
  onFatalError: (error: Error) => void;
  onReloadableError: (error: Error) => void;
}) {
  const {
    instanceId,
    networks,
    sources,
    schema,
    indexingFunctions,
    graphqlSchema,
  } = build;

  let isKilled = false;

  const { checkpoint: initialCheckpoint } = await database.setup();

  const syncStore = createSyncStore({
    common,
    db: database.qb.sync,
  });

  const metadataStore = getMetadataStore({
    db: database.qb.user,
    instanceId,
  });

  // This can be a long-running operation, so it's best to do it after
  // starting the server so the app can become responsive more quickly.
  await database.migrateSync();

  runCodegen({ common, graphqlSchema });

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
          // Events must be run block-by-block, so that `database.complete` can accurately
          // update the temporary `checkpoint` value set in the trigger.
          for (const events of splitEvents(event.events)) {
            const result = await handleEvents(
              decodeEvents(common, sources, events),
              event.checkpoint,
            );

            if (result.status === "error") onReloadableError(result.error);

            // Set reorg table `checkpoint` column for newly inserted rows.
            await database.complete({ checkpoint: event.checkpoint });
          }

          await metadataStore.setStatus(event.status);

          break;
        }
        case "reorg":
          await database.removeTriggers();
          await database.revert({ checkpoint: event.checkpoint });
          await database.createTriggers();

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
  });

  const historicalIndexingStore = createHistoricalIndexingStore({
    common,
    database,
    schema,
    initialCheckpoint,
  });

  indexingService.setIndexingStore(historicalIndexingStore);

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
    let lastFlush = Date.now();

    // Run historical indexing until complete.
    for await (const { events, checkpoint } of sync.getEvents()) {
      end = checkpoint;

      const result = await handleEvents(
        decodeEvents(common, sources, events),
        checkpoint,
      );

      // Persist the indexing store to the db if it is too full. The `finalized`
      // checkpoint is used as a mutex. Any rows in the reorg table that may
      // have been written because of raw sql access are deleted. Also must truncate
      // the reorg tables that may have been written because of raw sql access.
      if (
        (historicalIndexingStore.isCacheFull() && events.length > 0) ||
        (common.options.command === "dev" &&
          lastFlush + 5_000 < Date.now() &&
          events.length > 0)
      ) {
        await database.finalize({
          checkpoint: encodeCheckpoint(zeroCheckpoint),
        });
        await historicalIndexingStore.flush();
        await database.complete({
          checkpoint: encodeCheckpoint(zeroCheckpoint),
        });
        await database.finalize({
          checkpoint: events[events.length - 1]!.checkpoint,
        });
        lastFlush = Date.now();
      }

      await metadataStore.setStatus(sync.getStatus());
      if (result.status === "killed") {
        return;
      } else if (result.status === "error") {
        onReloadableError(result.error);
        return;
      }
    }

    if (isKilled) return;

    // Persist the indexing store to the db. The `finalized`
    // checkpoint is used as a mutex. Any rows in the reorg table that may
    // have been written because of raw sql access are deleted. Also must truncate
    // the reorg tables that may have been written because of raw sql access.

    await database.finalize({ checkpoint: encodeCheckpoint(zeroCheckpoint) });
    await historicalIndexingStore.flush();
    await database.complete({ checkpoint: encodeCheckpoint(zeroCheckpoint) });
    await database.finalize({ checkpoint: sync.getFinalizedCheckpoint() });

    // Manually update metrics to fix a UI bug that occurs when the end
    // checkpoint is between the last processed event and the finalized
    // checkpoint.
    const start = sync.getStartCheckpoint();
    common.metrics.ponder_indexing_completed_seconds.set(
      decodeCheckpoint(end ?? start).blockTimestamp -
        decodeCheckpoint(start).blockTimestamp,
    );
    common.metrics.ponder_indexing_total_seconds.set(
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

    await database.createIndexes();
    await database.createLiveViews();
    await database.createTriggers();

    indexingService.setIndexingStore(
      createRealtimeIndexingStore({
        database,
        schema,
        common,
      }),
    );

    await sync.startRealtime();

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
    await database.unlock();
  };
}
