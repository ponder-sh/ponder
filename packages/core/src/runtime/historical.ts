import { Clock, Effect, Option, Stream } from "effect";
import { hexToNumber } from "viem";
import { Db } from "@/database/db.js";
import { Metrics } from "@/internal/metrics.js";
import { Options } from "@/internal/options.js";
import type {
  Chain,
  CrashRecoveryCheckpoint,
  Event,
  EventCallback,
  IndexingBuild,
  LightBlock,
  RawEvent,
} from "@/internal/types.js";
import { eth_getBlockByNumber } from "@/rpc/actions.js";
import type { Rpc } from "@/rpc/index.js";
import { buildEvents, decodeEvents } from "@/runtime/events.js";
import { createInMemoryHistoricalSync } from "@/sync-historical/in-memory.js";
import { createHistoricalSync } from "@/sync-historical/index.js";
import { createSyncStore, type SyncStore } from "@/sync-store/index.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  MAX_CHECKPOINT,
  min,
  ZERO_CHECKPOINT,
} from "@/utils/checkpoint.js";
import { getFinalizedBlock } from "@/utils/finality.js";
import { formatPercentage } from "@/utils/format.js";
import { type Interval, intervalSum } from "@/utils/interval.js";
import { partition } from "@/utils/partition.js";
import { latestWithin, mergePulls, mergeUnordered } from "@/utils/stream.js";
import { startClockEffect } from "@/utils/timer.js";
import {
  type CachedIntervals,
  type ChildAddresses,
  getRequiredIntervals,
  getRequiredIntervalsPerPiece,
  getRequiredIntervalsWithFilters,
  type SyncProgress,
} from "./index.js";
import { getOmnichainCheckpoint } from "./omnichain.js";

/** Events of a chain, up to `checkpoint`, in the blocks of `blockRange`. */
export type ChainEvents = {
  chainId: number;
  events: Event[];
  checkpoint: string;
  blockRange: [number, number];
};

/** Raw events of a chain, up to `checkpoint`, in the blocks of `blockRange`. */
type RawChainEvents = {
  events: RawEvent[];
  checkpoint: string;
  blockRange: [number, number];
};

type PerChainSync = Map<
  Chain,
  {
    syncProgress: SyncProgress;
    childAddresses: ChildAddresses;
    cachedIntervals: CachedIntervals;
  }
>;

export type HistoricalEventsOmnichain =
  | { type: "events"; result: ChainEvents[] }
  /** Events that are synced, but must be indexed in the live phase. */
  | { type: "pending"; result: Event[] };

/**
 * Stream the backfill events of all chains in omnichain order.
 *
 * Note: After the backfill, the finalized blocks are refetched and the backfill
 * catches up to them, until the backfill takes less than the reorg window.
 */
export const getHistoricalEventsOmnichain = (params: {
  indexingBuild: Pick<IndexingBuild, "eventCallbacks" | "chains" | "rpcs">;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  perChainSync: PerChainSync;
}): Stream.Stream<HistoricalEventsOmnichain, Error, Db | Options | Metrics> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const db = yield* Db;
      const syncStore = yield* createSyncStore(db.sync);
      const limit = yield* getEventsQueryLimit(params.indexingBuild);
      const isBackfillCaughtUp = yield* makeIsBackfillCaughtUp(
        params.indexingBuild.chains,
      );
      let pendingEvents: Event[] = [];
      const perChainCursor = new Map<Chain, string>();

      const getChainEvents = (
        chain: Chain,
        isCatchup: boolean,
      ): Stream.Stream<ChainEvents, Error, Db | Options | Metrics> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const { syncProgress, childAddresses, cachedIntervals } =
              params.perChainSync.get(chain)!;
            const chainIndex = params.indexingBuild.chains.findIndex(
              (c) => c.id === chain.id,
            );
            const rpc = params.indexingBuild.rpcs[chainIndex]!;
            const eventCallbacks =
              params.indexingBuild.eventCallbacks[chainIndex]!;

            const crashRecoveryCheckpoint =
              params.crashRecoveryCheckpoint?.find(
                ({ chainId }) => chainId === chain.id,
              )?.checkpoint;

            const to = min(
              syncProgress.getCheckpoint({ tag: "finalized" }),
              syncProgress.getCheckpoint({ tag: "end" }),
            );
            const omnichainTo = min(
              getOmnichainCheckpoint({
                perChainSync: params.perChainSync,
                tag: "finalized",
              }),
              getOmnichainCheckpoint({
                perChainSync: params.perChainSync,
                tag: "end",
              }),
            );

            let from: string;
            let pending: Stream.Stream<ChainEvents> = Stream.empty;

            if (isCatchup === false) {
              from = yield* getBackfillFrom({
                chain,
                syncProgress,
                crashRecoveryCheckpoint,
                syncStore,
              });
            } else {
              // Previous iterations `to` value
              const cursor = perChainCursor.get(chain)!;

              // Emit pending events from previous iterations. Note that it is possible for
              // previous pending events to still be pending after the catchup.

              const events = pendingEvents.filter(
                (event) =>
                  event.chain.id === chain.id &&
                  event.checkpoint <= omnichainTo,
              );

              pendingEvents = pendingEvents.filter(
                (event) =>
                  (event.chain.id === chain.id &&
                    event.checkpoint <= omnichainTo) === false,
              );

              if (events.length > 0) {
                const checkpoint =
                  omnichainTo >= cursor
                    ? cursor
                    : events[events.length - 1]!.checkpoint;

                pending = Stream.succeed<ChainEvents>({
                  chainId: chain.id,
                  events,
                  checkpoint,
                  blockRange: [
                    Number(decodeCheckpoint(events[0]!.checkpoint).blockNumber),
                    Number(decodeCheckpoint(checkpoint).blockNumber),
                  ],
                });
              }

              from = getNextCheckpoint(cursor);

              if (from > to) return pending;
            }

            yield* logStartedBackfill({ chain, from, to });

            const events = getLocalEvents({
              chain,
              rpc,
              eventCallbacks,
              childAddresses,
              syncProgress,
              cachedIntervals,
              from,
              to,
              limit,
              isCatchup,
            }).pipe(
              Stream.mapEffect(
                ({ events: rawEvents, checkpoint, blockRange }) =>
                  Effect.gen(function* () {
                    let events = yield* decodeChainEvents({
                      chain,
                      eventCallbacks,
                      rawEvents,
                      crashRecoveryCheckpoint,
                    });

                    // Sort out any events between the omnichain finalized checkpoint and the single-chain
                    // finalized checkpoint and add them to pendingEvents. These events are synced during
                    // the historical phase, but must be indexed in the realtime phase because events
                    // synced in realtime on other chains might be ordered before them.

                    if (checkpoint <= omnichainTo) {
                      return [
                        { chainId: chain.id, events, checkpoint, blockRange },
                      ];
                    }

                    const [left, right] = partition(
                      events,
                      (event) => event.checkpoint <= omnichainTo,
                    );
                    events = left;
                    pendingEvents = pendingEvents.concat(right);

                    yield* Effect.logTrace({
                      msg: "Filtered pending events",
                      chain: chain.name,
                      chain_id: chain.id,
                      event_count: right.length,
                      checkpoint: omnichainTo,
                    });

                    if (left.length === 0) return [];

                    const lastCheckpoint = left[left.length - 1]!.checkpoint;
                    return [
                      {
                        chainId: chain.id,
                        events,
                        checkpoint: lastCheckpoint,
                        blockRange: [
                          blockRange[0],
                          Number(decodeCheckpoint(lastCheckpoint).blockNumber),
                        ] satisfies [number, number],
                      },
                    ];
                  }),
              ),
              Stream.flattenIterable,
              Stream.concat(
                Stream.fromEffectDrain(
                  Effect.sync(() => perChainCursor.set(chain, to)),
                ),
              ),
            );

            return Stream.concat(pending, events);
          }),
        );

      const rounds = (
        isCatchup: boolean,
      ): Stream.Stream<
        HistoricalEventsOmnichain,
        Error,
        Db | Options | Metrics
      > =>
        mergeHistoricalEventsOmnichain(
          Array.from(params.perChainSync.keys()).map((chain) =>
            getChainEvents(chain, isCatchup),
          ),
        ).pipe(
          Stream.map(
            (result): HistoricalEventsOmnichain => ({ type: "events", result }),
          ),
          Stream.concat(
            Stream.unwrap(
              Effect.gen(function* () {
                if (yield* isBackfillCaughtUp) return Stream.empty;

                const finalizedBlocks = yield* refetchFinalizedBlocks(params);

                for (const [
                  i,
                  chain,
                ] of params.indexingBuild.chains.entries()) {
                  const { syncProgress } = params.perChainSync.get(chain)!;
                  const finalizedBlock = finalizedBlocks[i]!;

                  if (
                    hexToNumber(finalizedBlock.number) <
                    hexToNumber(syncProgress.finalized.number)
                  ) {
                    return yield* Effect.fail(
                      new Error(
                        `Finalized block for chain "${chain.name}" cannot move backwards`,
                      ),
                    );
                  }

                  syncProgress.finalized = finalizedBlock;
                }

                return rounds(true);
              }),
            ),
          ),
        );

      return rounds(false).pipe(
        Stream.concat(
          Stream.suspend(() =>
            Stream.succeed<HistoricalEventsOmnichain>({
              type: "pending",
              result: pendingEvents,
            }),
          ),
        ),
      );
    }),
  );

/**
 * Stream the backfill events of all chains, in order for each chain.
 *
 * Note: After the backfill, the finalized blocks are refetched and the backfill
 * catches up to them, until the backfill takes less than the reorg window.
 */
export const getHistoricalEventsMultichain = (params: {
  indexingBuild: Pick<IndexingBuild, "eventCallbacks" | "chains" | "rpcs">;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  perChainSync: PerChainSync;
}): Stream.Stream<ChainEvents, Error, Db | Options | Metrics> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const db = yield* Db;
      const syncStore = yield* createSyncStore(db.sync);
      const limit = yield* getEventsQueryLimit(params.indexingBuild);
      const isBackfillCaughtUp = yield* makeIsBackfillCaughtUp(
        params.indexingBuild.chains,
      );
      const perChainCursor = new Map<Chain, string>();

      const getChainEvents = (
        chain: Chain,
        isCatchup: boolean,
      ): Stream.Stream<ChainEvents, Error, Db | Options | Metrics> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const { syncProgress, childAddresses, cachedIntervals } =
              params.perChainSync.get(chain)!;
            const chainIndex = params.indexingBuild.chains.findIndex(
              (c) => c.id === chain.id,
            );
            const rpc = params.indexingBuild.rpcs[chainIndex]!;
            const eventCallbacks =
              params.indexingBuild.eventCallbacks[chainIndex]!;

            const crashRecoveryCheckpoint =
              params.crashRecoveryCheckpoint?.find(
                ({ chainId }) => chainId === chain.id,
              )?.checkpoint;

            const to = min(
              syncProgress.getCheckpoint({ tag: "finalized" }),
              syncProgress.getCheckpoint({ tag: "end" }),
            );

            let from: string;
            if (isCatchup === false) {
              from = yield* getBackfillFrom({
                chain,
                syncProgress,
                crashRecoveryCheckpoint,
                syncStore,
              });
            } else {
              from = getNextCheckpoint(perChainCursor.get(chain)!);
              if (from > to) return Stream.empty;
            }

            yield* logStartedBackfill({ chain, from, to });

            return getLocalEvents({
              chain,
              rpc,
              eventCallbacks,
              childAddresses,
              syncProgress,
              cachedIntervals,
              from,
              to,
              limit,
              isCatchup,
            }).pipe(
              Stream.mapEffect(({ events, checkpoint, blockRange }) =>
                Effect.map(
                  decodeChainEvents({
                    chain,
                    eventCallbacks,
                    rawEvents: events,
                    crashRecoveryCheckpoint,
                  }),
                  (events): ChainEvents => ({
                    chainId: chain.id,
                    events,
                    checkpoint,
                    blockRange,
                  }),
                ),
              ),
              Stream.concat(
                Stream.fromEffectDrain(
                  Effect.sync(() => perChainCursor.set(chain, to)),
                ),
              ),
            );
          }),
        );

      const rounds = (
        isCatchup: boolean,
      ): Stream.Stream<ChainEvents, Error, Db | Options | Metrics> =>
        mergeUnordered(
          Array.from(params.perChainSync.keys()).map((chain) =>
            getChainEvents(chain, isCatchup),
          ),
          { bufferSize: 1 },
        ).pipe(
          Stream.concat(
            Stream.unwrap(
              Effect.gen(function* () {
                if (yield* isBackfillCaughtUp) return Stream.empty;

                const finalizedBlocks = yield* refetchFinalizedBlocks(params);

                for (const [
                  i,
                  chain,
                ] of params.indexingBuild.chains.entries()) {
                  const { syncProgress } = params.perChainSync.get(chain)!;
                  const finalizedBlock = finalizedBlocks[i]!;

                  if (
                    hexToNumber(finalizedBlock.number) <
                    hexToNumber(syncProgress.finalized.number)
                  ) {
                    continue;
                  }

                  syncProgress.finalized = finalizedBlock;
                }

                return rounds(true);
              }),
            ),
          ),
        );

      return rounds(false);
    }),
  );

/**
 * Stream the backfill events of one chain, in order.
 *
 * Note: After the backfill, the finalized block is refetched and the backfill
 * catches up to it, until the backfill takes less than the reorg window.
 */
export const getHistoricalEventsIsolated = (params: {
  indexingBuild: Pick<IndexingBuild, "eventCallbacks" | "chains" | "rpcs">;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  chain: Chain;
  syncProgress: SyncProgress;
  childAddresses: ChildAddresses;
  cachedIntervals: CachedIntervals;
}): Stream.Stream<ChainEvents, Error, Db | Options | Metrics> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const chainIndex = params.indexingBuild.chains.findIndex(
        (c) => c.id === params.chain.id,
      );
      const rpc = params.indexingBuild.rpcs[chainIndex]!;
      const eventCallbacks = params.indexingBuild.eventCallbacks[chainIndex]!;
      const limit = yield* getEventsQueryLimit(params.indexingBuild);
      const isBackfillCaughtUp = yield* makeIsBackfillCaughtUp(
        params.indexingBuild.chains,
      );

      const crashRecoveryCheckpoint = params.crashRecoveryCheckpoint?.find(
        ({ chainId }) => chainId === params.chain.id,
      )?.checkpoint;

      const rounds = (
        cursor: string | undefined,
      ): Stream.Stream<ChainEvents, Error, Db | Options | Metrics> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const to = min(
              params.syncProgress.getCheckpoint({ tag: "finalized" }),
              params.syncProgress.getCheckpoint({ tag: "end" }),
            );

            let from: string;
            if (cursor === undefined) {
              // In order to speed up the "extract" phase when there is a crash recovery,
              // the beginning cursor is moved forwards. This only works when `crashRecoveryCheckpoint`
              // is defined.
              if (
                crashRecoveryCheckpoint !== undefined &&
                Number(decodeCheckpoint(crashRecoveryCheckpoint).chainId) ===
                  params.chain.id
              ) {
                from = crashRecoveryCheckpoint;
              } else {
                from = params.syncProgress.getCheckpoint({ tag: "start" });
              }
            } else {
              from = getNextCheckpoint(cursor);
              if (from > to) return Stream.empty;
            }

            yield* logStartedBackfill({ chain: params.chain, from, to });

            return getLocalEvents({
              chain: params.chain,
              rpc,
              eventCallbacks,
              childAddresses: params.childAddresses,
              syncProgress: params.syncProgress,
              cachedIntervals: params.cachedIntervals,
              from,
              to,
              limit,
              isCatchup: cursor !== undefined,
            }).pipe(
              Stream.mapEffect(({ events, checkpoint, blockRange }) =>
                Effect.map(
                  decodeChainEvents({
                    chain: params.chain,
                    eventCallbacks,
                    rawEvents: events,
                    crashRecoveryCheckpoint,
                  }),
                  (events): ChainEvents => ({
                    chainId: params.chain.id,
                    events,
                    checkpoint,
                    blockRange,
                  }),
                ),
              ),
              Stream.concat(
                Stream.unwrap(
                  Effect.gen(function* () {
                    if (yield* isBackfillCaughtUp) return Stream.empty;

                    const [finalizedBlock] = yield* refetchFinalizedBlocks({
                      indexingBuild: {
                        chains: [params.chain],
                        rpcs: [rpc],
                      },
                      perChainSync: new Map([
                        [params.chain, { syncProgress: params.syncProgress }],
                      ]),
                      retryNullBlockRequest: false,
                    });

                    if (
                      hexToNumber(finalizedBlock!.number) <
                      hexToNumber(params.syncProgress.finalized.number)
                    ) {
                      return Stream.empty;
                    }

                    params.syncProgress.finalized = finalizedBlock!;
                    return rounds(to);
                  }),
                ),
              ),
            );
          }),
        );

      return rounds(undefined);
    }),
  );

/**
 * Returns the checkpoint to start the backfill of `chain` from.
 *
 * Note: In order to speed up the "extract" phase when there is a crash recovery,
 * the beginning cursor is moved forwards. This only works when `crashRecoveryCheckpoint`
 * is defined.
 */
const getBackfillFrom = ({
  chain,
  syncProgress,
  crashRecoveryCheckpoint,
  syncStore,
}: {
  chain: Chain;
  syncProgress: SyncProgress;
  crashRecoveryCheckpoint: string | undefined;
  syncStore: SyncStore;
}): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    if (crashRecoveryCheckpoint === undefined) {
      return syncProgress.getCheckpoint({ tag: "start" });
    }

    if (
      Number(decodeCheckpoint(crashRecoveryCheckpoint).chainId) === chain.id
    ) {
      return crashRecoveryCheckpoint;
    }

    // Note: When the rpc cache is disabled, blocks in the sync-store can be stale.
    if (chain.cacheRpcRequests === false) {
      return syncProgress.getCheckpoint({ tag: "start" });
    }

    const fromBlock = yield* syncStore.getSafeCrashRecoveryBlock({
      chainId: chain.id,
      timestamp: Number(
        decodeCheckpoint(crashRecoveryCheckpoint).blockTimestamp,
      ),
    });

    if (fromBlock === undefined) {
      return syncProgress.getCheckpoint({ tag: "start" });
    }

    return encodeCheckpoint({
      ...ZERO_CHECKPOINT,
      blockNumber: fromBlock.number,
      blockTimestamp: fromBlock.timestamp,
      chainId: BigInt(chain.id),
    });
  });

/** Returns the checkpoint of the first block after `cursor`. */
const getNextCheckpoint = (cursor: string) =>
  encodeCheckpoint({
    ...ZERO_CHECKPOINT,
    blockTimestamp: decodeCheckpoint(cursor).blockTimestamp,
    chainId: decodeCheckpoint(cursor).chainId,
    blockNumber: decodeCheckpoint(cursor).blockNumber + 1n,
  });

/** Returns the maximum number of rows of each query for the events of a chain. */
const getEventsQueryLimit = (indexingBuild: Pick<IndexingBuild, "chains">) =>
  Effect.map(
    Options,
    (options) =>
      Math.round(
        options.syncEventsQuerySize / (indexingBuild.chains.length + 1),
      ) + 6,
  );

const logStartedBackfill = ({
  chain,
  from,
  to,
}: {
  chain: Chain;
  from: string;
  to: string;
}) =>
  Effect.logInfo({
    msg: "Started backfill indexing",
    chain: chain.name,
    chain_id: chain.id,
    block_range: JSON.stringify([
      Number(decodeCheckpoint(from).blockNumber),
      Number(decodeCheckpoint(to).blockNumber),
    ]),
  });

/**
 * Returns an Effect that is `true` if the last backfill took less than the
 * reorg window of every chain, or 30 seconds. Otherwise, it starts the next
 * backfill.
 */
const makeIsBackfillCaughtUp = (chains: Chain[]) =>
  Effect.map(Clock.currentTimeMillis, (start) => {
    let lastUnfinalizedRefetch = start;

    return Effect.map(Clock.currentTimeMillis, (now) => {
      if (
        chains.every(
          (chain) =>
            now - lastUnfinalizedRefetch <
            Math.max(chain.reorgWindow * 1_000, 30_000),
        )
      ) {
        return true;
      }

      lastUnfinalizedRefetch = now;
      return false;
    });
  });

/** Fetch the finalized block of each chain for the backfill cutover. */
const refetchFinalizedBlocks = ({
  indexingBuild,
  perChainSync,
  retryNullBlockRequest = true,
}: {
  indexingBuild: Pick<IndexingBuild, "chains" | "rpcs">;
  perChainSync: Map<Chain, { syncProgress: SyncProgress }>;
  retryNullBlockRequest?: boolean;
}): Effect.Effect<LightBlock[], Error> =>
  Effect.gen(function* () {
    const context = {
      logAnnotations: { action: "refetch_finalized_block" },
      retryNullBlockRequest,
    };

    const endClock = yield* startClockEffect;

    return yield* Effect.forEach(
      indexingBuild.chains,
      (chain, i) =>
        Effect.gen(function* () {
          const rpc = indexingBuild.rpcs[i]!;

          const latestBlock = yield* eth_getBlockByNumber(
            rpc,
            ["latest", false],
            context,
          );
          const finalizedBlock = yield* getFinalizedBlock({
            chain,
            rpc,
            latestBlock,
            lowerBound: perChainSync.get(chain)!.syncProgress.finalized,
          });

          yield* Effect.logDebug({
            msg: "Refetched finalized block for backfill cutover",
            chain: chain.name,
            chain_id: chain.id,
            finalized_block: hexToNumber(finalizedBlock.number),
            duration: yield* endClock,
          });

          return finalizedBlock;
        }),
      { concurrency: "unbounded" },
    );
  });

/**
 * Decode `rawEvents`, and remove the events that have a checkpoint earlier than
 * (or equal to) the crash recovery checkpoint.
 */
const decodeChainEvents = ({
  chain,
  eventCallbacks,
  rawEvents,
  crashRecoveryCheckpoint,
}: {
  chain: Chain;
  eventCallbacks: EventCallback[];
  rawEvents: RawEvent[];
  crashRecoveryCheckpoint: string | undefined;
}): Effect.Effect<Event[], never, Metrics> =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;
    const endClock = yield* startClockEffect;

    const events = yield* decodeEvents(chain, eventCallbacks, rawEvents);

    yield* Effect.logTrace({
      msg: "Decoded events",
      chain: chain.name,
      chain_id: chain.id,
      event_count: events.length,
      duration: yield* endClock,
    });

    metrics.ponder_historical_extract_duration.inc(
      { step: "decode" },
      yield* endClock,
    );

    if (crashRecoveryCheckpoint === undefined) return events;

    const [left, right] = partition(
      events,
      (event) => event.checkpoint <= crashRecoveryCheckpoint,
    );

    if (left.length > 0) {
      yield* Effect.logTrace({
        msg: "Filtered events before crash recovery checkpoint",
        chain: chain.name,
        chain_id: chain.id,
        event_count: left.length,
        checkpoint: crashRecoveryCheckpoint,
      });
    }

    return right;
  });

/**
 * Build the events of `params.events` again, from the database, after the
 * indexing functions accessed event properties that the events don't include.
 */
export const refetchHistoricalEvents = (params: {
  indexingBuild: Pick<IndexingBuild, "eventCallbacks" | "chains">;
  perChainSync: Map<Chain, { childAddresses: ChildAddresses }>;
  events: Event[];
  syncStore: SyncStore;
}): Effect.Effect<Event[], Error, Metrics> =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;
    const events = params.events.slice();

    for (const chain of params.indexingBuild.chains) {
      // Note: The events of a chain without the rpc cache aren't in the
      // sync-store, and they already have every column.
      if (chain.cacheRpcRequests === false) continue;

      const { childAddresses } = params.perChainSync.get(chain)!;

      // Note: All filters are refetched, no matter if they are resolved or not.
      const eventCallbacks =
        params.indexingBuild.eventCallbacks[
          params.indexingBuild.chains.findIndex((c) => c.id === chain.id)
        ]!;

      const chainEvents = params.events.filter(
        (event) => event.chain.id === chain.id,
      );

      if (chainEvents.length === 0) continue;

      const rawEvents = yield* refetchLocalEvents({
        chain,
        childAddresses,
        eventCallbacks,
        events: chainEvents,
        syncStore: params.syncStore,
      });

      const endClock = yield* startClockEffect;

      const refetchedEvents = yield* decodeEvents(
        chain,
        eventCallbacks,
        rawEvents,
      );

      yield* Effect.logTrace({
        msg: "Decoded events",
        chain: chain.name,
        chain_id: chain.id,
        event_count: events.length,
        duration: yield* endClock,
      });

      metrics.ponder_historical_extract_duration.inc(
        { step: "decode" },
        yield* endClock,
      );

      let i = 0;
      let j = 0;

      while (i < params.events.length && j < refetchedEvents.length) {
        if (params.events[i]?.chain.id === chain.id) {
          events[i] = refetchedEvents[j]!;
          i++;
          j++;
        } else {
          i++;
        }
      }
    }

    return events;
  });

/** Build the raw events between the first and last of `params.events` again. */
export const refetchLocalEvents = (params: {
  chain: Chain;
  childAddresses: ChildAddresses;
  eventCallbacks: EventCallback[];
  events: Event[];
  syncStore: SyncStore;
}): Effect.Effect<RawEvent[], Error, Metrics> =>
  Effect.gen(function* () {
    const from = params.events[0]!.checkpoint;
    const to = params.events[params.events.length - 1]!.checkpoint;

    const fromBlock = Number(decodeCheckpoint(from).blockNumber);
    const toBlock = Number(decodeCheckpoint(to).blockNumber);
    let cursor = fromBlock;

    const events: RawEvent[] = [];
    while (cursor <= toBlock) {
      const { rawEvents, queryCursor } = yield* queryLocalEvents({
        chain: params.chain,
        eventCallbacks: params.eventCallbacks,
        childAddresses: params.childAddresses,
        syncStore: params.syncStore,
        fromBlock: cursor,
        toBlock,
        limit: params.events.length,
      });

      events.push(...rawEvents);
      cursor = queryCursor + 1;
    }

    return events;
  });

/**
 * Query the block data from `fromBlock` to `toBlock`, up to `limit` rows, and
 * build the raw events.
 */
const queryLocalEvents = (params: {
  chain: Chain;
  eventCallbacks: EventCallback[];
  childAddresses: ChildAddresses;
  syncStore: SyncStore;
  fromBlock: number;
  toBlock: number;
  limit: number;
}) =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;
    const queryEndClock = yield* startClockEffect;

    const {
      blocks,
      logs,
      transactions,
      transactionReceipts,
      traces,
      cursor: queryCursor,
    } = yield* params.syncStore.getEventData({
      filters: params.eventCallbacks.map(({ filter }) => filter),
      fromBlock: params.fromBlock,
      toBlock: params.toBlock,
      chainId: params.chain.id,
      limit: params.limit,
    });

    const endClock = yield* startClockEffect;
    const rawEvents = buildEvents({
      eventCallbacks: params.eventCallbacks,
      blocks,
      logs,
      transactions,
      transactionReceipts,
      traces,
      childAddresses: params.childAddresses,
      chainId: params.chain.id,
    });

    yield* Effect.logTrace({
      msg: "Constructed events from block data",
      chain: params.chain.name,
      chain_id: params.chain.id,
      block_range: JSON.stringify([params.fromBlock, queryCursor]),
      event_count: rawEvents.length,
      duration: yield* endClock,
    });

    metrics.ponder_historical_extract_duration.inc(
      { step: "build" },
      yield* endClock,
    );

    yield* Effect.logDebug({
      msg: "Queried backfill JSON-RPC data from database",
      chain: params.chain.name,
      chain_id: params.chain.id,
      block_range: JSON.stringify([params.fromBlock, queryCursor]),
      event_count: rawEvents.length,
      duration: yield* queryEndClock,
    });

    yield* Effect.yieldNow;

    return { rawEvents, blocks, queryCursor };
  });

type LocalEventsParameters = {
  chain: Chain;
  rpc: Rpc;
  eventCallbacks: EventCallback[];
  childAddresses: ChildAddresses;
  syncProgress: SyncProgress;
  cachedIntervals: CachedIntervals;
  from: string;
  to: string;
  limit: number;
  isCatchup: boolean;
};

/**
 * Stream the raw events of a chain from `from` to `to`, from the rpc cache or,
 * when the rpc cache is disabled, from the RPC.
 */
const getLocalEvents = (
  params: LocalEventsParameters,
): Stream.Stream<RawChainEvents, Error, Db | Options | Metrics> =>
  params.chain.cacheRpcRequests
    ? getLocalEventStream(params)
    : getLocalInMemoryEventStream(params);

/**
 * Stream the raw events of a chain from `from` to `to`. The events are queried
 * from the database as the backfill stores the block data.
 */
export const getLocalEventStream = (
  params: LocalEventsParameters,
): Stream.Stream<RawChainEvents, Error, Db | Options | Metrics> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const db = yield* Db;
      const options = yield* Options;
      const syncStore = yield* createSyncStore(db.sync);

      const toBlock = Number(decodeCheckpoint(params.to).blockNumber);
      let cursor = Number(decodeCheckpoint(params.from).blockNumber);

      /** Query the events from `cursor` up to `syncCursor`, in pages. */
      const queryEvents = (syncCursor: number) =>
        Stream.paginate<void, RawChainEvents, Error, Metrics>(undefined, () =>
          Effect.gen(function* () {
            if (cursor > Math.min(syncCursor, toBlock)) {
              return [[], Option.none()] as const;
            }

            const { rawEvents, blocks, queryCursor } = yield* queryLocalEvents({
              chain: params.chain,
              eventCallbacks: params.eventCallbacks,
              childAddresses: params.childAddresses,
              syncStore,
              fromBlock: cursor,
              toBlock: Math.min(syncCursor, toBlock),
              limit: params.limit,
            });

            const blockRange = [cursor, queryCursor] satisfies [number, number];

            cursor = queryCursor + 1;
            if (cursor > toBlock) {
              return [
                [{ events: rawEvents, checkpoint: params.to, blockRange }],
                Option.some(undefined),
              ] as const;
            }
            if (blocks.length > 0) {
              const checkpoint = encodeCheckpoint({
                ...MAX_CHECKPOINT,
                blockTimestamp: blocks[blocks.length - 1]!.timestamp,
                chainId: BigInt(params.chain.id),
                blockNumber: blocks[blocks.length - 1]!.number,
              });
              return [
                [{ events: rawEvents, checkpoint, blockRange }],
                Option.some(undefined),
              ] as const;
            }
            return [[], Option.some(undefined)] as const;
          }),
        );

      // Note: The backfill runs ahead of the queries, which read the events up to
      // the latest block that the backfill stored. While the backfill is slower,
      // the queries run at most once per 10 seconds (2 seconds in `ponder dev`),
      // like the intervals of the adaptive range before, so a batch spans many
      // stored blocks.
      return latestWithin(
        getLocalSyncStream(params),
        options.command === "dev" ? 2_000 : 10_000,
      ).pipe(Stream.flatMap(queryEvents));
    }),
  );

/**
 * Stream the raw events of a chain from `from` to `to`, from block data that
 * the backfill fetches from the RPC and keeps in memory.
 */
export const getLocalInMemoryEventStream = (
  params: LocalEventsParameters,
): Stream.Stream<RawChainEvents, Error, Options | Metrics> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const metrics = yield* Metrics;
      const backfillEndClock = yield* startClockEffect;
      const label = { chain: params.chain.name };

      let first = hexToNumber(params.syncProgress.start.number);
      const last = getBackfillLast(params.syncProgress);

      if (
        hexToNumber(params.syncProgress.start.number) >
        hexToNumber(params.syncProgress.finalized.number)
      ) {
        yield* skipBackfill(params);
        return Stream.empty;
      }

      const totalInterval = [
        hexToNumber(params.syncProgress.start.number),
        hexToNumber(last.number),
      ] satisfies Interval;

      const total = totalInterval[1] - totalInterval[0] + 1;

      metrics.ponder_historical_total_blocks.set(label, total);
      metrics.ponder_historical_cached_blocks.set(label, 0);

      if (params.syncProgress.current !== undefined) {
        metrics.ponder_sync_block.set(
          label,
          hexToNumber(params.syncProgress.current.number),
        );
        metrics.ponder_sync_block_timestamp.set(
          label,
          hexToNumber(params.syncProgress.current.timestamp),
        );

        first = Math.max(
          first,
          hexToNumber(params.syncProgress.current.number) + 1,
        );
      }

      if (params.isCatchup === false) {
        yield* Effect.logInfo({
          msg: "Started fetching backfill JSON-RPC data",
          chain: params.chain.name,
          chain_id: params.chain.id,
        });
      }

      const fromBlock = Number(decodeCheckpoint(params.from).blockNumber);

      const { intervals: requiredIntervals } = getRequiredIntervalsWithFilters({
        interval: [fromBlock, hexToNumber(last.number)],
        filters: params.eventCallbacks.map(({ filter }) => filter),
        cachedIntervals: params.cachedIntervals,
      });

      const { factoryIntervals: requiredFactoryIntervals } =
        getRequiredIntervalsWithFilters({
          interval: [first, hexToNumber(last.number)],
          filters: params.eventCallbacks.map(({ filter }) => filter),
          cachedIntervals: params.cachedIntervals,
        });

      const historicalSync = yield* createInMemoryHistoricalSync({
        chain: params.chain,
        rpc: params.rpc,
        childAddress: params.childAddresses,
      });

      metrics.ponder_historical_completed_blocks.inc(
        label,
        Math.max(0, Math.min(fromBlock, hexToNumber(last.number) + 1) - first),
      );
      let cursor = fromBlock;

      return historicalSync
        .syncBlockData({ requiredIntervals, requiredFactoryIntervals })
        .pipe(
          Stream.mapEffect((blockData) =>
            Effect.gen(function* () {
              const endClock = yield* startClockEffect;
              const rawEvents = buildEvents({
                eventCallbacks: params.eventCallbacks,
                blocks: blockData.blocks,
                logs: blockData.logs,
                transactions: blockData.transactions,
                transactionReceipts: blockData.transactionReceipts,
                traces: blockData.traces,
                childAddresses: params.childAddresses,
                chainId: params.chain.id,
              });

              yield* Effect.logTrace({
                msg: "Constructed events from block data",
                chain: params.chain.name,
                chain_id: params.chain.id,
                block_range: JSON.stringify([cursor, blockData.cursor]),
                event_count: rawEvents.length,
                duration: yield* endClock,
              });

              metrics.ponder_historical_extract_duration.inc(
                { step: "build" },
                yield* endClock,
              );
              metrics.ponder_historical_completed_blocks.inc(
                label,
                blockData.cursor - cursor + 1,
              );

              const blockRange = [cursor, blockData.cursor] satisfies [
                number,
                number,
              ];
              cursor = blockData.cursor + 1;

              const lastBlock = blockData.blocks[blockData.blocks.length - 1]!;
              metrics.ponder_sync_block.set(label, Number(lastBlock.number));
              metrics.ponder_sync_block_timestamp.set(
                label,
                Number(lastBlock.timestamp),
              );
              const checkpoint = encodeCheckpoint({
                ...MAX_CHECKPOINT,
                blockTimestamp: lastBlock.timestamp,
                chainId: BigInt(params.chain.id),
                blockNumber: lastBlock.number,
              });

              return { events: rawEvents, checkpoint, blockRange };
            }),
          ),
          Stream.concat(
            Stream.suspend(() => {
              // Advance through the entire scanned range, including blocks without events.
              params.syncProgress.current = last;
              metrics.ponder_historical_completed_blocks.inc(
                label,
                Math.max(0, hexToNumber(last.number) - cursor + 1),
              );
              metrics.ponder_sync_block.set(label, hexToNumber(last.number));
              metrics.ponder_sync_block_timestamp.set(
                label,
                hexToNumber(last.timestamp),
              );

              const remaining: Stream.Stream<RawChainEvents> =
                cursor <= hexToNumber(last.number)
                  ? Stream.succeed<RawChainEvents>({
                      events: [],
                      checkpoint: params.to,
                      blockRange: [cursor, hexToNumber(last.number)],
                    })
                  : Stream.empty;

              return remaining.pipe(
                Stream.concat(
                  Stream.fromEffectDrain(
                    Effect.gen(function* () {
                      yield* Effect.logInfo({
                        msg: "Finished fetching backfill JSON-RPC data",
                        chain: params.chain.name,
                        chain_id: params.chain.id,
                        duration: yield* backfillEndClock,
                      });
                    }),
                  ),
                ),
              );
            }),
          ),
        );
    }),
  );

/**
 * Fetch the block data of a chain that the rpc cache is missing, and store it.
 * Emits the latest block of the backfill that the database contains all required
 * data up to, in order.
 */
export const getLocalSyncStream = (params: {
  chain: Chain;
  rpc: Rpc;
  eventCallbacks: EventCallback[];
  syncProgress: SyncProgress;
  childAddresses: ChildAddresses;
  cachedIntervals: CachedIntervals;
  isCatchup: boolean;
}): Stream.Stream<number, Error, Db | Options | Metrics> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const metrics = yield* Metrics;
      const backfillEndClock = yield* startClockEffect;
      const label = { chain: params.chain.name };

      let first = hexToNumber(params.syncProgress.start.number);
      const last = getBackfillLast(params.syncProgress);

      if (
        hexToNumber(params.syncProgress.start.number) >
        hexToNumber(params.syncProgress.finalized.number)
      ) {
        yield* skipBackfill(params);
        return Stream.empty;
      }

      const totalInterval = [
        hexToNumber(params.syncProgress.start.number),
        hexToNumber(last.number),
      ] satisfies Interval;

      const required = intervalSum(
        getRequiredIntervals({
          filters: params.eventCallbacks.map(({ filter }) => filter),
          interval: totalInterval,
          cachedIntervals: params.cachedIntervals,
        }),
      );
      const total = totalInterval[1] - totalInterval[0] + 1;

      metrics.ponder_historical_total_blocks.set(label, total);
      metrics.ponder_historical_cached_blocks.set(label, total - required);

      /** The cached block, which the events can be queried up to right away. */
      let cachedBlock: Stream.Stream<number> = Stream.empty;

      if (params.syncProgress.current === undefined) {
        if (params.isCatchup === false) {
          yield* Effect.logInfo({
            msg: "Started fetching backfill JSON-RPC data",
            chain: params.chain.name,
            chain_id: params.chain.id,
            cache_rate: "0%",
          });
        }
      } else {
        const current = hexToNumber(params.syncProgress.current.number);

        metrics.ponder_sync_block.set(label, current);
        metrics.ponder_sync_block_timestamp.set(
          label,
          hexToNumber(params.syncProgress.current.timestamp),
        );

        cachedBlock = Stream.make(current);

        if (current === hexToNumber(last.number)) {
          if (params.isCatchup === false) {
            yield* Effect.logInfo({
              msg: "Skipped fetching backfill JSON-RPC data (cache contains all required data)",
              chain: params.chain.name,
              chain_id: params.chain.id,
              cached_block: current,
              cache_rate: "100%",
            });
          }
          return cachedBlock;
        }

        if (params.isCatchup === false) {
          yield* Effect.logInfo({
            msg: "Started fetching backfill JSON-RPC data",
            chain: params.chain.name,
            chain_id: params.chain.id,
            cached_block: current,
            cache_rate: formatPercentage((total - required) / total),
          });
        }

        first = Math.max(first, current + 1);
      }

      // Note: Each piece is synced on its own, so that the cached blocks between
      // the pieces aren't fetched again.
      const pieces = getRequiredIntervalsPerPiece({
        interval: [first, hexToNumber(last.number)],
        filters: params.eventCallbacks.map(({ filter }) => filter),
        cachedIntervals: params.cachedIntervals,
      });

      /** Last block that is counted in `ponder_historical_completed_blocks`. */
      let completedBlock = first - 1;
      const complete = (blockNumber: number, timestamp?: number) => {
        metrics.ponder_historical_completed_blocks.inc(
          label,
          blockNumber - completedBlock,
        );
        metrics.ponder_sync_block.set(label, blockNumber);
        if (timestamp !== undefined) {
          metrics.ponder_sync_block_timestamp.set(label, timestamp);
        }
        completedBlock = blockNumber;
      };

      const historicalSync = yield* createHistoricalSync({
        chain: params.chain,
        rpc: params.rpc,
        childAddresses: params.childAddresses,
      });

      // Note: The stored block ranges end at the last required block of each piece.
      // The other blocks are cached.
      const syncedBlocks = Stream.fromIterable(pieces).pipe(
        Stream.flatMap(({ intervals, factoryIntervals }) =>
          historicalSync.sync({
            requiredIntervals: intervals,
            requiredFactoryIntervals: factoryIntervals,
          }),
        ),
        Stream.map(({ interval, timestamp }) => {
          complete(interval[1], timestamp);
          return interval[1];
        }),
        Stream.tapError((error) =>
          Effect.logWarning({
            msg: "Failed to fetch backfill JSON-RPC data",
            chain: params.chain.name,
            chain_id: params.chain.id,
            block_range: JSON.stringify([
              completedBlock + 1,
              hexToNumber(last.number),
            ]),
            error,
          }),
        ),
      );

      return cachedBlock.pipe(
        Stream.concat(syncedBlocks),
        Stream.concat(
          Stream.unwrap(
            Effect.gen(function* () {
              params.syncProgress.current = last;
              complete(hexToNumber(last.number));
              metrics.ponder_sync_block_timestamp.set(
                label,
                hexToNumber(last.timestamp),
              );

              yield* Effect.logInfo({
                msg: "Finished fetching backfill JSON-RPC data",
                chain: params.chain.name,
                chain_id: params.chain.id,
                duration: yield* backfillEndClock,
              });

              return Stream.make(hexToNumber(last.number));
            }),
          ),
        ),
      );
    }),
  );

/** Returns the last block of the backfill of a chain. */
const getBackfillLast = (syncProgress: SyncProgress) =>
  syncProgress.end === undefined
    ? syncProgress.finalized
    : hexToNumber(syncProgress.end.number) >
        hexToNumber(syncProgress.finalized.number)
      ? syncProgress.finalized
      : syncProgress.end;

/** Skip the backfill of a chain that only requires live indexing. */
const skipBackfill = (params: { chain: Chain; syncProgress: SyncProgress }) =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;
    const label = { chain: params.chain.name };

    params.syncProgress.current = params.syncProgress.finalized;

    yield* Effect.logInfo({
      msg: "Skipped fetching backfill JSON-RPC data (chain only requires live indexing)",
      chain: params.chain.name,
      chain_id: params.chain.id,
      finalized_block: hexToNumber(params.syncProgress.finalized.number),
      start_block: hexToNumber(params.syncProgress.start.number),
    });

    metrics.ponder_sync_block.set(
      label,
      hexToNumber(params.syncProgress.current.number),
    );
    metrics.ponder_sync_block_timestamp.set(
      label,
      hexToNumber(params.syncProgress.current.timestamp),
    );
    metrics.ponder_historical_total_blocks.set(label, 0);
    metrics.ponder_historical_cached_blocks.set(label, 0);
    metrics.ponder_historical_completed_blocks.set(label, 0);
  });

/**
 * Merge the events of each chain into batches in omnichain order. Each batch
 * contains the events of each chain up to the earliest checkpoint across
 * chains.
 */
export const mergeHistoricalEventsOmnichain = <E, R>(
  streams: Stream.Stream<ChainEvents, E, R>[],
): Stream.Stream<ChainEvents[], E, R> =>
  mergePulls(streams, (heads) => {
    const supremum = min(...heads.map((head) => head?.checkpoint));

    const mergedResults: ChainEvents[] = [];

    for (const head of heads) {
      if (head === undefined) continue;

      const [left, right] = partition(
        head.events,
        (event) => event.checkpoint <= supremum,
      );

      const event = left[left.length - 1];

      if (event) {
        mergedResults.push({
          events: left,
          chainId: event.chain.id,
          checkpoint: right.length > 0 ? event.checkpoint : head.checkpoint,
          blockRange: [
            head.blockRange[0],
            right.length > 0
              ? Number(decodeCheckpoint(event.checkpoint).blockNumber)
              : head.blockRange[1],
          ],
        });
      }

      head.events = right;
    }

    const index = heads.findIndex(
      (head) => head !== undefined && head.checkpoint === supremum,
    );

    return {
      index,
      values: mergedResults.length > 0 ? [mergedResults] : [],
    };
  });
