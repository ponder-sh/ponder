import { runCodegen } from "@/bin/utils/codegen.js";
import type { Database } from "@/database/index.js";
import { createHistoricalIndexingStore } from "@/indexing-store/historical.js";
import { getMetadataStore } from "@/indexing-store/metadata.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { createIndexingService } from "@/indexing/index.js";
import type { Common } from "@/internal/common.js";
import { getAppProgress } from "@/internal/metrics.js";
import type { IndexingBuild, PreBuild, SchemaBuild } from "@/internal/types.js";
import { createSyncStore } from "@/sync-store/index.js";
import { decodeEvents } from "@/sync/events.js";
import { type RealtimeEvent, createSync, splitEvents } from "@/sync/index.js";
import {
  ZERO_CHECKPOINT_STRING,
  decodeCheckpoint,
} from "@/utils/checkpoint.js";
import { chunk } from "@/utils/chunk.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import { never } from "@/utils/never.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import { createQueue } from "@ponder/common";

/** Starts the sync and indexing services for the specified build. */
export async function run({
  common,
  preBuild,
  schemaBuild,
  indexingBuild,
  database,
  onFatalError,
  onReloadableError,
}: {
  common: Common;
  preBuild: PreBuild;
  schemaBuild: SchemaBuild;
  indexingBuild: IndexingBuild;
  database: Database;
  onFatalError: (error: Error) => void;
  onReloadableError: (error: Error) => void;
}) {
  let isKilled = false;

  const requestQueues = indexingBuild.networks.map((network) =>
    createRequestQueue({ network, common }),
  );

  const initialCheckpoint = await database.recoverCheckpoint();
  const syncStore = createSyncStore({ common, database });
  const metadataStore = getMetadataStore({ database });

  // This can be a long-running operation, so it's best to do it after
  // starting the server so the app can become responsive more quickly.
  await database.migrateSync();

  runCodegen({ common });

  const sync = await createSync({
    common,
    indexingBuild,
    requestQueues,
    syncStore,
    onRealtimeEvent: (realtimeEvent) => {
      if (realtimeEvent.type === "reorg") {
        realtimeQueue.clear();
      }

      return realtimeQueue.add(realtimeEvent);
    },
    onFatalError,
    initialCheckpoint,
    mode: preBuild.mode,
  });

  const indexingService = createIndexingService({
    common,
    indexingBuild,
    requestQueues,
    syncStore,
  });

  const historicalIndexingStore = createHistoricalIndexingStore({
    common,
    schemaBuild,
    database,
    isDatabaseEmpty: initialCheckpoint === ZERO_CHECKPOINT_STRING,
  });

  indexingService.setIndexingStore(historicalIndexingStore);

  const realtimeQueue = createQueue({
    initialStart: true,
    browser: false,
    concurrency: 1,
    worker: async (event: RealtimeEvent) => {
      switch (event.type) {
        case "block": {
          if (event.events.length > 0) {
            // Events must be run block-by-block, so that `database.complete` can accurately
            // update the temporary `checkpoint` value set in the trigger.

            const perBlockEvents = splitEvents(event.events);

            common.logger.debug({
              service: "app",
              msg: `Partitioned events into ${perBlockEvents.length} blocks`,
            });

            for (const { checkpoint, events } of perBlockEvents) {
              const network = indexingBuild.networks.find(
                (network) =>
                  network.chainId ===
                  Number(decodeCheckpoint(checkpoint).chainId),
              )!;

              const decodedEvents = decodeEvents(
                common,
                indexingBuild.sources,
                events,
              );

              common.logger.debug({
                service: "app",
                msg: `Decoded ${decodedEvents.length} '${network.name}' events for block ${Number(decodeCheckpoint(checkpoint).blockNumber)}`,
              });

              const result = await indexingService.processEvents({
                events: decodedEvents,
              });

              common.logger.info({
                service: "app",
                msg: `Indexed ${decodedEvents.length} '${network.name}' events for block ${Number(decodeCheckpoint(checkpoint).blockNumber)}`,
              });

              if (result.status === "error") onReloadableError(result.error);

              // Set reorg table `checkpoint` column for newly inserted rows.
              await database.complete({ checkpoint });

              if (preBuild.mode === "multichain") {
                const network = indexingBuild.networks.find(
                  (network) =>
                    network.chainId ===
                    Number(decodeCheckpoint(checkpoint).chainId),
                )!;

                common.metrics.ponder_indexing_timestamp.set(
                  { network: network.name },
                  decodeCheckpoint(checkpoint).blockTimestamp,
                );
              } else {
                for (const network of indexingBuild.networks) {
                  common.metrics.ponder_indexing_timestamp.set(
                    { network: network.name },
                    decodeCheckpoint(checkpoint).blockTimestamp,
                  );
                }
              }
            }
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

  await metadataStore.setStatus(sync.getStatus());

  for (const network of indexingBuild.networks) {
    const label = { network: network.name };
    common.metrics.ponder_historical_total_indexing_seconds.set(
      label,
      Math.max(
        sync.seconds[network.name]!.end - sync.seconds[network.name]!.start,
        0,
      ),
    );
    common.metrics.ponder_historical_cached_indexing_seconds.set(
      label,
      Math.max(
        sync.seconds[network.name]!.cached - sync.seconds[network.name]!.start,
        0,
      ),
    );
    common.metrics.ponder_historical_completed_indexing_seconds.set(label, 0);
    common.metrics.ponder_indexing_timestamp.set(
      label,
      Math.max(
        sync.seconds[network.name]!.cached,
        sync.seconds[network.name]!.start,
      ),
    );
  }

  // Reset the start timestamp so the eta estimate doesn't include
  // the startup time.
  common.metrics.start_timestamp = Date.now();

  const start = async () => {
    // If the initial checkpoint is zero, we need to run setup events.
    if (initialCheckpoint === ZERO_CHECKPOINT_STRING) {
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

    let lastFlush = Date.now();

    // Run historical indexing until complete.
    for await (const events of sync.getEvents()) {
      if (events.length > 0) {
        const decodedEvents = decodeEvents(
          common,
          indexingBuild.sources,
          events,
        );
        const eventChunks = chunk(decodedEvents, 93);
        common.logger.debug({
          service: "app",
          msg: `Decoded ${decodedEvents.length} events`,
        });
        for (const eventChunk of eventChunks) {
          const result = await indexingService.processEvents({
            events: eventChunk,
          });

          if (result.status === "killed") {
            return;
          } else if (result.status === "error") {
            onReloadableError(result.error);
            return;
          }

          const checkpoint = decodeCheckpoint(
            eventChunk[eventChunk.length - 1]!.checkpoint,
          );

          if (preBuild.mode === "multichain") {
            const network = indexingBuild.networks.find(
              (network) => network.chainId === Number(checkpoint.chainId),
            )!;
            common.metrics.ponder_historical_completed_indexing_seconds.set(
              { network: network.name },
              Math.max(
                checkpoint.blockTimestamp - sync.seconds[network.name]!.start,
                0,
              ),
            );
            common.metrics.ponder_indexing_timestamp.set(
              { network: network.name },
              checkpoint.blockTimestamp,
            );
          } else {
            for (const network of indexingBuild.networks) {
              common.metrics.ponder_historical_completed_indexing_seconds.set(
                { network: network.name },
                Math.max(
                  checkpoint.blockTimestamp - sync.seconds[network.name]!.start,
                  0,
                ),
              );
              common.metrics.ponder_indexing_timestamp.set(
                { network: network.name },
                checkpoint.blockTimestamp,
              );
            }
          }

          // Note: allows for terminal and logs to be updated
          await new Promise(setImmediate);
        }

        // underlying metrics collection is actually synchronous
        // https://github.com/siimon/prom-client/blob/master/lib/histogram.js#L102-L125
        const { eta, progress } = await getAppProgress(common.metrics);
        if (eta === undefined || progress === undefined) {
          common.logger.info({
            service: "app",
            msg: `Indexed ${decodedEvents.length} events`,
          });
        } else {
          common.logger.info({
            service: "app",
            msg: `Indexed ${decodedEvents.length} events with ${formatPercentage(progress)} complete and ${formatEta(eta * 1_000)} remaining`,
          });
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

          await database.finalize({ checkpoint: ZERO_CHECKPOINT_STRING });
          await historicalIndexingStore.flush();
          await database.complete({ checkpoint: ZERO_CHECKPOINT_STRING });
          await database.finalize({
            checkpoint: events[events.length - 1]!.checkpoint,
          });
          lastFlush = Date.now();

          common.logger.debug({
            service: "indexing",
            msg: "Completed flush",
          });
        }
      }

      await metadataStore.setStatus(sync.getStatus());
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

    await database.finalize({ checkpoint: ZERO_CHECKPOINT_STRING });
    await historicalIndexingStore.flush();
    await database.complete({ checkpoint: ZERO_CHECKPOINT_STRING });
    await database.finalize({ checkpoint: sync.getFinalizedCheckpoint() });

    // Manually update metrics to fix a UI bug that occurs when the end
    // checkpoint is between the last processed event and the finalized
    // checkpoint.

    for (const network of indexingBuild.networks) {
      const label = { network: network.name };
      common.metrics.ponder_historical_completed_indexing_seconds.set(
        label,
        Math.max(
          sync.seconds[network.name]!.end - sync.seconds[network.name]!.start,
          0,
        ),
      );
      common.metrics.ponder_indexing_timestamp.set(
        { network: network.name },
        sync.seconds[network.name]!.end,
      );
    }

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
