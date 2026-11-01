import { eq, getTableName, isTable, isView, sql } from "drizzle-orm";
import { Clock, Deferred, Effect, Fiber, type Scope, Stream } from "effect";
import { hexToNumber } from "viem";
import {
  commitBlock,
  createIndexes,
  createLiveQueryTriggers,
  createTriggers,
  createViews,
  dropLiveQueryTriggers,
  dropTriggers,
  finalizeOmnichain,
  revertOmnichain,
} from "@/database/actions.js";
import { Db } from "@/database/db.js";
import {
  getPonderCheckpointTable,
  getPonderMetaTable,
} from "@/database/index.js";
import { getLiveQueryTempTableName } from "@/drizzle/onchain.js";
import {
  InvalidEventAccessError,
  NonRetryableUserError,
} from "@/internal/errors.js";
import { Metrics } from "@/internal/metrics.js";
import type { Options } from "@/internal/options.js";
import type {
  Chain,
  CrashRecoveryCheckpoint,
  Event,
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
  max,
  min,
  ZERO_CHECKPOINT_STRING,
} from "@/utils/checkpoint.js";
import { bufferWithSize } from "@/utils/stream.js";
import { startClockEffect } from "@/utils/timer.js";
import { zipperMany } from "@/utils/zipper.js";
import {
  type ChainEvents,
  getHistoricalEventsOmnichain,
  refetchHistoricalEvents,
} from "./historical.js";
import {
  createIndexingRuntime,
  getChainSync,
  logBackfillProgress,
  runBackfill,
  type SyncProgress,
} from "./index.js";
import {
  getRealtimeEventsOmnichain,
  logBackpressure,
  type RealtimeEvent,
} from "./realtime.js";

/**
 * Run the backfill and then live indexing of all chains in omnichain order.
 */
export const runOmnichain = ({
  preBuild,
  namespaceBuild,
  schemaBuild,
  indexingBuild,
  crashRecoveryCheckpoint,
}: {
  preBuild: PreBuild;
  namespaceBuild: NamespaceBuild;
  schemaBuild: SchemaBuild;
  indexingBuild: IndexingBuild;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
}): Effect.Effect<void, Error, Db | Options | Metrics | Scope.Scope> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const metrics = yield* Metrics;

    const syncStore = yield* createSyncStore(db.sync);

    const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);
    const PONDER_META = getPonderMetaTable(namespaceBuild.schema);

    const { cachedViemClient, indexingCache, indexingStore, indexing } =
      yield* createIndexingRuntime({
        indexingBuild,
        schemaBuild,
        crashRecoveryCheckpoint,
        syncStore,
      });

    const perChainSync = new Map(
      yield* Effect.forEach(
        indexingBuild.chains,
        (chain) =>
          Effect.map(
            getChainSync({ chain, indexingBuild, syncStore }),
            (chainSync) => [chain, chainSync] as const,
          ),
        { concurrency: "unbounded" },
      ),
    );
    const seconds: Seconds = {};

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
    }

    const startTimestamp = Math.round((yield* Clock.currentTimeMillis) / 1000);
    for (const chain of indexingBuild.chains) {
      metrics.ponder_historical_start_timestamp_seconds.set(
        { chain: chain.name },
        startTimestamp,
      );
    }
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

          yield* tx.query(
            (tx) =>
              tx
                .insert(PONDER_CHECKPOINT)
                .values(
                  indexingBuild.chains.map((chain) => {
                    const initialCheckpoint = min(
                      perChainSync
                        .get(chain)!
                        .syncProgress.getCheckpoint({ tag: "start" }),
                      perChainSync
                        .get(chain)!
                        .syncProgress.getCheckpoint({ tag: "finalized" }),
                    );

                    return {
                      chainName: chain.name,
                      chainId: chain.id,
                      latestCheckpoint: initialCheckpoint,
                      safeCheckpoint: initialCheckpoint,
                      finalizedCheckpoint: initialCheckpoint,
                    };
                  }),
                )
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

    const etaFiber = yield* Effect.forkScoped(logBackfillProgress);

    const backfillEndClock = yield* startClockEffect;

    /** Index the events of a backfill batch in one transaction. */
    const indexBlockRange = (result: ChainEvents[]) =>
      Effect.gen(function* () {
        const context = { logAnnotations: { action: "index_block_range" } };
        const indexStartClock = yield* startClockEffect;

        let events = zipperMany(
          result.map(({ events }) => events),
          (a, b) => (a.checkpoint < b.checkpoint ? -1 : 1),
        );

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
                  updateIndexingSeconds(event) {
                    const checkpoint = decodeCheckpoint(event.checkpoint);
                    for (const chain of indexingBuild.chains) {
                      metrics.ponder_historical_completed_indexing_seconds.set(
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
                            seconds[chain.name]!.end -
                              seconds[chain.name]!.start,
                            0,
                          ),
                        ),
                      );
                      metrics.ponder_indexing_timestamp.set(
                        { chain: chain.name },
                        Math.max(
                          Number(checkpoint.blockTimestamp),
                          seconds[chain.name]!.end,
                        ),
                      );
                    }
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

                // Note: It is an invariant that result.length > 0
                yield* tx.query(
                  (tx) =>
                    tx
                      .insert(PONDER_CHECKPOINT)
                      .values(
                        result.map(({ chainId, checkpoint }) => ({
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
                  { label: "update_checkpoints" },
                );

                metrics.ponder_historical_transform_duration.inc(
                  { step: "finalize" },
                  yield* endClock,
                );
                endClock = yield* startClockEffect;
              }).pipe(
                Effect.tapError((error) =>
                  Effect.gen(function* () {
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
                        duration: yield* indexStartClock,
                        error,
                      });
                      events = yield* refetchHistoricalEvents({
                        indexingBuild,
                        perChainSync,
                        syncStore,
                        events,
                      });
                    } else if (
                      error instanceof NonRetryableUserError ===
                      false
                    ) {
                      yield* Effect.logWarning({
                        msg: "Failed to index block range",
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

        for (const { chainId, events, blockRange } of result) {
          yield* Effect.logInfo({
            msg: "Indexed block range",
            chain: indexingBuild.chains.find((chain) => chain.id === chainId)!
              .name,
            chain_id: chainId,
            event_count: events.length,
            block_range: JSON.stringify(blockRange),
            duration: yield* indexStartClock,
          });
        }
      });

    let pendingEvents: Event[] = [];

    // Run historical indexing until complete.
    yield* runBackfill(
      getHistoricalEventsOmnichain({
        indexingBuild,
        crashRecoveryCheckpoint,
        perChainSync,
      }),
      (result) => {
        if (result.type === "pending") {
          pendingEvents = result.result;
          return Effect.void;
        }
        return indexBlockRange(result.result);
      },
    );

    indexingCache.clear();
    // Note: Invalidating the cache means that only predicted rows will be in memory after this point.
    indexingCache.invalidate();

    // Manually update metrics to fix a UI bug that occurs when the end
    // checkpoint is between the last processed event and the finalized
    // checkpoint.

    for (const chain of indexingBuild.chains) {
      const label = { chain: chain.name };
      metrics.ponder_historical_completed_indexing_seconds.set(
        label,
        Math.max(
          seconds[chain.name]!.end -
            Math.max(seconds[chain.name]!.cached, seconds[chain.name]!.start),
          0,
        ),
      );
      metrics.ponder_indexing_timestamp.set(label, seconds[chain.name]!.end);
    }

    const endTimestamp = Math.round((yield* Clock.currentTimeMillis) / 1000);
    for (const chain of indexingBuild.chains) {
      metrics.ponder_historical_end_timestamp_seconds.set(
        { chain: chain.name },
        endTimestamp,
      );
    }

    yield* Effect.logInfo({
      msg: "Completed backfill indexing across all chains",
      duration: yield* backfillEndClock,
    });
    yield* Fiber.interrupt(etaFiber);

    const tables = Object.values(schemaBuild.schema).filter(isTable);
    const views = Object.values(schemaBuild.schema).filter(isView);

    let endClock = yield* startClockEffect;

    yield* createIndexes(db.admin, { statements: schemaBuild.statements });

    if (schemaBuild.statements.indexes.sql.length > 0) {
      yield* Effect.logInfo({
        msg: "Created database indexes",
        count: schemaBuild.statements.indexes.sql.length,
        duration: yield* endClock,
      });
    }

    endClock = yield* startClockEffect;

    yield* createTriggers(db.admin, { tables });
    yield* createLiveQueryTriggers(db.admin, { namespaceBuild, tables });

    yield* Effect.logDebug({
      msg: "Created database triggers",
      count: tables.length,
      duration: yield* endClock,
    });

    if (namespaceBuild.viewsSchema !== undefined) {
      const endClock = yield* startClockEffect;

      yield* createViews(db.admin, { tables, views, namespaceBuild });

      yield* Effect.logInfo({
        msg: "Created database views",
        schema: namespaceBuild.viewsSchema,
        count: tables.length,
        duration: yield* endClock,
      });
    }

    yield* db.admin.query(
      (db) =>
        db
          .update(PONDER_META)
          .set({ value: sql`jsonb_set(value, '{is_ready}', to_jsonb(1))` }),
      { label: "update_ready" },
    );

    yield* Effect.logInfo({
      msg: "Started returning 200 responses",
      endpoint: "/ready",
    });

    // Note: A chain that only requires backfill indexing has no live blocks. Its
    // latest checkpoint moves to its last block once live indexing passes it.
    const initialEndChains = indexingBuild.chains.filter((chain) =>
      perChainSync.get(chain)!.syncProgress.isEnd(),
    );
    let endChains = initialEndChains;

    /** Index the events of a live block, one block at a time, in one transaction. */
    const indexBlock = (event: Extract<RealtimeEvent, { type: "block" }>) =>
      Effect.gen(function* () {
        const context = { logAnnotations: { action: "index_block" } };
        const endClock = yield* startClockEffect;

        const completedEndChains = endChains.filter(
          (chain) =>
            perChainSync
              .get(chain)!
              .syncProgress.getCheckpoint({ tag: "current" }) <
            event.checkpoint,
        );

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

              // Note: The events can include blocks of other chains, such as the
              // pending events of the backfill.
              const latestCheckpoints = new Map<string, string>();

              // Events must be run block-by-block, so that `database.commitBlock` can accurately
              // update the temporary `checkpoint` value set in the trigger.
              for (const { checkpoint, events } of splitEvents(event.events)) {
                const chain = indexingBuild.chains.find(
                  (chain) =>
                    chain.id === Number(decodeCheckpoint(checkpoint).chainId),
                )!;
                latestCheckpoints.set(chain.name, checkpoint);

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

                for (const chain of indexingBuild.chains) {
                  metrics.ponder_indexing_timestamp.set(
                    { chain: chain.name },
                    Number(decodeCheckpoint(checkpoint).blockTimestamp),
                  );
                }
              }

              for (const chain of completedEndChains) {
                latestCheckpoints.set(
                  chain.name,
                  perChainSync
                    .get(chain)!
                    .syncProgress.getCheckpoint({ tag: "current" }),
                );
              }
              latestCheckpoints.set(event.chain.name, event.checkpoint);

              yield* Effect.gen(function* () {
                for (const [chainName, checkpoint] of latestCheckpoints) {
                  yield* tx.query(
                    (db) =>
                      db
                        .update(PONDER_CHECKPOINT)
                        .set({ latestCheckpoint: checkpoint })
                        .where(eq(PONDER_CHECKPOINT.chainName, chainName)),
                    { label: "update_checkpoints", ...context },
                  );
                }

                if (db.dialect === "pglite") {
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

        endChains = endChains.filter(
          (chain) => completedEndChains.includes(chain) === false,
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

        yield* db.user.transaction((tx) =>
          Effect.gen(function* () {
            yield* dropTriggers(tx, { tables }, context);
            yield* dropLiveQueryTriggers(
              tx,
              { namespaceBuild, tables },
              context,
            );

            const counts = yield* revertOmnichain(
              tx,
              { tables, checkpoint: event.checkpoint },
              context,
            );

            for (const [index, table] of tables.entries()) {
              yield* Effect.logDebug({
                msg: "Reverted reorged database rows",
                table: getTableName(table),
                row_count: counts[index],
              });
            }

            yield* createTriggers(tx, { tables }, context);
            yield* createLiveQueryTriggers(
              tx,
              { namespaceBuild, tables },
              context,
            );
          }),
        );

        indexingCache.clear();
        cachedViemClient.reorg({
          chainId: event.chain.id,
          checkpoint: event.checkpoint,
        });

        // Note: The reorg can revert the pending events of a chain that only
        // requires backfill indexing, which live indexing indexes again.
        endChains = initialEndChains.filter(
          (chain) =>
            endChains.includes(chain) ||
            perChainSync
              .get(chain)!
              .syncProgress.getCheckpoint({ tag: "current" }) >
              event.checkpoint,
        );

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

        yield* finalizeOmnichain(
          db.user,
          {
            checkpoint: event.checkpoint,
            // Note: The checkpoint can be after the finalized block of a chain
            // that only requires backfill indexing.
            chainNames: indexingBuild.chains
              .filter(
                (chain) =>
                  perChainSync
                    .get(chain)!
                    .syncProgress.getCheckpoint({ tag: "finalized" }) >=
                  event.checkpoint,
              )
              .map((chain) => chain.name),
            tables,
            namespaceBuild,
          },
          context,
        );

        for (const chain of indexingBuild.chains) {
          yield* cachedViemClient.finalize({
            chainId: chain.id,
            checkpoint: event.checkpoint,
          });
        }

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
    for (const [chain, { syncProgress }] of perChainSync) {
      yield* cachedViemClient.finalize({
        chainId: chain.id,
        checkpoint: syncProgress.getCheckpoint({ tag: "finalized" }),
      });
    }

    yield* bufferWithSize(
      getRealtimeEventsOmnichain({
        indexingBuild,
        perChainSync,
        pendingEvents,
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
      msg: "Completed indexing across all chains",
      duration: yield* backfillEndClock,
    });
  });

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

  // Note: extra logic is needed for `current` and `finalized` because completed
  // chains shouldn't be included in the minimum checkpoint. However, when all
  // chains are completed, the maximum checkpoint should be computed across
  // all chains. A chain is completed for `current` once its end block is
  // indexed, and for `finalized` once its end block is finalized.

  if (tag === "current" || tag === "finalized") {
    const isComplete = Array.from(perChainSync.values()).map(
      ({ syncProgress }) =>
        tag === "current"
          ? syncProgress.isEnd()
          : syncProgress.end !== undefined &&
            hexToNumber(syncProgress.end.number) <=
              hexToNumber(syncProgress.finalized.number),
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
