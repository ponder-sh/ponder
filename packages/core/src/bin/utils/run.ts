import { runCodegen } from "@/bin/utils/codegen.js";
import type { Database } from "@/database/index.js";
import { createHistoricalIndexingStore } from "@/indexing-store/historical.js";
import { getMetadataStore } from "@/indexing-store/metadata.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { createIndexingService } from "@/indexing/index.js";
import type { Common } from "@/internal/common.js";
import { getAppProgress } from "@/internal/metrics.js";
import type { Event, IndexingBuild, SchemaBuild } from "@/internal/types.js";
import { createSyncStore } from "@/sync-store/index.js";
import { decodeEvents } from "@/sync/events.js";
import { type RealtimeEvent, createSync, splitEvents } from "@/sync/index.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import { never } from "@/utils/never.js";
import { createQueue } from "@ponder/common";

/** Starts the sync and indexing services for the specified build. */
export async function run({
  common,
  schemaBuild,
  indexingBuild,
  database,
  onFatalError,
  onReloadableError,
}: {
  common: Common;
  schemaBuild: SchemaBuild;
  indexingBuild: IndexingBuild;
  database: Database;
  onFatalError: (error: Error) => void;
  onReloadableError: (error: Error) => void;
}) {
  let isKilled = false;

  const initialCheckpoint = await database.recoverCheckpoint();
  const syncStore = createSyncStore({ common, database });
  const metadataStore = getMetadataStore({ database });

  // This can be a long-running operation, so it's best to do it after
  // starting the server so the app can become responsive more quickly.
  await database.migrateSync();

  runCodegen({ common });

  // Note: can throw
  const sync = await createSync({
    common,
    indexingBuild,
    syncStore,
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
          for (const { checkpoint, events } of splitEvents(event.events)) {
            const result = await handleEvents(
              decodeEvents(common, indexingBuild.sources, events),
              event.checkpoint,
            );

            if (result.status === "error") onReloadableError(result.error);

            // Set reorg table `checkpoint` column for newly inserted rows.
            await database.complete({ checkpoint });
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
    common,
    indexingBuild,
    sync,
  });

  const historicalIndexingStore = createHistoricalIndexingStore({
    common,
    schemaBuild,
    database,
    initialCheckpoint,
  });

  indexingService.setIndexingStore(historicalIndexingStore);

  await metadataStore.setStatus(sync.getStatus());

  const start = async () => {
    // If the initial checkpoint is zero, we need to run setup events.
    if (encodeCheckpoint(zeroCheckpoint) === initialCheckpoint) {
      const result = await indexingService.processSetupEvents({
        sources: indexingBuild.sources,
        networks: indexingBuild.networks,
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

      const decodedEvents = decodeEvents(common, indexingBuild.sources, events);
      const result = await handleEvents(decodedEvents, checkpoint);

      // underlying metrics collection is actually synchronous
      // https://github.com/siimon/prom-client/blob/master/lib/histogram.js#L102-L125
      const { eta, progress } = await getAppProgress(common.metrics);
      if (events.length > 0) {
        if (eta === undefined || progress === undefined) {
          common.logger.info({
            service: "app",
            msg: `Indexed ${events.length} events`,
          });
        } else {
          common.logger.info({
            service: "app",
            msg: `Indexed ${events.length} events with ${formatPercentage(progress)} complete and ${formatEta(eta)} remaining`,
          });
        }
      }

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
        if (historicalIndexingStore.isCacheFull()) {
          common.logger.debug({
            service: "indexing",
            msg: `Indexing cache has exceeded ${common.options.indexingCacheMaxBytes} MB limit, starting flush`,
          });
        } else {
          common.logger.debug({
            service: "indexing",
            msg: "Dev server periodic flush triggered, starting flush",
          });
        }

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

        common.logger.debug({
          service: "indexing",
          msg: "Completed flush",
        });
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

    common.logger.debug({
      service: "indexing",
      msg: "Completed all historical events, starting final flush",
    });

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
    await database.createTriggers();

    indexingService.setIndexingStore(
      createRealtimeIndexingStore({
        common,
        schemaBuild,
        database,
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
