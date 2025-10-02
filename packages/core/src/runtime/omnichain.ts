import { runCodegen } from "@/bin/utils/codegen.js";
import {
  commitBlock,
  createIndexes,
  createTriggers,
  createViews,
  dropTriggers,
  finalize,
  revert,
} from "@/database/actions.js";
import {
  type Database,
  getPonderCheckpointTable,
  getPonderMetaTable,
} from "@/database/index.js";
import { createIndexingCache } from "@/indexing-store/cache.js";
import { createHistoricalIndexingStore } from "@/indexing-store/historical.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { createCachedViemClient } from "@/indexing/client.js";
import { createColumnAccessPattern, createIndexing } from "@/indexing/index.js";
import type { Common } from "@/internal/common.js";
import {
  InvalidEventAccessError,
  NonRetryableUserError,
  type RetryableError,
} from "@/internal/errors.js";
import { getAppProgress } from "@/internal/metrics.js";
import type {
  Chain,
  CrashRecoveryCheckpoint,
  Event,
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
  max,
  min,
} from "@/utils/checkpoint.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import { recordAsyncGenerator } from "@/utils/generators.js";
import { never } from "@/utils/never.js";
import { startClock } from "@/utils/timer.js";
import { eq, getTableName, isTable, sql } from "drizzle-orm";
import {
  getHistoricalEventsOmnichain,
  refetchHistoricalEvents,
} from "./historical.js";
import {
  type CachedIntervals,
  type ChildAddresses,
  type SyncProgress,
  getCachedIntervals,
  getChildAddresses,
} from "./index.js";
import { initSyncProgress } from "./init.js";
import { getRealtimeEventsOmnichain } from "./realtime.js";

export async function runOmnichain({
  common,
  preBuild,
  namespaceBuild,
  schemaBuild,
  indexingBuild,
  crashRecoveryCheckpoint,
  database,
}: {
  common: Common;
  preBuild: PreBuild;
  namespaceBuild: NamespaceBuild;
  schemaBuild: SchemaBuild;
  indexingBuild: IndexingBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  database: Database;
}) {
  runCodegen({ common });

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild,
  });
  const syncStore = createSyncStore({ common, database });

  const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);
  const PONDER_META = getPonderMetaTable(namespaceBuild.schema);

  let eventCount: { [eventName: string]: number } = {};
  for (const eventName of Object.keys(indexingBuild.indexingFunctions)) {
    eventCount[eventName] = 0;
  }

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
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const indexingCache = createIndexingCache({
    common,
    schemaBuild,
    crashRecoveryCheckpoint,
    eventCount,
  });

  const historicalIndexingStore = createHistoricalIndexingStore({
    common,
    schemaBuild,
    indexingCache,
    indexingErrorHandler,
  });

  const perChainSync = new Map<
    Chain,
    {
      syncProgress: SyncProgress;
      childAddresses: ChildAddresses;
      cachedIntervals: CachedIntervals;
      unfinalizedBlocks: Omit<
        Extract<RealtimeSyncEvent, { type: "block" }>,
        "type"
      >[];
    }
  >();
  const seconds: Seconds = {};

  await Promise.all(
    indexingBuild.chains.map(async (chain) => {
      const sources = indexingBuild.sources.filter(
        ({ filter }) => filter.chainId === chain.id,
      );

      const cachedIntervals = await getCachedIntervals({
        chain,
        sources,
        syncStore,
      });
      const syncProgress = await initSyncProgress({
        common,
        sources,
        chain,
        rpc: indexingBuild.rpcs[indexingBuild.chains.indexOf(chain)]!,
        finalizedBlock:
          indexingBuild.finalizedBlocks[indexingBuild.chains.indexOf(chain)]!,
        cachedIntervals,
      });
      const childAddresses = await getChildAddresses({
        sources,
        syncStore,
      });
      const unfinalizedBlocks: Omit<
        Extract<RealtimeSyncEvent, { type: "block" }>,
        "type"
      >[] = [];

      perChainSync.set(chain, {
        syncProgress,
        childAddresses,
        cachedIntervals,
        unfinalizedBlocks,
      });
    }),
  );

  const start = Number(
    decodeCheckpoint(getOmnichainCheckpoint({ perChainSync, tag: "start" }))
      .blockTimestamp,
  );
  const end = Number(
    decodeCheckpoint(
      min(
        getOmnichainCheckpoint({ perChainSync, tag: "end" }),
        getOmnichainCheckpoint({ perChainSync, tag: "finalized" }),
      ),
    ).blockTimestamp,
  );

  for (const chain of indexingBuild.chains) {
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
  }

  const startTimestamp = Math.round(Date.now() / 1000);
  common.metrics.ponder_historical_start_timestamp_seconds.set(startTimestamp);

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

      await tx.wrap({ label: "update_checkpoints" }, (tx) =>
        tx
          .insert(PONDER_CHECKPOINT)
          .values(
            indexingBuild.chains.map((chain) => ({
              chainName: chain.name,
              chainId: chain.id,
              latestCheckpoint: perChainSync
                .get(chain)!
                .syncProgress.getCheckpoint({ tag: "start" }),
              safeCheckpoint: perChainSync
                .get(chain)!
                .syncProgress.getCheckpoint({ tag: "start" }),
              finalizedCheckpoint: perChainSync
                .get(chain)!
                .syncProgress.getCheckpoint({ tag: "start" }),
            })),
          )
          .onConflictDoUpdate({
            target: PONDER_CHECKPOINT.chainName,
            set: {
              safeCheckpoint: sql`excluded.safe_checkpoint`,
              latestCheckpoint: sql`excluded.latest_checkpoint`,
              finalizedCheckpoint: sql`excluded.finalized_checkpoint`,
            },
          }),
      );
    });
  }

  let pendingEvents: Event[] = [];

  // Run historical indexing until complete.
  for await (const result of recordAsyncGenerator(
    getHistoricalEventsOmnichain({
      common,
      indexingBuild,
      crashRecoveryCheckpoint,
      perChainSync,
      syncStore,
    }),
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
    if (result.type === "pending") {
      pendingEvents = result.pendingEvents!;
      continue;
    }

    let endClock = startClock();

    indexingCache.qb = database.userQB;
    await Promise.all([
      indexingCache.prefetch({ events: result.events }),
      cachedViemClient.prefetch({ events: result.events }),
    ]);
    common.metrics.ponder_historical_transform_duration.inc(
      { step: "prefetch" },
      endClock(),
    );
    if (result.events.length > 0) {
      endClock = startClock();
      await database.userQB.transaction(async (tx) => {
        const initialEventCount = structuredClone(eventCount);

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
            events: result.events,
            db: historicalIndexingStore,
            cache: indexingCache,
            updateIndexingSeconds(event) {
              const checkpoint = decodeCheckpoint(event.checkpoint);
              for (const chain of indexingBuild.chains) {
                common.metrics.ponder_historical_completed_indexing_seconds.set(
                  { chain: chain.name },
                  Math.min(
                    Math.max(
                      Number(checkpoint.blockTimestamp) -
                        Math.max(
                          seconds[chain.name]!.cached,
                          seconds[chain.name]!.start,
                        ),
                      0,
                    ),
                    Math.max(
                      seconds[chain.name]!.end - seconds[chain.name]!.start,
                      0,
                    ),
                  ),
                );
                common.metrics.ponder_indexing_timestamp.set(
                  { chain: chain.name },
                  Math.max(
                    Number(checkpoint.blockTimestamp),
                    seconds[chain.name]!.end,
                  ),
                );
              }
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

          // underlying metrics collection is actually synchronous
          // https://github.com/siimon/prom-client/blob/master/lib/histogram.js#L102-L125
          const { eta, progress } = await getAppProgress(common.metrics);
          if (eta === undefined || progress === undefined) {
            common.logger.info({
              service: "app",
              msg: `Indexed ${result.events.length} events`,
            });
          } else {
            common.logger.info({
              service: "app",
              msg: `Indexed ${result.events.length} events with ${formatPercentage(progress)} complete and ${formatEta(eta * 1_000)} remaining`,
            });
          }

          endClock = startClock();

          if (result.checkpoints.length > 0) {
            await tx.wrap({ label: "update_checkpoints" }, (tx) =>
              tx
                .insert(PONDER_CHECKPOINT)
                .values(
                  result.checkpoints.map(({ chainId, checkpoint }) => ({
                    chainName: indexingBuild.chains.find(
                      (chain) => chain.id === chainId,
                    )!.name,
                    chainId,
                    latestCheckpoint: checkpoint,
                    safeCheckpoint: checkpoint,
                    finalizedCheckpoint: checkpoint,
                  })),
                )
                .onConflictDoUpdate({
                  target: PONDER_CHECKPOINT.chainName,
                  set: {
                    safeCheckpoint: sql`excluded.safe_checkpoint`,
                    latestCheckpoint: sql`excluded.latest_checkpoint`,
                    finalizedCheckpoint: sql`excluded.finalized_checkpoint`,
                  },
                }),
            );
          }

          common.metrics.ponder_historical_transform_duration.inc(
            { step: "finalize" },
            endClock(),
          );
          endClock = startClock();
        } catch (error) {
          eventCount = initialEventCount;
          indexingCache.invalidate();
          indexingCache.clear();

          if (error instanceof InvalidEventAccessError) {
            common.logger.warn({
              service: "app",
              msg: `Retrying event batch due to unexpected event property access. Missing: '${error.key}' field.`,
            });
            result.events = await refetchHistoricalEvents({
              common,
              indexingBuild,
              perChainSync,
              syncStore,
              events: result.events,
            });
          } else if (error instanceof NonRetryableUserError === false) {
            common.logger.warn({
              service: "app",
              msg: "Retrying event batch",
              error: error as Error,
            });
          }

          throw error;
        }
      });

      cachedViemClient.clear();
      common.metrics.ponder_historical_transform_duration.inc(
        { step: "commit" },
        endClock(),
      );

      await new Promise(setImmediate);
    }
  }

  indexingCache.clear();

  // Manually update metrics to fix a UI bug that occurs when the end
  // checkpoint is between the last processed event and the finalized
  // checkpoint.

  for (const chain of indexingBuild.chains) {
    const label = { chain: chain.name };
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
  }

  const endTimestamp = Math.round(Date.now() / 1000);
  common.metrics.ponder_historical_end_timestamp_seconds.set(endTimestamp);

  common.logger.info({
    service: "indexing",
    msg: "Completed historical indexing",
  });

  const tables = Object.values(schemaBuild.schema).filter(isTable);

  await createIndexes(database.adminQB, { statements: schemaBuild.statements });
  await createTriggers(database.adminQB, { tables });
  if (namespaceBuild.viewsSchema !== undefined) {
    await createViews(database.adminQB, { tables, namespaceBuild });

    common.logger.info({
      service: "app",
      msg: `Created ${tables.length} views in schema "${namespaceBuild.viewsSchema}"`,
    });
  }

  await database.adminQB.wrap({ label: "update_ready" }, (db) =>
    db
      .update(PONDER_META)
      .set({ value: sql`jsonb_set(value, '{is_ready}', to_jsonb(1))` }),
  );

  common.logger.info({
    msg: "Started returning 200 responses",
    endpoint: "/ready",
  });

  const realtimeIndexingStore = createRealtimeIndexingStore({
    common,
    schemaBuild,
    indexingErrorHandler,
  });

  for await (const event of getRealtimeEventsOmnichain({
    common,
    indexingBuild,
    perChainSync,
    syncStore,
    pendingEvents,
  })) {
    switch (event.type) {
      case "block": {
        if (event.events.length > 0) {
          // Events must be run block-by-block, so that `database.commitBlock` can accurately
          // update the temporary `checkpoint` value set in the trigger.

          const perBlockEvents = splitEvents(event.events);

          common.logger.debug({
            service: "app",
            msg: `Partitioned events into ${perBlockEvents.length} blocks`,
          });

          for (const { checkpoint, events } of perBlockEvents) {
            await database.userQB.transaction(async (tx) => {
              const chain = indexingBuild.chains.find(
                (chain) =>
                  chain.id === Number(decodeCheckpoint(checkpoint).chainId),
              )!;

              try {
                realtimeIndexingStore.qb = tx;
                realtimeIndexingStore.isProcessingEvents = true;

                await indexing.processRealtimeEvents({
                  events,
                  db: realtimeIndexingStore,
                });

                realtimeIndexingStore.isProcessingEvents = false;

                common.logger.info({
                  service: "app",
                  msg: `Indexed ${events.length} '${chain.name}' events for block ${Number(decodeCheckpoint(checkpoint).blockNumber)}`,
                });

                await Promise.all(
                  tables.map((table) => commitBlock(tx, { table, checkpoint })),
                );

                for (const chain of indexingBuild.chains) {
                  common.metrics.ponder_indexing_timestamp.set(
                    { chain: chain.name },
                    Number(decodeCheckpoint(checkpoint).blockTimestamp),
                  );
                }
              } catch (error) {
                if (error instanceof NonRetryableUserError === false) {
                  common.logger.warn({
                    service: "app",
                    msg: `Retrying '${chain.name}' events for block ${Number(decodeCheckpoint(checkpoint).blockNumber)}`,
                  });
                }

                throw error;
              }
            });
          }
        }

        await database.userQB.wrap({ label: "update_checkpoints" }, (db) =>
          db
            .update(PONDER_CHECKPOINT)
            .set({ latestCheckpoint: event.checkpoint })
            .where(eq(PONDER_CHECKPOINT.chainName, event.chain.name)),
        );

        event.blockCallback?.(true);

        break;
      }
      case "reorg":
        // Note: `_ponder_checkpoint` is not called here, instead it is called
        // in the `block` case.

        await database.userQB.transaction(async (tx) => {
          await dropTriggers(tx, { tables });

          const counts = await revert(tx, {
            tables,
            checkpoint: event.checkpoint,
            preBuild,
          });

          for (const [index, table] of tables.entries()) {
            common.logger.info({
              service: "database",
              msg: `Reverted ${counts[index]} unfinalized operations from '${getTableName(table)}'`,
            });
          }

          await createTriggers(tx, { tables });
        });

        break;
      case "finalize": {
        const count = await finalize(database.userQB, {
          checkpoint: event.checkpoint,
          tables,
          preBuild,
          namespaceBuild,
        });

        common.logger.info({
          service: "database",
          msg: `Finalized ${count} operations.`,
        });

        break;
      }
      default:
        never(event);
    }
  }
}

/**
 * Compute the checkpoint across all chains.
 */
export const getOmnichainCheckpoint = <
  tag extends "start" | "end" | "current" | "finalized",
>({
  perChainSync,
  tag,
}: {
  perChainSync: Map<Chain, { syncProgress: SyncProgress }>;
  tag: tag;
}): tag extends "end" ? string | undefined : string => {
  const checkpoints = Array.from(perChainSync.values()).map(
    ({ syncProgress }) => syncProgress.getCheckpoint({ tag }),
  );

  if (tag === "end") {
    if (checkpoints.some((c) => c === undefined)) {
      return undefined as tag extends "end" ? string | undefined : string;
    }
    // Note: `max` is used here because `end` is an upper bound.
    return max(...checkpoints) as tag extends "end"
      ? string | undefined
      : string;
  }

  // Note: extra logic is needed for `current` because completed chains
  // shouldn't be included in the minimum checkpoint. However, when all
  // chains are completed, the maximum checkpoint should be computed across
  // all chains.

  if (tag === "current") {
    const isComplete = Array.from(perChainSync.values()).map(
      ({ syncProgress }) => syncProgress.isEnd(),
    );
    if (isComplete.every((c) => c)) {
      return max(...checkpoints) as tag extends "end"
        ? string | undefined
        : string;
    }
    return min(
      ...checkpoints.filter((_, i) => isComplete[i] === false),
    ) as tag extends "end" ? string | undefined : string;
  }

  return min(...checkpoints) as tag extends "end" ? string | undefined : string;
};
