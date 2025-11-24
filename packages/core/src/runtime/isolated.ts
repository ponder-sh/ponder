import {
  commitBlock,
  createLiveQueryTriggers,
  createTriggers,
  dropLiveQueryTriggers,
  dropTriggers,
  finalizeIsolated,
  revertIsolated,
} from "@/database/actions.js";
import { type Database, getPonderCheckpointTable } from "@/database/index.js";
import { createIndexingCache } from "@/indexing-store/cache.js";
import { createHistoricalIndexingStore } from "@/indexing-store/historical.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { createCachedViemClient } from "@/indexing/client.js";
import {
  createColumnAccessPattern,
  createIndexing,
  getEventCount,
} from "@/indexing/index.js";
import type { Common } from "@/internal/common.js";
import {
  InvalidEventAccessError,
  NonRetryableUserError,
  type RetryableError,
} from "@/internal/errors.js";
import type {
  CrashRecoveryCheckpoint,
  IndexingBuild,
  IndexingErrorHandler,
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
  Seconds,
} from "@/internal/types.js";
import { splitEvents } from "@/runtime/events.js";
import type { RealtimeSyncEvent } from "@/sync-realtime/index.js";
import { createSyncStore } from "@/sync-store/index.js";
import {
  ZERO_CHECKPOINT_STRING,
  decodeCheckpoint,
  min,
} from "@/utils/checkpoint.js";
import {
  bufferAsyncGenerator,
  recordAsyncGenerator,
} from "@/utils/generators.js";
import { never } from "@/utils/never.js";
import { startClock } from "@/utils/timer.js";
import { eq, getTableName, isTable, sql } from "drizzle-orm";
import {
  getHistoricalEventsIsolated,
  refetchHistoricalEvents,
} from "./historical.js";
import { getCachedIntervals, getChildAddresses } from "./index.js";
import { initSyncProgress } from "./init.js";
import { getRealtimeEventsIsolated } from "./realtime.js";

export async function runIsolated({
  common,
  preBuild,
  namespaceBuild,
  schemaBuild,
  indexingBuild,
  crashRecoveryCheckpoint,
  database,
  onReady,
}: {
  common: Common;
  preBuild: PreBuild;
  namespaceBuild: NamespaceBuild;
  schemaBuild: SchemaBuild;
  indexingBuild: IndexingBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  database: Database;
  onReady: () => void;
}) {
  const chain = indexingBuild.chains[0]!;

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild,
  });
  const syncStore = createSyncStore({ common, qb: database.syncQB });

  const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);

  const eventCount = getEventCount(indexingBuild.indexingFunctions);

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild,
    syncStore,
    eventCount,
  });

  const indexingErrorHandler: IndexingErrorHandler = {
    getRetryableError: () => {
      return indexingErrorHandler.error;
    },
    setRetryableError: (error: RetryableError) => {
      indexingErrorHandler.error = error;
    },
    clearRetryableError: () => {
      indexingErrorHandler.error = undefined;
    },
    error: undefined as RetryableError | undefined,
  };

  const indexing = createIndexing({
    common,
    indexingBuild,
    client: cachedViemClient,
    indexingErrorHandler,
    columnAccessPattern,
    eventCount,
  });

  const indexingCache = createIndexingCache({
    common,
    schemaBuild,
    crashRecoveryCheckpoint,
    eventCount,
    chainId: chain.id,
  });

  const historicalIndexingStore = createHistoricalIndexingStore({
    common,
    schemaBuild,
    indexingCache,
    indexingErrorHandler,
    chainId: chain.id,
  });

  const seconds: Seconds = {};

  const eventCallbacks =
    indexingBuild.eventCallbacks[indexingBuild.chains.indexOf(chain)]!;

  const cachedIntervals = await getCachedIntervals({
    chain,
    filters: eventCallbacks.map(({ filter }) => filter),
    syncStore,
  });
  const syncProgress = await initSyncProgress({
    common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc: indexingBuild.rpcs[0]!,
    finalizedBlock: indexingBuild.finalizedBlocks[0]!,
    cachedIntervals,
  });
  const childAddresses = await getChildAddresses({
    filters: eventCallbacks.map(({ filter }) => filter),
    syncStore,
  });
  const unfinalizedBlocks: Omit<
    Extract<RealtimeSyncEvent, { type: "block" }>,
    "type"
  >[] = [];

  const start = Number(
    decodeCheckpoint(syncProgress.getCheckpoint({ tag: "start" }))
      .blockTimestamp,
  );

  const end = Number(
    decodeCheckpoint(
      min(
        syncProgress.getCheckpoint({ tag: "end" }),
        syncProgress.getCheckpoint({ tag: "finalized" }),
      ),
    ).blockTimestamp,
  );

  const _crashRecoveryCheckpoint = crashRecoveryCheckpoint?.find(
    ({ chainId }) => chainId === chain.id,
  )?.checkpoint;

  const cached = Math.min(
    Number(
      decodeCheckpoint(_crashRecoveryCheckpoint ?? ZERO_CHECKPOINT_STRING)
        .blockTimestamp,
    ),
    end,
  );

  seconds[chain.name] = { start, end, cached };

  const label = { chain: chain.name };
  common.metrics.ponder_historical_total_indexing_seconds.set(
    label,
    Math.max(seconds[chain.name]!.end - seconds[chain.name]!.start, 0),
  );
  common.metrics.ponder_historical_cached_indexing_seconds.set(
    label,
    Math.max(seconds[chain.name]!.cached - seconds[chain.name]!.start, 0),
  );
  common.metrics.ponder_historical_completed_indexing_seconds.set(label, 0);
  common.metrics.ponder_indexing_timestamp.set(
    label,
    Math.max(seconds[chain.name]!.cached, seconds[chain.name]!.start),
  );

  const startTimestamp = Math.round(Date.now() / 1000);
  common.metrics.ponder_historical_start_timestamp_seconds.set(
    label,
    startTimestamp,
  );

  // Reset the start timestamp so the eta estimate doesn't include
  // the startup time.
  common.metrics.start_timestamp = Date.now();

  // If the initial checkpoint is zero, we need to run setup events.
  if (crashRecoveryCheckpoint === undefined) {
    await database.userQB.transaction(async (tx) => {
      historicalIndexingStore.qb = tx;
      historicalIndexingStore.isProcessingEvents = true;

      indexingCache.qb = tx;

      await indexing.processSetupEvents({
        db: historicalIndexingStore,
      });

      historicalIndexingStore.isProcessingEvents = false;

      await indexingCache.flush();

      const initialCheckpoint = min(
        syncProgress.getCheckpoint({ tag: "start" }),
        syncProgress.getCheckpoint({ tag: "finalized" }),
      );

      await tx.wrap({ label: "update_checkpoints" }, (tx) =>
        tx
          .insert(PONDER_CHECKPOINT)
          .values({
            chainName: chain.name,
            chainId: chain.id,
            latestCheckpoint: initialCheckpoint,
            safeCheckpoint: initialCheckpoint,
            finalizedCheckpoint: initialCheckpoint,
          })
          .onConflictDoUpdate({
            target: PONDER_CHECKPOINT.chainName,
            set: {
              finalizedCheckpoint: sql`excluded.finalized_checkpoint`,
              safeCheckpoint: sql`excluded.safe_checkpoint`,
              latestCheckpoint: sql`excluded.latest_checkpoint`,
            },
          }),
      );
    });
  }

  const backfillEndClock = startClock();

  // Run historical indexing until complete.
  for await (let {
    events,
    chainId,
    checkpoint,
    blockRange,
  } of recordAsyncGenerator(
    bufferAsyncGenerator(
      getHistoricalEventsIsolated({
        common,
        chain,
        indexingBuild,
        crashRecoveryCheckpoint,
        syncProgress,
        childAddresses,
        cachedIntervals,
        database,
      }),
      1,
    ),
    (params) => {
      common.metrics.ponder_historical_concurrency_group_duration.inc(
        { group: "extract" },
        params.await,
      );
      common.metrics.ponder_historical_concurrency_group_duration.inc(
        { group: "transform" },
        params.yield,
      );
    },
  )) {
    const context = {
      logger: common.logger.child({ action: "index_block_range" }),
    };
    const indexStartClock = startClock();

    indexingCache.qb = database.userQB;
    await Promise.all([
      indexingCache.prefetch({ events }),
      cachedViemClient.prefetch({ events }),
    ]);
    common.metrics.ponder_historical_transform_duration.inc(
      { step: "prefetch" },
      indexStartClock(),
    );

    let endClock = startClock();
    await database.userQB.transaction(
      async (tx) => {
        const initialCompletedEvents = structuredClone(
          await common.metrics.ponder_indexing_completed_events.get(),
        );

        try {
          historicalIndexingStore.qb = tx;
          historicalIndexingStore.isProcessingEvents = true;
          indexingCache.qb = tx;

          common.metrics.ponder_historical_transform_duration.inc(
            { step: "begin" },
            endClock(),
          );

          endClock = startClock();

          await indexing.processHistoricalEvents({
            events,
            db: historicalIndexingStore,
            cache: indexingCache,
            updateIndexingSeconds(event, chain) {
              const checkpoint = decodeCheckpoint(event!.checkpoint);

              common.metrics.ponder_historical_completed_indexing_seconds.set(
                { chain: chain.name },
                Math.max(
                  Number(checkpoint.blockTimestamp) -
                    Math.max(
                      seconds[chain.name]!.cached,
                      seconds[chain.name]!.start,
                    ),
                  0,
                ),
              );
              common.metrics.ponder_indexing_timestamp.set(
                { chain: chain.name },
                Number(checkpoint.blockTimestamp),
              );
            },
          });

          historicalIndexingStore.isProcessingEvents = false;

          common.metrics.ponder_historical_transform_duration.inc(
            { step: "index" },
            endClock(),
          );

          endClock = startClock();

          // Note: at this point, the next events can be preloaded, as long as the are not indexed until
          // the "flush" + "finalize" is complete.

          await indexingCache.flush();

          common.metrics.ponder_historical_transform_duration.inc(
            { step: "load" },
            endClock(),
          );

          endClock = startClock();

          await tx.wrap(
            { label: "update_checkpoints" },
            (tx) =>
              tx
                .insert(PONDER_CHECKPOINT)
                .values({
                  chainName: chain.name,
                  chainId,
                  latestCheckpoint: checkpoint,
                  finalizedCheckpoint: checkpoint,
                  safeCheckpoint: checkpoint,
                })
                .onConflictDoUpdate({
                  target: PONDER_CHECKPOINT.chainName,
                  set: {
                    safeCheckpoint: sql`excluded.safe_checkpoint`,
                    finalizedCheckpoint: sql`excluded.finalized_checkpoint`,
                    latestCheckpoint: sql`excluded.latest_checkpoint`,
                  },
                }),
            context,
          );

          common.metrics.ponder_historical_transform_duration.inc(
            { step: "finalize" },
            endClock(),
          );
          endClock = startClock();
        } catch (error) {
          // Note: This can cause a bug with "dev" command, because there are multiple instances
          // updating the same metric.
          for (const value of initialCompletedEvents.values) {
            common.metrics.ponder_indexing_completed_events.set(
              value.labels,
              value.value,
            );
          }

          indexingCache.invalidate();
          indexingCache.clear();

          if (error instanceof InvalidEventAccessError) {
            common.logger.debug({
              msg: "Failed to index block range",
              chain: chain.name,
              chain_id: chain.id,
              block_range: JSON.stringify(blockRange),
              duration: indexStartClock(),
              error,
            });
            events = await refetchHistoricalEvents({
              common,
              indexingBuild,
              perChainSync: new Map([[chain, { childAddresses }]]),
              syncStore,
              events,
            });
          } else if (error instanceof NonRetryableUserError === false) {
            common.logger.warn({
              msg: "Failed to index block range",
              chain: chain.name,
              chain_id: chain.id,
              block_range: JSON.stringify(blockRange),
              duration: indexStartClock(),
              error: error as Error,
            });
          }

          throw error;
        }
      },
      undefined,
      context,
    );

    cachedViemClient.clear();
    common.metrics.ponder_historical_transform_duration.inc(
      { step: "commit" },
      endClock(),
    );

    await new Promise(setImmediate);

    common.logger.info({
      msg: "Indexed block range",
      chain: chain.name,
      chain_id: chain.id,
      event_count: events.length,
      block_range: JSON.stringify(blockRange),
      duration: indexStartClock(),
    });
  }

  indexingCache.clear();

  // Manually update metrics to fix a UI bug that occurs when the end
  // checkpoint is between the last processed event and the finalized
  // checkpoint.

  common.metrics.ponder_historical_completed_indexing_seconds.set(
    label,
    Math.max(
      seconds[chain.name]!.end -
        Math.max(seconds[chain.name]!.cached, seconds[chain.name]!.start),
      0,
    ),
  );
  common.metrics.ponder_indexing_timestamp.set(
    { chain: chain.name },
    seconds[chain.name]!.end,
  );

  const endTimestamp = Math.round(Date.now() / 1000);
  common.metrics.ponder_historical_end_timestamp_seconds.set(
    { chain: chain.name },
    endTimestamp,
  );

  common.logger.info({
    msg: "Completed backfill indexing",
    chain: chain.name,
    chain_id: chain.id,
    duration: backfillEndClock(),
  });

  const tables = Object.values(schemaBuild.schema).filter(isTable);

  const endClock = startClock();

  await createTriggers(database.adminQB, { tables, chainId: chain.id });
  await createLiveQueryTriggers(database.adminQB, {
    namespaceBuild,
    tables,
    chainId: chain.id,
  });

  common.logger.debug({
    msg: "Created database triggers",
    chain: chain.name,
    chain_id: chain.id,
    count: tables.length,
    duration: endClock(),
  });

  onReady();

  const realtimeIndexingStore = createRealtimeIndexingStore({
    common,
    schemaBuild,
    indexingErrorHandler,
    chainId: chain.id,
  });

  const bufferCallback = (bufferSize: number) => {
    // Note: Only log when the buffer size is greater than 1 because
    // a buffer size of 1 is not backpressure.
    if (bufferSize === 1) return;
    common.logger.trace({
      msg: "Detected live indexing backpressure",
      buffer_size: bufferSize,
      indexing_step: "index block",
    });
  };

  for await (const event of bufferAsyncGenerator(
    getRealtimeEventsIsolated({
      common,
      indexingBuild,
      chain,
      syncProgress,
      childAddresses,
      unfinalizedBlocks,
      database,
    }),
    100,
    bufferCallback,
  )) {
    switch (event.type) {
      case "block": {
        const context = {
          logger: common.logger.child({ action: "index_block" }),
        };
        const endClock = startClock();

        await database.userQB.transaction(
          async (tx) => {
            if (database.userQB.$dialect === "postgres") {
              await tx.wrap(
                (tx) =>
                  tx.execute(
                    "CREATE TEMP TABLE live_query_tables (table_name TEXT PRIMARY KEY) ON COMMIT DROP",
                  ),
                context,
              );
            } else {
              await tx.wrap(
                (tx) =>
                  tx.execute(
                    "CREATE TEMP TABLE IF NOT EXISTS live_query_tables (table_name TEXT PRIMARY KEY)",
                  ),
                context,
              );
            }

            // Events must be run block-by-block, so that `database.commitBlock` can accurately
            // update the temporary `checkpoint` value set in the trigger.
            for (const { checkpoint, events } of splitEvents(event.events)) {
              try {
                realtimeIndexingStore.qb = tx;
                realtimeIndexingStore.isProcessingEvents = true;

                common.logger.trace({
                  msg: "Processing block events",
                  chain: chain.name,
                  chain_id: chain.id,
                  number: Number(decodeCheckpoint(checkpoint).blockNumber),
                  event_count: events.length,
                });

                await indexing.processRealtimeEvents({
                  events,
                  db: realtimeIndexingStore,
                });

                common.logger.trace({
                  msg: "Processed block events",
                  chain: chain.name,
                  chain_id: chain.id,
                  number: Number(decodeCheckpoint(checkpoint).blockNumber),
                  event_count: events.length,
                });

                realtimeIndexingStore.isProcessingEvents = false;

                await Promise.all(
                  tables.map((table) =>
                    commitBlock(tx, { table, checkpoint, preBuild }, context),
                  ),
                );

                common.logger.trace({
                  msg: "Committed reorg data for block",
                  chain: chain.name,
                  chain_id: chain.id,
                  number: Number(decodeCheckpoint(checkpoint).blockNumber),
                  event_count: events.length,
                  checkpoint,
                });

                common.metrics.ponder_indexing_timestamp.set(
                  { chain: chain.name },
                  Number(decodeCheckpoint(checkpoint).blockTimestamp),
                );
              } catch (error) {
                if (error instanceof NonRetryableUserError === false) {
                  common.logger.warn({
                    msg: "Failed to index block",
                    chain: chain.name,
                    chain_id: chain.id,
                    number: Number(decodeCheckpoint(checkpoint).blockNumber),
                    error: error,
                  });
                }

                throw error;
              }
            }

            await tx.wrap(
              { label: "update_checkpoints" },
              (db) =>
                db
                  .update(PONDER_CHECKPOINT)
                  .set({ latestCheckpoint: event.checkpoint })
                  .where(eq(PONDER_CHECKPOINT.chainName, event.chain.name)),
              context,
            );

            if (
              event.events.length > 0 &&
              database.userQB.$dialect === "pglite"
            ) {
              await tx.wrap(
                (tx) => tx.execute("TRUNCATE TABLE live_query_tables"),
                context,
              );
            }
          },
          undefined,
          context,
        );

        event.blockCallback?.(true);

        common.logger.info({
          msg: "Indexed block",
          chain: event.chain.name,
          chain_id: event.chain.id,
          number: Number(decodeCheckpoint(event.checkpoint).blockNumber),
          event_count: event.events.length,
          duration: endClock(),
        });

        break;
      }
      case "reorg": {
        const context = {
          logger: common.logger.child({ action: "reorg_block" }),
        };
        const endClock = startClock();

        // Note: `_ponder_checkpoint` is not called here, instead it is called
        // in the `block` case.

        await database.userQB.transaction(
          async (tx) => {
            await dropTriggers(tx, { tables, chainId: chain.id }, context);
            await dropLiveQueryTriggers(
              tx,
              { namespaceBuild, tables, chainId: chain.id },
              context,
            );

            const counts = await revertIsolated(
              tx,
              {
                checkpoint: event.checkpoint,
                tables,
              },
              context,
            );

            for (const [index, table] of tables.entries()) {
              common.logger.debug({
                msg: "Reverted reorged database rows",
                chain: chain.name,
                chain_id: chain.id,
                table: getTableName(table),
                row_count: counts[index],
              });
            }

            await createTriggers(tx, { tables, chainId: chain.id }, context);
            await createLiveQueryTriggers(
              tx,
              { namespaceBuild, tables, chainId: chain.id },
              context,
            );
          },
          undefined,
          context,
        );

        common.logger.info({
          msg: "Reorged block",
          chain: event.chain.name,
          chain_id: event.chain.id,
          number: Number(decodeCheckpoint(event.checkpoint).blockNumber),
          duration: endClock(),
        });

        break;
      }
      case "finalize": {
        const context = {
          logger: common.logger.child({ action: "finalize_block" }),
        };
        const endClock = startClock();

        await finalizeIsolated(
          database.userQB,
          {
            checkpoint: event.checkpoint,
            tables,
            namespaceBuild,
          },
          context,
        );

        common.logger.info({
          msg: "Finalized block",
          chain: event.chain.name,
          chain_id: event.chain.id,
          number: Number(decodeCheckpoint(event.checkpoint).blockNumber),
          duration: endClock(),
        });

        break;
      }
      default:
        never(event);
    }
  }

  common.logger.info({
    msg: "Completed indexing",
    chain: chain.name,
    chain_id: chain.id,
    duration: backfillEndClock(),
  });
}
