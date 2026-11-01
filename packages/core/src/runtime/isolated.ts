import { eq, getTableName, isTable, sql } from "drizzle-orm";
import { Clock, Deferred, Effect, type Scope, Stream } from "effect";
import {
  commitBlock,
  createLiveQueryTriggers,
  createTriggers,
  dropLiveQueryTriggers,
  dropTriggers,
  finalizeIsolated,
  revertIsolated,
} from "@/database/actions.js";
import { Db } from "@/database/db.js";
import { getPonderCheckpointTable } from "@/database/index.js";
import { getLiveQueryTempTableName } from "@/drizzle/onchain.js";
import {
  InvalidEventAccessError,
  NonRetryableUserError,
} from "@/internal/errors.js";
import { Metrics } from "@/internal/metrics.js";
import type { Options } from "@/internal/options.js";
import type {
  CrashRecoveryCheckpoint,
  IndexingBuild,
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
  Seconds,
} from "@/internal/types.js";
import { splitEvents } from "@/runtime/events.js";
import { createSyncStore } from "@/sync-store/index.js";
import {
  decodeCheckpoint,
  min,
  ZERO_CHECKPOINT_STRING,
} from "@/utils/checkpoint.js";
import { bufferWithSize } from "@/utils/stream.js";
import { startClockEffect } from "@/utils/timer.js";
import {
  type ChainEvents,
  getHistoricalEventsIsolated,
  refetchHistoricalEvents,
} from "./historical.js";
import { createIndexingRuntime, getChainSync, runBackfill } from "./index.js";
import {
  getRealtimeEventsIsolated,
  logBackpressure,
  type RealtimeEvent,
} from "./realtime.js";

/**
 * Run the backfill and then live indexing of one chain, with the rows of the
 * chain in their own partitions.
 *
 * @param onReady - Called once the backfill is complete.
 */
export const runIsolated = ({
  preBuild,
  namespaceBuild,
  schemaBuild,
  indexingBuild,
  crashRecoveryCheckpoint,
  onReady,
}: {
  preBuild: PreBuild;
  namespaceBuild: NamespaceBuild;
  schemaBuild: SchemaBuild;
  indexingBuild: IndexingBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  onReady: Effect.Effect<void>;
}): Effect.Effect<void, Error, Db | Options | Metrics | Scope.Scope> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const metrics = yield* Metrics;

    const chain = indexingBuild.chains[0]!;

    const syncStore = yield* createSyncStore(db.sync);

    const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);

    const { cachedViemClient, indexingCache, indexingStore, indexing } =
      yield* createIndexingRuntime({
        indexingBuild,
        schemaBuild,
        crashRecoveryCheckpoint,
        syncStore,
        chainId: chain.id,
      });

    const seconds: Seconds = {};

    const { syncProgress, childAddresses, cachedIntervals, unfinalizedBlocks } =
      yield* getChainSync({ chain, indexingBuild, syncStore });

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
    metrics.ponder_historical_total_indexing_seconds.set(
      label,
      Math.max(seconds[chain.name]!.end - seconds[chain.name]!.start, 0),
    );
    metrics.ponder_historical_cached_indexing_seconds.set(
      label,
      Math.max(seconds[chain.name]!.cached - seconds[chain.name]!.start, 0),
    );
    metrics.ponder_historical_completed_indexing_seconds.set(label, 0);
    metrics.ponder_indexing_timestamp.set(
      label,
      Math.max(seconds[chain.name]!.cached, seconds[chain.name]!.start),
    );

    const startTimestamp = Math.round((yield* Clock.currentTimeMillis) / 1000);
    metrics.ponder_historical_start_timestamp_seconds.set(
      label,
      startTimestamp,
    );

    // Reset the start timestamp so the eta estimate doesn't include
    // the startup time.
    metrics.start_timestamp = yield* Clock.currentTimeMillis;

    // If the initial checkpoint is zero, we need to run setup events.
    if (crashRecoveryCheckpoint === undefined) {
      yield* db.user.transaction((tx) =>
        Effect.gen(function* () {
          indexingStore.client = tx;
          indexingStore.isProcessingEvents = true;

          indexingCache.client = tx;

          yield* indexing.processSetupEvents;

          indexingStore.isProcessingEvents = false;

          yield* indexingCache.flush();

          const initialCheckpoint = min(
            syncProgress.getCheckpoint({ tag: "start" }),
            syncProgress.getCheckpoint({ tag: "finalized" }),
          );

          yield* tx.query(
            (tx) =>
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
            { label: "update_checkpoints" },
          );
        }),
      );
    }

    const backfillEndClock = yield* startClockEffect;

    /** Index the events of a backfill batch in one transaction. */
    const indexBlockRange = ({
      events: _events,
      chainId,
      checkpoint,
      blockRange,
    }: ChainEvents) =>
      Effect.gen(function* () {
        const context = { logAnnotations: { action: "index_block_range" } };
        const indexStartClock = yield* startClockEffect;

        let events = _events;

        indexingCache.client = db.user;
        yield* Effect.all(
          [
            indexingCache.prefetch({ events }),
            cachedViemClient.prefetch({ events }),
          ],
          { concurrency: "unbounded", discard: true },
        );
        metrics.ponder_historical_transform_duration.inc(
          { step: "prefetch" },
          yield* indexStartClock,
        );

        let endClock = yield* startClockEffect;
        yield* db.user.transaction(
          (tx) =>
            Effect.gen(function* () {
              const initialCompletedEvents = structuredClone(
                yield* Effect.promise(() =>
                  metrics.ponder_indexing_completed_events.get(),
                ),
              );

              yield* Effect.gen(function* () {
                indexingStore.client = tx;
                indexingStore.isProcessingEvents = true;
                indexingCache.client = tx;

                metrics.ponder_historical_transform_duration.inc(
                  { step: "begin" },
                  yield* endClock,
                );

                endClock = yield* startClockEffect;

                yield* indexing.processHistoricalEvents({
                  events,
                  updateIndexingSeconds(event, chain) {
                    const checkpoint = decodeCheckpoint(event.checkpoint);

                    metrics.ponder_historical_completed_indexing_seconds.set(
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
                    metrics.ponder_indexing_timestamp.set(
                      { chain: chain.name },
                      Number(checkpoint.blockTimestamp),
                    );
                  },
                });

                indexingStore.isProcessingEvents = false;

                metrics.ponder_historical_transform_duration.inc(
                  { step: "index" },
                  yield* endClock,
                );

                endClock = yield* startClockEffect;

                // Note: at this point, the next events can be preloaded, as long as the are not indexed until
                // the "flush" + "finalize" is complete.

                yield* indexingCache.flush();

                metrics.ponder_historical_transform_duration.inc(
                  { step: "load" },
                  yield* endClock,
                );

                endClock = yield* startClockEffect;

                yield* tx.query(
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
                  { label: "update_checkpoints", ...context },
                );

                metrics.ponder_historical_transform_duration.inc(
                  { step: "finalize" },
                  yield* endClock,
                );
                endClock = yield* startClockEffect;
              }).pipe(
                Effect.tapError((error) =>
                  Effect.gen(function* () {
                    // Note: This can cause a bug with "dev" command, because there are multiple instances
                    // updating the same metric.
                    metrics.flushIndexingMetrics();
                    for (const value of initialCompletedEvents.values) {
                      metrics.ponder_indexing_completed_events.set(
                        value.labels,
                        value.value,
                      );
                    }

                    indexingCache.invalidate();
                    indexingCache.clear();

                    if (error instanceof InvalidEventAccessError) {
                      yield* Effect.logDebug({
                        msg: "Failed to index block range",
                        chain: chain.name,
                        chain_id: chain.id,
                        block_range: JSON.stringify(blockRange),
                        duration: yield* indexStartClock,
                        error,
                      });
                      events = yield* refetchHistoricalEvents({
                        indexingBuild,
                        perChainSync: new Map([[chain, { childAddresses }]]),
                        syncStore,
                        events,
                      });
                    } else if (
                      error instanceof NonRetryableUserError ===
                      false
                    ) {
                      yield* Effect.logWarning({
                        msg: "Failed to index block range",
                        chain: chain.name,
                        chain_id: chain.id,
                        block_range: JSON.stringify(blockRange),
                        duration: yield* indexStartClock,
                        error,
                      });
                    }
                  }),
                ),
              );
            }),
          context,
        );

        cachedViemClient.clear();
        metrics.ponder_historical_transform_duration.inc(
          { step: "commit" },
          yield* endClock,
        );

        yield* Effect.yieldNow;

        yield* Effect.logInfo({
          msg: "Indexed block range",
          chain: chain.name,
          chain_id: chain.id,
          event_count: events.length,
          block_range: JSON.stringify(blockRange),
          duration: yield* indexStartClock,
        });
      });

    // Run historical indexing until complete.
    yield* runBackfill(
      getHistoricalEventsIsolated({
        chain,
        indexingBuild,
        crashRecoveryCheckpoint,
        syncProgress,
        childAddresses,
        cachedIntervals,
      }).pipe(Stream.buffer({ capacity: 1 })),
      indexBlockRange,
    );

    indexingCache.clear();
    // Note: Invalidating the cache means that only predicted rows will be in memory after this point.
    indexingCache.invalidate();

    // Manually update metrics to fix a UI bug that occurs when the end
    // checkpoint is between the last processed event and the finalized
    // checkpoint.

    metrics.ponder_historical_completed_indexing_seconds.set(
      label,
      Math.max(
        seconds[chain.name]!.end -
          Math.max(seconds[chain.name]!.cached, seconds[chain.name]!.start),
        0,
      ),
    );
    metrics.ponder_indexing_timestamp.set(label, seconds[chain.name]!.end);

    const endTimestamp = Math.round((yield* Clock.currentTimeMillis) / 1000);
    metrics.ponder_historical_end_timestamp_seconds.set(label, endTimestamp);

    yield* Effect.logInfo({
      msg: "Completed backfill indexing",
      chain: chain.name,
      chain_id: chain.id,
      duration: yield* backfillEndClock,
    });

    const tables = Object.values(schemaBuild.schema).filter(isTable);

    const endClock = yield* startClockEffect;

    yield* createTriggers(db.admin, { tables, chainId: chain.id });
    yield* createLiveQueryTriggers(db.admin, {
      namespaceBuild,
      tables,
      chainId: chain.id,
    });

    yield* Effect.logDebug({
      msg: "Created database triggers",
      chain: chain.name,
      chain_id: chain.id,
      count: tables.length,
      duration: yield* endClock,
    });

    yield* onReady;

    /** Index the events of a live block, one block at a time, in one transaction. */
    const indexBlock = (event: Extract<RealtimeEvent, { type: "block" }>) =>
      Effect.gen(function* () {
        const context = { logAnnotations: { action: "index_block" } };
        const endClock = yield* startClockEffect;

        indexingCache.client = db.user;
        yield* Effect.all(
          [
            indexingCache.prefetch({ events: event.events }),
            cachedViemClient.prefetch({ events: event.events }),
          ],
          { concurrency: "unbounded", discard: true },
        );

        yield* db.user.transaction(
          (tx) =>
            Effect.gen(function* () {
              if (db.dialect === "postgres") {
                yield* tx.query(
                  (tx) =>
                    tx.execute(
                      `CREATE TEMP TABLE ${getLiveQueryTempTableName()} (table_name TEXT PRIMARY KEY) ON COMMIT DROP`,
                    ),
                  context,
                );
              } else {
                yield* tx.query(
                  (tx) =>
                    tx.execute(
                      `CREATE TEMP TABLE IF NOT EXISTS ${getLiveQueryTempTableName()} (table_name TEXT PRIMARY KEY)`,
                    ),
                  context,
                );
              }

              // Events must be run block-by-block, so that `database.commitBlock` can accurately
              // update the temporary `checkpoint` value set in the trigger.
              for (const { checkpoint, events } of splitEvents(event.events)) {
                yield* Effect.gen(function* () {
                  indexingStore.client = tx;
                  indexingStore.isProcessingEvents = true;
                  indexingCache.client = tx;

                  yield* Effect.logTrace({
                    msg: "Processing block events",
                    chain: chain.name,
                    chain_id: chain.id,
                    number: Number(decodeCheckpoint(checkpoint).blockNumber),
                    event_count: events.length,
                  });

                  yield* indexing.processRealtimeEvents({ events });

                  yield* Effect.logTrace({
                    msg: "Processed block events",
                    chain: chain.name,
                    chain_id: chain.id,
                    number: Number(decodeCheckpoint(checkpoint).blockNumber),
                    event_count: events.length,
                  });

                  indexingStore.isProcessingEvents = false;

                  yield* indexingCache.flush();

                  yield* Effect.forEach(
                    tables,
                    (table) =>
                      commitBlock(tx, { table, checkpoint, preBuild }, context),
                    { concurrency: "unbounded", discard: true },
                  );

                  cachedViemClient.clear();

                  yield* Effect.logTrace({
                    msg: "Committed reorg data for block",
                    chain: chain.name,
                    chain_id: chain.id,
                    number: Number(decodeCheckpoint(checkpoint).blockNumber),
                    event_count: events.length,
                    checkpoint,
                  });

                  metrics.ponder_indexing_timestamp.set(
                    { chain: chain.name },
                    Number(decodeCheckpoint(checkpoint).blockTimestamp),
                  );
                }).pipe(
                  Effect.tapError((error) =>
                    Effect.gen(function* () {
                      indexingCache.clear();

                      if (error instanceof NonRetryableUserError === false) {
                        yield* Effect.logWarning({
                          msg: "Failed to index block",
                          chain: chain.name,
                          chain_id: chain.id,
                          number: Number(
                            decodeCheckpoint(checkpoint).blockNumber,
                          ),
                          error,
                        });
                      }
                    }),
                  ),
                );
              }

              yield* Effect.gen(function* () {
                yield* tx.query(
                  (db) =>
                    db
                      .update(PONDER_CHECKPOINT)
                      .set({ latestCheckpoint: event.checkpoint })
                      .where(eq(PONDER_CHECKPOINT.chainName, event.chain.name)),
                  { label: "update_checkpoints", ...context },
                );

                if (event.events.length > 0 && db.dialect === "pglite") {
                  yield* tx.query(
                    (tx) =>
                      tx.execute(
                        `TRUNCATE TABLE ${getLiveQueryTempTableName()}`,
                      ),
                    context,
                  );
                }
              }).pipe(
                Effect.tapError(() =>
                  Effect.sync(() => {
                    indexingCache.invalidate();
                    indexingCache.clear();
                  }),
                ),
              );
            }),
          context,
        );

        if (event.isAccepted) yield* Deferred.succeed(event.isAccepted, true);

        yield* Effect.logInfo({
          msg: "Indexed block",
          chain: event.chain.name,
          chain_id: event.chain.id,
          number: Number(decodeCheckpoint(event.checkpoint).blockNumber),
          event_count: event.events.length,
          duration: yield* endClock,
        });
      });

    /** Revert the rows of the reorged blocks. */
    const reorgBlock = (event: Extract<RealtimeEvent, { type: "reorg" }>) =>
      Effect.gen(function* () {
        const context = { logAnnotations: { action: "reorg_block" } };
        const endClock = yield* startClockEffect;

        // Note: `_ponder_checkpoint` is not called here, instead it is called
        // in the `block` case.

        yield* db.user.transaction(
          (tx) =>
            Effect.gen(function* () {
              yield* dropTriggers(tx, { tables, chainId: chain.id }, context);
              yield* dropLiveQueryTriggers(
                tx,
                { namespaceBuild, tables, chainId: chain.id },
                context,
              );

              const counts = yield* revertIsolated(
                tx,
                { checkpoint: event.checkpoint, tables },
                context,
              );

              for (const [index, table] of tables.entries()) {
                yield* Effect.logDebug({
                  msg: "Reverted reorged database rows",
                  chain: chain.name,
                  chain_id: chain.id,
                  table: getTableName(table),
                  row_count: counts[index],
                });
              }

              yield* createTriggers(tx, { tables, chainId: chain.id }, context);
              yield* createLiveQueryTriggers(
                tx,
                { namespaceBuild, tables, chainId: chain.id },
                context,
              );
            }),
          context,
        );

        indexingCache.clear();
        cachedViemClient.reorg({
          chainId: event.chain.id,
          checkpoint: event.checkpoint,
        });

        yield* Effect.logInfo({
          msg: "Reorged block",
          chain: event.chain.name,
          chain_id: event.chain.id,
          number: Number(decodeCheckpoint(event.checkpoint).blockNumber),
          duration: yield* endClock,
        });
      });

    /** Remove the reorg data of the finalized blocks. */
    const finalizeBlock = (
      event: Extract<RealtimeEvent, { type: "finalize" }>,
    ) =>
      Effect.gen(function* () {
        const context = { logAnnotations: { action: "finalize_block" } };
        const endClock = yield* startClockEffect;

        yield* finalizeIsolated(
          db.user,
          { checkpoint: event.checkpoint, tables, namespaceBuild },
          context,
        );

        yield* cachedViemClient.finalize({
          chainId: event.chain.id,
          checkpoint: event.checkpoint,
        });

        yield* Effect.logInfo({
          msg: "Finalized block",
          chain: event.chain.name,
          chain_id: event.chain.id,
          number: Number(decodeCheckpoint(event.checkpoint).blockNumber),
          duration: yield* endClock,
        });
      });

    // Note: The events of the backfill are finalized, so the results of their
    // requests are written at once.
    yield* cachedViemClient.finalize({
      chainId: chain.id,
      checkpoint: syncProgress.getCheckpoint({ tag: "finalized" }),
    });

    yield* bufferWithSize(
      getRealtimeEventsIsolated({
        indexingBuild,
        chain,
        syncProgress,
        childAddresses,
        unfinalizedBlocks,
      }),
      {
        capacity: 100,
        onSize: (bufferSize) =>
          logBackpressure(bufferSize, { indexing_step: "index block" }),
      },
    ).pipe(
      Stream.runForEach((event) => {
        switch (event.type) {
          case "block":
            return indexBlock(event);
          case "reorg":
            return reorgBlock(event);
          case "finalize":
            return finalizeBlock(event);
        }
      }),
    );

    yield* Effect.logInfo({
      msg: "Completed indexing",
      chain: chain.name,
      chain_id: chain.id,
      duration: yield* backfillEndClock,
    });
  });
