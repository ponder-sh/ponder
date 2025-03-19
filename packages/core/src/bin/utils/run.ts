import { runCodegen } from "@/bin/utils/codegen.js";
import type { Database } from "@/database/index.js";
import { createIndexingCache } from "@/indexing-store/cache.js";
import { createHistoricalIndexingStore } from "@/indexing-store/historical.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { createIndexing } from "@/indexing/index.js";
import type { Common } from "@/internal/common.js";
import { FlushError } from "@/internal/errors.js";
import { getAppProgress } from "@/internal/metrics.js";
import type { IndexingBuild, PreBuild, SchemaBuild } from "@/internal/types.js";
import { createSyncStore } from "@/sync-store/index.js";
import { type RealtimeEvent, createSync, splitEvents } from "@/sync/index.js";
import {
  ZERO_CHECKPOINT_STRING,
  decodeCheckpoint,
} from "@/utils/checkpoint.js";
import { chunk } from "@/utils/chunk.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import { createMutex } from "@/utils/mutex.js";
import { never } from "@/utils/never.js";
import { createRequestQueue } from "@/utils/requestQueue.js";

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
  const crashRecoveryCheckpoint = await database.recoverCheckpoint();
  await database.migrateSync();

  runCodegen({ common });

  const requestQueues = indexingBuild.networks.map((network) =>
    createRequestQueue({
      network,
      common,
      concurrency: Math.floor(
        common.options.rpcMaxConcurrency / indexingBuild.networks.length,
      ),
    }),
  );

  const syncStore = createSyncStore({ common, database });

  const realtimeMutex = createMutex();

  const sync = await createSync({
    common,
    indexingBuild,
    requestQueues,
    syncStore,
    onRealtimeEvent: (realtimeEvent) => {
      if (realtimeEvent.type === "reorg") {
        realtimeMutex.clear();
      }

      return onRealtimeEvent(realtimeEvent);
    },
    onFatalError,
    crashRecoveryCheckpoint,
    ordering: preBuild.ordering,
  });

  const indexing = createIndexing({
    common,
    indexingBuild,
    requestQueues,
    syncStore,
  });

  const indexingCache = createIndexingCache({
    common,
    schemaBuild,
    checkpoint: crashRecoveryCheckpoint,
  });

  await database.setStatus(sync.getStatus());

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

  const startTimestamp = Math.round(Date.now() / 1000);
  common.metrics.ponder_historical_start_timestamp_seconds.set(startTimestamp);

  // Reset the start timestamp so the eta estimate doesn't include
  // the startup time.
  common.metrics.start_timestamp = Date.now();

  // If the initial checkpoint is zero, we need to run setup events.
  if (crashRecoveryCheckpoint === ZERO_CHECKPOINT_STRING) {
    await database.retry(async () => {
      await database.transaction(async (client, tx) => {
        const historicalIndexingStore = createHistoricalIndexingStore({
          common,
          schemaBuild,
          indexingCache,
          db: tx,
          client,
        });
        const result = await indexing.processSetupEvents({
          db: historicalIndexingStore,
        });

        if (result.status === "error") {
          onReloadableError(result.error);
          return;
        }
      });
    });
  }

  // Run historical indexing until complete.
  for await (const events of sync.getEvents()) {
    if (events.length > 0) {
      await database.retry(async () => {
        await database
          .transaction(async (client, tx) => {
            const historicalIndexingStore = createHistoricalIndexingStore({
              common,
              schemaBuild,
              indexingCache,
              db: tx,
              client,
            });

            const eventChunks = chunk(events, 93);
            for (const eventChunk of eventChunks) {
              const result = await indexing.processEvents({
                events: eventChunk,
                db: historicalIndexingStore,
              });

              if (result.status === "error") {
                onReloadableError(result.error);
                return;
              }

              const checkpoint = decodeCheckpoint(
                eventChunk[eventChunk.length - 1]!.checkpoint,
              );

              for (const network of indexingBuild.networks) {
                common.metrics.ponder_historical_completed_indexing_seconds.set(
                  { network: network.name },
                  Math.max(
                    Number(checkpoint.blockTimestamp) -
                      sync.seconds[network.name]!.start -
                      sync.seconds[network.name]!.cached,
                    0,
                  ),
                );
                common.metrics.ponder_indexing_timestamp.set(
                  { network: network.name },
                  Number(checkpoint.blockTimestamp),
                );
              }

              // Note: allows for terminal and logs to be updated
              if (preBuild.databaseConfig.kind === "pglite") {
                await new Promise(setImmediate);
              }
            }

            // underlying metrics collection is actually synchronous
            // https://github.com/siimon/prom-client/blob/master/lib/histogram.js#L102-L125
            const { eta, progress } = await getAppProgress(common.metrics);
            if (eta === undefined || progress === undefined) {
              common.logger.info({
                service: "app",
                msg: `Indexed ${events.length} events`,
              });
            } else {
              common.logger.info({
                service: "app",
                msg: `Indexed ${events.length} events with ${formatPercentage(progress)} complete and ${formatEta(eta * 1_000)} remaining`,
              });
            }

            try {
              await indexingCache.flush({ client });
            } catch (error) {
              if (error instanceof FlushError) {
                onReloadableError(error as Error);
                return;
              }
              throw error;
            }

            await database.finalize({
              checkpoint: events[events.length - 1]!.checkpoint,
              db: tx,
            });
          })
          .catch((error) => {
            indexingCache.rollback();
            throw error;
          });
      });
      indexingCache.commit();
    }

    await database.setStatus(sync.getStatus());
  }

  // Persist the indexing store to the db. The `finalized`
  // checkpoint is used as a mutex. Any rows in the reorg table that may
  // have been written because of raw sql access are deleted. Also must truncate
  // the reorg tables that may have been written because of raw sql access.

  common.logger.debug({
    service: "indexing",
    msg: "Completed all historical events, starting final flush",
  });

  await database.retry(async () => {
    await database.transaction(async (client, tx) => {
      try {
        await indexingCache.flush({ client });
      } catch (error) {
        if (error instanceof FlushError) {
          onReloadableError(error as Error);
          return;
        }
        throw error;
      }

      await database.finalize({
        checkpoint: sync.getFinalizedCheckpoint(),
        db: tx,
      });
    });
  });

  indexingCache.clear();

  // Manually update metrics to fix a UI bug that occurs when the end
  // checkpoint is between the last processed event and the finalized
  // checkpoint.

  for (const network of indexingBuild.networks) {
    const label = { network: network.name };
    common.metrics.ponder_historical_completed_indexing_seconds.set(
      label,
      Math.max(
        sync.seconds[network.name]!.end -
          sync.seconds[network.name]!.start -
          sync.seconds[network.name]!.cached,
        0,
      ),
    );
    common.metrics.ponder_indexing_timestamp.set(
      { network: network.name },
      sync.seconds[network.name]!.end,
    );
  }

  const endTimestamp = Math.round(Date.now() / 1000);
  common.metrics.ponder_historical_end_timestamp_seconds.set(endTimestamp);

  // Become healthy
  common.logger.info({
    service: "indexing",
    msg: "Completed historical indexing",
  });

  const realtimeIndexingStore = createRealtimeIndexingStore({
    common,
    schemaBuild,
    database,
  });

  const onRealtimeEvent = realtimeMutex(async (event: RealtimeEvent) => {
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

            common.logger.debug({
              service: "app",
              msg: `Decoded ${events.length} '${network.name}' events for block ${Number(decodeCheckpoint(checkpoint).blockNumber)}`,
            });

            const result = await indexing.processEvents({
              events,
              db: realtimeIndexingStore,
            });

            common.logger.info({
              service: "app",
              msg: `Indexed ${events.length} '${network.name}' events for block ${Number(decodeCheckpoint(checkpoint).blockNumber)}`,
            });

            if (result.status === "error") onReloadableError(result.error);

            // Set reorg table `checkpoint` column for newly inserted rows.
            await database.complete({ checkpoint, db: database.qb.drizzle });

            if (preBuild.ordering === "multichain") {
              const network = indexingBuild.networks.find(
                (network) =>
                  network.chainId ===
                  Number(decodeCheckpoint(checkpoint).chainId),
              )!;

              common.metrics.ponder_indexing_timestamp.set(
                { network: network.name },
                Number(decodeCheckpoint(checkpoint).blockTimestamp),
              );
            } else {
              for (const network of indexingBuild.networks) {
                common.metrics.ponder_indexing_timestamp.set(
                  { network: network.name },
                  Number(decodeCheckpoint(checkpoint).blockTimestamp),
                );
              }
            }
          }
        }

        await database.setStatus(event.status);

        break;
      }
      case "reorg":
        await database.removeTriggers();
        await database.retry(async () => {
          await database.qb.drizzle.transaction(async (tx) => {
            await database.revert({ checkpoint: event.checkpoint, tx });
          });
        });
        await database.createTriggers();

        break;

      case "finalize":
        await database.finalize({
          checkpoint: event.checkpoint,
          db: database.qb.drizzle,
        });
        break;

      default:
        never(event);
    }
  });

  await database.createIndexes();
  await database.createTriggers();

  await sync.startRealtime();

  await database.setStatus(sync.getStatus());

  common.logger.info({
    service: "server",
    msg: "Started returning 200 responses from /ready endpoint",
  });
}
