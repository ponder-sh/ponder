import {
  Clock,
  Deferred,
  Effect,
  Exit,
  FiberHandle,
  Option,
  Pull,
  Queue,
  Result,
  Stream,
} from "effect";
import { type Address, hexToNumber } from "viem";
import { Db } from "@/database/db.js";
import { Metrics } from "@/internal/metrics.js";
import type { Options } from "@/internal/options.js";
import type {
  Chain,
  Event,
  EventCallback,
  Factory,
  FactoryFragmentId,
  Filter,
  IndexingBuild,
  SyncBlock,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import {
  buildEvents,
  decodeEvents,
  syncBlockToInternal,
  syncLogToInternal,
  syncTraceToInternal,
  syncTransactionReceiptToInternal,
  syncTransactionToInternal,
} from "@/runtime/events.js";
import {
  createRealtimeSync,
  type Head,
  type RealtimeSyncEvent,
} from "@/sync-realtime/index.js";
import { createSyncStore } from "@/sync-store/index.js";
import {
  blockToCheckpoint,
  decodeCheckpoint,
  encodeCheckpoint,
  min,
  ZERO_CHECKPOINT_STRING,
} from "@/utils/checkpoint.js";
import { type Interval, intervalIntersection } from "@/utils/interval.js";
import { bufferWithSize, mergeUnordered } from "@/utils/stream.js";
import { startClockEffect } from "@/utils/timer.js";
import { getFilterFactories } from "./filter.js";
import type { ChildAddresses, SyncProgress } from "./index.js";
import { getOmnichainCheckpoint } from "./omnichain.js";

export type RealtimeEvent =
  | {
      type: "block";
      events: Event[];
      chain: Chain;
      checkpoint: string;
      /** Completed with `true` once the block is indexed. */
      isAccepted?: Deferred.Deferred<boolean>;
    }
  | {
      type: "reorg";
      chain: Chain;
      checkpoint: string;
      /**
       * With multichain ordering, the checkpoint of the first executed event
       * of each chain that is indexed again.
       */
      executedCheckpoints?: string[];
    }
  | {
      type: "finalize";
      chain: Chain;
      checkpoint: string;
      /**
       * With multichain ordering, the checkpoint of the first executed event
       * of each chain that can be indexed again after a reorg.
       */
      executedCheckpoints?: string[];
    };

/** A block of the local chain that is not finalized. */
export type UnfinalizedBlock = Omit<
  Extract<RealtimeSyncEvent, { type: "block" }>,
  "type"
>;

type PerChainSync = Map<
  Chain,
  {
    syncProgress: SyncProgress;
    childAddresses: ChildAddresses;
    unfinalizedBlocks: UnfinalizedBlock[];
  }
>;

type ChainSyncEvent = { chain: Chain; event: RealtimeSyncEvent };

/**
 * Stream the live events of all chains in omnichain order.
 *
 * @param params.pendingEvents - Events that the backfill synced, but that must
 * be indexed in the live phase.
 */
export const getRealtimeEventsOmnichain = (params: {
  indexingBuild: Pick<IndexingBuild, "eventCallbacks" | "chains" | "rpcs">;
  perChainSync: PerChainSync;
  pendingEvents: Event[];
}): Stream.Stream<RealtimeEvent, Error, Db | Options | Metrics> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const chainEvents = yield* getChainSyncEvents(params);

      /** Events that have been executed but not finalized. */
      let executedEvents: Event[] = [];
      /** Events that have not been executed. */
      let pendingEvents: Event[] = params.pendingEvents;
      // Note: Executed events are only indexed again after a reorg of
      // another chain, because the events of the reorged chain are dropped.
      // With one live chain, only the events of other chains are kept.
      const liveChainIds = new Set(
        Array.from(params.perChainSync)
          .filter(([, { syncProgress }]) => syncProgress.isEnd() === false)
          .map(([chain]) => chain.id),
      );
      const isExecutedEventKept = (event: Event) =>
        liveChainIds.size > 1 || liveChainIds.has(event.chain.id) === false;
      /** Closest-to-tip finalized checkpoint across all chains. */
      let finalizedCheckpoint = ZERO_CHECKPOINT_STRING;

      return mergeRealtimeEventsOmnichain(chainEvents, (chain) =>
        params.perChainSync.get(chain)!.syncProgress.isEnd(),
      ).pipe(
        Stream.mapEffect(
          ({
            chain,
            event,
          }): Effect.Effect<RealtimeEvent[], Error, Db | Options | Metrics> =>
            Effect.gen(function* () {
              const { syncProgress, childAddresses, unfinalizedBlocks } =
                params.perChainSync.get(chain)!;
              const eventCallbacks = getEventCallbacks(
                params.indexingBuild,
                chain,
              );

              yield* handleRealtimeSyncEvent(event, {
                chain,
                eventCallbacks,
                syncProgress,
                unfinalizedBlocks,
              });

              switch (event.type) {
                case "block": {
                  const decodedEvents = yield* buildBlockEvents({
                    chain,
                    eventCallbacks,
                    childAddresses,
                    event,
                  });

                  const checkpoint = encodeCheckpoint(
                    blockToCheckpoint(event.block, chain.id, "up"),
                  );

                  const readyEvents = pendingEvents
                    .concat(decodedEvents)
                    .filter((e) => e.checkpoint < checkpoint)
                    .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
                  pendingEvents = pendingEvents
                    .concat(decodedEvents)
                    .filter((e) => e.checkpoint > checkpoint);
                  for (const event of readyEvents) {
                    if (isExecutedEventKept(event)) executedEvents.push(event);
                  }

                  const blockEvent: RealtimeEvent = {
                    type: "block",
                    events: readyEvents,
                    chain,
                    checkpoint,
                    isAccepted: event.isAccepted,
                  };

                  // Note: Once every chain indexed its end block, no block releases the
                  // pending events after the last block, such as the backfill events of a
                  // chain that only requires backfill. A reorg makes them pending again.
                  if (
                    pendingEvents.length > 0 &&
                    Array.from(params.perChainSync.values()).every(
                      ({ syncProgress }) => syncProgress.isEnd(),
                    )
                  ) {
                    const checkpoint = getOmnichainCheckpoint({
                      perChainSync: params.perChainSync,
                      tag: "current",
                    });
                    const events = pendingEvents.sort((a, b) =>
                      a.checkpoint < b.checkpoint ? -1 : 1,
                    );
                    pendingEvents = [];
                    executedEvents = executedEvents.concat(events);

                    return [
                      blockEvent,
                      {
                        type: "block",
                        events,
                        chain: params.indexingBuild.chains.find(
                          (chain) =>
                            chain.id ===
                            Number(decodeCheckpoint(checkpoint).chainId),
                        )!,
                        checkpoint,
                      },
                    ];
                  }

                  return [blockEvent];
                }
                case "finalize": {
                  const from = finalizedCheckpoint;
                  finalizedCheckpoint = getOmnichainCheckpoint({
                    perChainSync: params.perChainSync,
                    tag: "finalized",
                  });
                  const to = getOmnichainCheckpoint({
                    perChainSync: params.perChainSync,
                    tag: "finalized",
                  });

                  if (to <= from) return [];

                  // index of the first unfinalized event
                  let finalizeIndex: number | undefined;
                  for (const [index, event] of executedEvents.entries()) {
                    if (event.checkpoint > to) {
                      finalizeIndex = index;
                      break;
                    }
                  }

                  let finalizedEvents: Event[];

                  if (finalizeIndex === undefined) {
                    finalizedEvents = executedEvents;
                    executedEvents = [];
                  } else {
                    finalizedEvents = executedEvents.slice(0, finalizeIndex);
                    executedEvents = executedEvents.slice(finalizeIndex);
                  }

                  yield* Effect.logTrace({
                    msg: "Removed finalized events",
                    event_count: finalizedEvents.length,
                  });

                  return [{ type: "finalize", chain, checkpoint: to }];
                }
                case "reorg": {
                  const isReorgedEvent = (_event: Event) =>
                    _event.chain.id === chain.id &&
                    Number(_event.event.block.number) >
                      hexToNumber(event.block.number);

                  const checkpoint = getOmnichainCheckpoint({
                    perChainSync: params.perChainSync,
                    tag: "current",
                  });

                  // Move events from executed to pending

                  const reorgedEvents = executedEvents.filter(
                    (e) => e.checkpoint > checkpoint,
                  );
                  executedEvents = executedEvents.filter(
                    (e) => e.checkpoint < checkpoint,
                  );
                  pendingEvents = pendingEvents.concat(reorgedEvents);

                  yield* Effect.logTrace({
                    msg: "Removed and rescheduled reorged events",
                    event_count: reorgedEvents.length,
                  });

                  pendingEvents = pendingEvents.filter(
                    (e) => isReorgedEvent(e) === false,
                  );

                  return [{ type: "reorg", chain, checkpoint }];
                }
              }
            }),
        ),
        Stream.flattenIterable,
      );
    }),
  );

/**
 * Stream the live events of all chains, in order for each chain.
 */
export const getRealtimeEventsMultichain = (params: {
  indexingBuild: Pick<IndexingBuild, "eventCallbacks" | "chains" | "rpcs">;
  perChainSync: PerChainSync;
}): Stream.Stream<RealtimeEvent, Error, Db | Options | Metrics> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const chainEvents = yield* getChainSyncEvents(params);

      /** Events that have been executed but not finalized. */
      let executedEvents: Event[] = [];
      /** Events that have not been executed. */
      let pendingEvents: Event[] = [];
      // Note: See `getRealtimeEventsOmnichain`. All events are of live chains.
      const isExecutedEventKept = chainEvents.length > 1;

      return mergeUnordered(chainEvents, { bufferSize: 1 }).pipe(
        Stream.mapEffect(
          ({
            chain,
            event,
          }): Effect.Effect<RealtimeEvent, Error, Db | Options | Metrics> =>
            Effect.gen(function* () {
              const { syncProgress, childAddresses, unfinalizedBlocks } =
                params.perChainSync.get(chain)!;
              const eventCallbacks = getEventCallbacks(
                params.indexingBuild,
                chain,
              );

              yield* handleRealtimeSyncEvent(event, {
                chain,
                eventCallbacks,
                syncProgress,
                unfinalizedBlocks,
              });

              switch (event.type) {
                case "block": {
                  const decodedEvents = yield* buildBlockEvents({
                    chain,
                    eventCallbacks,
                    childAddresses,
                    event,
                  });

                  const checkpoint = syncProgress.getCheckpoint({
                    tag: "current",
                  });

                  if (pendingEvents.length > 0) {
                    yield* Effect.logTrace({
                      msg: "Included pending events",
                      chain: chain.name,
                      chain_id: chain.id,
                      event_count: pendingEvents.length,
                    });
                  }

                  const readyEvents = decodedEvents
                    .concat(pendingEvents)
                    .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
                  pendingEvents = [];
                  if (isExecutedEventKept) {
                    for (const event of readyEvents) executedEvents.push(event);
                  }

                  return {
                    type: "block",
                    events: readyEvents,
                    chain,
                    checkpoint,
                    isAccepted: event.isAccepted,
                  };
                }
                case "finalize": {
                  const checkpoint = syncProgress.getCheckpoint({
                    tag: "finalized",
                  });

                  // index of the first unfinalized event
                  let finalizeIndex: number | undefined;

                  for (const [index, event] of executedEvents.entries()) {
                    const _chain = params.indexingBuild.chains.find(
                      (c) => c.id === event.chain.id,
                    )!;
                    const _checkpoint = params.perChainSync
                      .get(_chain)!
                      .syncProgress.getCheckpoint({ tag: "finalized" });

                    if (event.checkpoint > _checkpoint) {
                      finalizeIndex = index;
                      break;
                    }
                  }

                  let finalizedEvents: Event[];

                  if (finalizeIndex === undefined) {
                    finalizedEvents = executedEvents;
                    executedEvents = [];
                  } else {
                    finalizedEvents = executedEvents.slice(0, finalizeIndex);
                    executedEvents = executedEvents.slice(finalizeIndex);
                  }

                  yield* Effect.logTrace({
                    msg: "Removed finalized events",
                    event_count: finalizedEvents.length,
                  });

                  return {
                    type: "finalize",
                    chain,
                    checkpoint,
                    executedCheckpoints: getFirstCheckpoints(executedEvents),
                  };
                }
                case "reorg": {
                  const isReorgedEvent = (_event: Event) =>
                    _event.chain.id === chain.id &&
                    Number(_event.event.block.number) >
                      hexToNumber(event.block.number);

                  const checkpoint = syncProgress.getCheckpoint({
                    tag: "current",
                  });

                  // index of the first reorged event
                  let reorgIndex: number | undefined;
                  for (const [index, event] of executedEvents.entries()) {
                    if (
                      event.chain.id === chain.id &&
                      event.checkpoint > checkpoint
                    ) {
                      reorgIndex = index;
                      break;
                    }
                  }

                  // Move events from executed to pending

                  let reorgedEvents: Event[] = [];
                  if (reorgIndex !== undefined) {
                    reorgedEvents = executedEvents.slice(reorgIndex);
                    executedEvents = executedEvents.slice(0, reorgIndex);
                    pendingEvents = pendingEvents.concat(reorgedEvents);

                    yield* Effect.logTrace({
                      msg: "Removed and rescheduled reorged events",
                      event_count: reorgedEvents.length,
                    });
                  }

                  pendingEvents = pendingEvents.filter(
                    (e) => isReorgedEvent(e) === false,
                  );

                  return {
                    type: "reorg",
                    chain,
                    checkpoint,
                    executedCheckpoints: getFirstCheckpoints(reorgedEvents),
                  };
                }
              }
            }),
        ),
      );
    }),
  );

/** The checkpoint of the first event of each chain in `events`. */
const getFirstCheckpoints = (events: Event[]) => {
  const checkpoints = new Map<number, string>();
  for (const event of events) {
    if (checkpoints.has(event.chain.id) === false) {
      checkpoints.set(event.chain.id, event.checkpoint);
    }
  }
  return Array.from(checkpoints.values());
};

/**
 * Stream the live events of one chain.
 */
export const getRealtimeEventsIsolated = (params: {
  indexingBuild: Pick<IndexingBuild, "eventCallbacks" | "chains" | "rpcs">;
  chain: Chain;
  syncProgress: SyncProgress;
  childAddresses: ChildAddresses;
  unfinalizedBlocks: UnfinalizedBlock[];
}): Stream.Stream<RealtimeEvent, Error, Db | Options | Metrics> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const [chainEvents] = yield* getChainSyncEvents({
        indexingBuild: params.indexingBuild,
        perChainSync: new Map([[params.chain, params]]),
      });

      if (chainEvents === undefined) return Stream.empty;

      const eventCallbacks = getEventCallbacks(
        params.indexingBuild,
        params.chain,
      );

      return chainEvents.pipe(
        Stream.mapEffect(
          ({
            chain,
            event,
          }): Effect.Effect<RealtimeEvent, Error, Db | Options | Metrics> =>
            Effect.gen(function* () {
              yield* handleRealtimeSyncEvent(event, {
                chain,
                eventCallbacks,
                syncProgress: params.syncProgress,
                unfinalizedBlocks: params.unfinalizedBlocks,
              });

              switch (event.type) {
                case "block": {
                  const events = yield* buildBlockEvents({
                    chain,
                    eventCallbacks,
                    childAddresses: params.childAddresses,
                    event,
                  });

                  const checkpoint = params.syncProgress.getCheckpoint({
                    tag: "current",
                  });

                  return {
                    type: "block",
                    events,
                    chain,
                    checkpoint,
                    isAccepted: event.isAccepted,
                  };
                }
                case "finalize": {
                  const checkpoint = params.syncProgress.getCheckpoint({
                    tag: "finalized",
                  });

                  return { type: "finalize", chain, checkpoint };
                }
                case "reorg": {
                  const checkpoint = params.syncProgress.getCheckpoint({
                    tag: "current",
                  });

                  return { type: "reorg", chain, checkpoint };
                }
              }
            }),
        ),
      );
    }),
  );

const getEventCallbacks = (
  indexingBuild: Pick<IndexingBuild, "eventCallbacks" | "chains">,
  chain: Chain,
) =>
  indexingBuild.eventCallbacks[
    indexingBuild.chains.findIndex((c) => c.id === chain.id)
  ]!;

/**
 * Returns the stream of realtime sync events of each chain that requires
 * live indexing. Each stream runs up to 100 events ahead of the consumer.
 */
const getChainSyncEvents = (params: {
  indexingBuild: Pick<IndexingBuild, "eventCallbacks" | "chains" | "rpcs">;
  perChainSync: Map<
    Chain,
    { syncProgress: SyncProgress; childAddresses: ChildAddresses }
  >;
}): Effect.Effect<
  Stream.Stream<ChainSyncEvent, Error, Metrics>[],
  never,
  Metrics
> =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;
    const streams: Stream.Stream<ChainSyncEvent, Error, Metrics>[] = [];

    for (const [
      chain,
      { syncProgress, childAddresses },
    ] of params.perChainSync) {
      if (syncProgress.isEnd()) {
        yield* Effect.logInfo({
          msg: "Skipped live indexing (chain only requires backfill indexing)",
          chain: chain.name,
          chain_id: chain.id,
          end_block: hexToNumber(syncProgress.end!.number),
        });

        metrics.ponder_sync_is_complete.set({ chain: chain.name }, 1);
        continue;
      }

      const rpc =
        params.indexingBuild.rpcs[params.indexingBuild.chains.indexOf(chain)]!;

      metrics.ponder_sync_is_realtime.set({ chain: chain.name }, 1);

      streams.push(
        bufferWithSize(
          getRealtimeChainEvents({
            chain,
            rpc,
            eventCallbacks: getEventCallbacks(params.indexingBuild, chain),
            syncProgress,
            childAddresses,
          }),
          {
            capacity: 100,
            onSize: (bufferSize) =>
              logBackpressure(bufferSize, {
                chain: chain.name,
                chain_id: chain.id,
                indexing_step: "order block events",
              }),
          },
        ),
      );
    }

    return streams;
  });

/**
 * Log the size of a buffer between two steps of live indexing.
 *
 * Note: Only log when the buffer size is greater than 1 because
 * a buffer size of 1 is not backpressure.
 */
export const logBackpressure = (
  bufferSize: number,
  {
    indexing_step,
    ...context
  }: { indexing_step: string; chain?: string; chain_id?: number },
) =>
  bufferSize === 1
    ? Effect.void
    : Effect.logTrace({
        msg: "Detected live indexing backpressure",
        ...context,
        buffer_size: bufferSize,
        indexing_step,
      });

/**
 * Stream the realtime sync events of one chain, from the new blocks of the
 * RPC. The stream ends once the end block of the chain is finalized.
 */
export const getRealtimeChainEvents = (params: {
  chain: Chain;
  rpc: Rpc;
  eventCallbacks: EventCallback[];
  syncProgress: SyncProgress;
  childAddresses: ChildAddresses;
}): Stream.Stream<ChainSyncEvent, Error, Metrics> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const metrics = yield* Metrics;
      const scope = yield* Effect.scope;
      const realtimeSync = yield* createRealtimeSync(params);

      let childCount = 0;
      for (const [, factoryChildAddresses] of params.childAddresses) {
        childCount += factoryChildAddresses.size;
      }

      yield* Effect.logInfo({
        msg: "Started live indexing",
        chain: params.chain.name,
        chain_id: params.chain.id,
        finalized_block: hexToNumber(params.syncProgress.finalized.number),
        factory_address_count: childCount,
      });

      /** Warns when no new block is received within 30 seconds. */
      const noNewBlockWarning = yield* FiberHandle.make();
      const resetNoNewBlockWarning = FiberHandle.run(
        noNewBlockWarning,
        Effect.sleep(30_000).pipe(
          Effect.andThen(
            Effect.logWarning({
              msg: "No new block received within expected time",
              chain: params.chain.name,
              chain_id: params.chain.id,
            }),
          ),
        ),
      );
      yield* resetNoNewBlockWarning;

      // Hash of the most recent block received from the RPC.
      let mostRecentHash = params.syncProgress.finalized.hash;

      /** Log and record the latency of a block once it is accepted or rejected. */
      const onAccepted = (
        block: Head["block"],
        isAccepted: Deferred.Deferred<boolean>,
        endClock: Effect.Effect<number>,
        arrivalMs: number,
      ) =>
        Effect.gen(function* () {
          const _isAccepted = yield* Deferred.await(isAccepted);

          yield* Effect.logTrace({
            msg: `Block ${_isAccepted ? "accepted into" : "rejected from"} live indexing`,
            chain: params.chain.name,
            chain_id: params.chain.id,
            number: hexToNumber(block.number),
            hash: block.hash,
            duration: yield* endClock,
          });

          if (_isAccepted) {
            metrics.ponder_realtime_block_arrival_latency.observe(
              { chain: params.chain.name },
              arrivalMs - hexToNumber(block.timestamp) * 1_000,
            );

            metrics.ponder_realtime_latency.observe(
              { chain: params.chain.name },
              yield* endClock,
            );
          }
        });

      type ReceivedHead = {
        block: Head["block"];
        /** Duration since the block was received. */
        endClock: Effect.Effect<number>;
      };

      const heads = params.rpc.subscribe.pipe(
        Stream.mapEffect(
          (result): Effect.Effect<Result.Result<ReceivedHead, Error>> =>
            Effect.gen(function* () {
              if (Result.isFailure(result)) return Result.fail(result.failure);

              const block = result.success;
              if (block.hash !== mostRecentHash) {
                mostRecentHash = block.hash;
                yield* resetNoNewBlockWarning;
              }

              const endClock = yield* startClockEffect;
              return Result.succeed({ block, endClock });
            }),
        ),
        (heads) =>
          bufferWithSize(heads, {
            capacity: "unbounded",
            onSize: (bufferSize) =>
              logBackpressure(bufferSize, {
                chain: params.chain.name,
                chain_id: params.chain.id,
                indexing_step: "fetch block data",
              }),
          }),
        Stream.mapEffect(
          (result): Effect.Effect<Result.Result<Head, Error>> =>
            Effect.gen(function* () {
              if (Result.isFailure(result)) return result;

              const { block, endClock } = result.success;
              const arrivalMs = yield* Clock.currentTimeMillis;
              const isAccepted = yield* Deferred.make<boolean>();

              yield* Effect.forkIn(
                onAccepted(block, isAccepted, endClock, arrivalMs),
                scope,
              );

              return Result.succeed({ block, isAccepted });
            }),
        ),
      );

      const end =
        params.syncProgress.end === undefined
          ? undefined
          : hexToNumber(params.syncProgress.end.number);

      return realtimeSync.events(heads).pipe(
        // Note: Blocks after the end block are synced to detect reorgs until the
        // end block is finalized, but they aren't indexed.
        Stream.filterEffect((event) =>
          Effect.gen(function* () {
            if (end === undefined) return true;
            if (
              event.type === "block" &&
              hexToNumber(event.block.number) > end
            ) {
              if (event.isAccepted) {
                yield* Deferred.succeed(event.isAccepted, true);
              }
              return false;
            }
            return (
              event.type !== "reorg" || hexToNumber(event.block.number) < end
            );
          }),
        ),
        Stream.takeUntil(
          (event) =>
            end !== undefined &&
            event.type === "finalize" &&
            hexToNumber(event.block.number) >= end,
        ),
        Stream.map((event) => ({ chain: params.chain, event })),
        Stream.concat(
          Stream.fromEffectDrain(
            Effect.gen(function* () {
              metrics.ponder_sync_is_realtime.set(
                { chain: params.chain.name },
                0,
              );
              metrics.ponder_sync_is_complete.set(
                { chain: params.chain.name },
                1,
              );
              yield* Effect.logInfo({
                msg: "Completed live indexing (chain end block has been finalized)",
                chain: params.chain.name,
                chain_id: params.chain.id,
                end_block: hexToNumber(params.syncProgress.end!.number),
              });
            }),
          ),
        ),
      );
    }),
  );

/** Build and decode the events of a block of the realtime sync. */
const buildBlockEvents = ({
  chain,
  eventCallbacks,
  childAddresses,
  event,
}: {
  chain: Chain;
  eventCallbacks: EventCallback[];
  childAddresses: ChildAddresses;
  event: Extract<RealtimeSyncEvent, { type: "block" }>;
}) =>
  Effect.gen(function* () {
    const rawEvents = buildEvents({
      eventCallbacks,
      chainId: chain.id,
      blocks: [syncBlockToInternal({ block: event.block })],
      logs: event.logs.map((log) => syncLogToInternal({ log })),
      transactions: event.transactions.map((transaction) =>
        syncTransactionToInternal({ transaction }),
      ),
      transactionReceipts: event.transactionReceipts.map((transactionReceipt) =>
        syncTransactionReceiptToInternal({ transactionReceipt }),
      ),
      traces: event.traces.map((trace) =>
        syncTraceToInternal({
          trace,
          block: event.block,
          transaction: event.transactions.find(
            (t) => t.hash === trace.transactionHash,
          )!,
        }),
      ),
      childAddresses,
    });

    yield* Effect.logTrace({
      msg: "Constructed events from block",
      chain: chain.name,
      chain_id: chain.id,
      number: hexToNumber(event.block.number),
      hash: event.block.hash,
      event_count: rawEvents.length,
    });

    const events = yield* decodeEvents(chain, eventCallbacks, rawEvents);

    yield* Effect.logTrace({
      msg: "Decoded block events",
      chain: chain.name,
      chain_id: chain.id,
      number: hexToNumber(event.block.number),
      hash: event.block.hash,
      event_count: events.length,
    });

    return events;
  });

/**
 * Update the sync progress and the local chain with a realtime sync event.
 * Finalized block data is stored in the rpc cache, and the cached requests of
 * reorged blocks are removed.
 */
export const handleRealtimeSyncEvent = (
  event: RealtimeSyncEvent,
  params: {
    chain: Chain;
    eventCallbacks: EventCallback[];
    syncProgress: SyncProgress;
    unfinalizedBlocks: UnfinalizedBlock[];
  },
): Effect.Effect<void, Error, Db | Options | Metrics> =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;

    switch (event.type) {
      case "block": {
        params.syncProgress.current = event.block;

        metrics.ponder_sync_block.set(
          { chain: params.chain.name },
          hexToNumber(params.syncProgress.current!.number),
        );
        metrics.ponder_sync_block_timestamp.set(
          { chain: params.chain.name },
          hexToNumber(params.syncProgress.current!.timestamp),
        );

        params.unfinalizedBlocks.push(event);

        break;
      }
      case "finalize": {
        const finalizedInterval = [
          hexToNumber(params.syncProgress.finalized.number),
          hexToNumber(event.block.number),
        ] satisfies Interval;

        params.syncProgress.finalized = event.block;

        // Remove all finalized data

        const finalizedBlocks: UnfinalizedBlock[] = [];

        while (params.unfinalizedBlocks.length > 0) {
          const block = params.unfinalizedBlocks[0]!;

          if (
            hexToNumber(block.block.number) <= hexToNumber(event.block.number)
          ) {
            finalizedBlocks.push(block);
            params.unfinalizedBlocks.shift();
          } else break;
        }

        if (params.chain.cacheRpcRequests === false) break;

        // Add finalized blocks, logs, transactions, receipts, and traces to the sync-store.

        const childAddresses = new Map<
          FactoryFragmentId,
          Map<Address, number>
        >();

        for (const block of finalizedBlocks) {
          for (const [fragmentId, addresses] of block.childAddresses) {
            if (childAddresses.has(fragmentId) === false) {
              childAddresses.set(fragmentId, new Map());
            }
            for (const address of addresses) {
              if (childAddresses.get(fragmentId)!.has(address) === false) {
                childAddresses
                  .get(fragmentId)!
                  .set(address, hexToNumber(block.block.number));
              }
            }
          }
        }

        const intervals: { interval: Interval; filter: Filter }[] = [];
        const factoryIntervals: { interval: Interval; factory: Factory }[] = [];

        for (const { filter } of params.eventCallbacks) {
          const completedIntervals = intervalIntersection(
            [finalizedInterval],
            [
              [
                filter.fromBlock ?? 0,
                filter.toBlock ?? Number.POSITIVE_INFINITY,
              ],
            ],
          );

          for (const interval of completedIntervals) {
            intervals.push({ interval, filter });
          }

          for (const factory of getFilterFactories(filter)) {
            const completedIntervals = intervalIntersection(
              [finalizedInterval],
              [
                [
                  factory.fromBlock ?? 0,
                  factory.toBlock ?? Number.POSITIVE_INFINITY,
                ],
              ],
            );

            for (const interval of completedIntervals) {
              factoryIntervals.push({ interval, factory });
            }
          }
        }

        const context = {
          logAnnotations: { action: "finalize_block_range" },
        };

        const db = yield* Db;

        yield* db.sync.transaction(
          (tx) =>
            Effect.gen(function* () {
              const syncStore = yield* createSyncStore(tx);

              // Note: Every insert finishes before the transaction fails with the
              // first error.
              const results = yield* Effect.all(
                [
                  syncStore.insertBlocks({
                    blocks: finalizedBlocks
                      .filter(({ hasMatchedFilter }) => hasMatchedFilter)
                      .map(({ block }) => block),
                    chainId: params.chain.id,
                  }),
                  syncStore.insertTransactions({
                    transactions: finalizedBlocks.flatMap(
                      ({ transactions }) => transactions,
                    ),
                    chainId: params.chain.id,
                  }),
                  syncStore.insertTransactionReceipts({
                    transactionReceipts: finalizedBlocks.flatMap(
                      ({ transactionReceipts }) => transactionReceipts,
                    ),
                    chainId: params.chain.id,
                  }),
                  syncStore.insertLogs({
                    logs: finalizedBlocks.flatMap(({ logs }) => logs),
                    chainId: params.chain.id,
                  }),
                  syncStore.insertTraces({
                    traces: finalizedBlocks.flatMap(
                      ({ traces, block, transactions }) =>
                        traces.map((trace) => ({
                          trace,
                          block: block as SyncBlock, // SyncBlock is expected for traces.length !== 0
                          transaction: transactions.find(
                            (t) => t.hash === trace.transactionHash,
                          )!,
                        })),
                    ),
                    chainId: params.chain.id,
                  }),
                  syncStore.insertChildAddresses({
                    childAddresses,
                    chainId: params.chain.id,
                  }),
                ].map(Effect.result),
                { concurrency: "unbounded" },
              );
              for (const result of results) {
                if (Result.isFailure(result)) {
                  return yield* Effect.fail(result.failure);
                }
              }

              yield* syncStore.insertIntervals(
                {
                  intervals,
                  factoryIntervals,
                  chainId: params.chain.id,
                },
                context,
              );
            }),
          context,
        );
        break;
      }
      case "reorg": {
        params.syncProgress.current = event.block;

        metrics.ponder_sync_block.set(
          { chain: params.chain.name },
          hexToNumber(params.syncProgress.current!.number),
        );
        metrics.ponder_sync_block_timestamp.set(
          { chain: params.chain.name },
          hexToNumber(params.syncProgress.current!.timestamp),
        );

        // Remove all reorged data

        while (params.unfinalizedBlocks.length > 0) {
          const block =
            params.unfinalizedBlocks[params.unfinalizedBlocks.length - 1]!;

          if (
            hexToNumber(block.block.number) > hexToNumber(event.block.number)
          ) {
            params.unfinalizedBlocks.pop();
          } else break;
        }

        if (params.chain.cacheRpcRequests) {
          const db = yield* Db;
          const syncStore = yield* createSyncStore(db.sync);
          yield* syncStore.pruneRpcRequestResults(
            {
              chainId: params.chain.id,
              blocks: event.reorgedBlocks,
            },
            { logAnnotations: { action: "reconcile_reorg" } },
          );
        }

        break;
      }
    }
  });

/**
 * Merge the realtime sync events of each chain, in the order of the "block"
 * events.
 *
 * @param isComplete - Whether a chain indexed its end block. The order of
 * "block" events doesn't wait for the stream of such a chain, which only
 * emits "reorg" and "finalize" events until a reorg.
 *
 * @dev "reorg" and "finalize" events are not ordered between chains.
 */
const mergeRealtimeEventsOmnichain = <E, R>(
  streams: Stream.Stream<ChainSyncEvent, E, R>[],
  isComplete: (chain: Chain) => boolean,
): Stream.Stream<ChainSyncEvent, E, R> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const pulls = yield* Effect.forEach(streams, (stream) =>
        Stream.toPull(Stream.rechunk(stream, 1)),
      );

      /**
       * The next event of each stream, `undefined` while it is pulled, or
       * `null` once the stream ended.
       */
      const heads: (ChainSyncEvent | null | undefined)[] = streams.map(
        () => undefined,
      );
      /** The chain of each stream, once it emitted an event. */
      const chains: (Chain | undefined)[] = streams.map(() => undefined);
      /** The streams whose next event is pulled. */
      const pulling = new Set<number>();
      /** The pulls that completed, in order. */
      const completed = yield* Queue.unbounded<{
        index: number;
        exit: Exit.Exit<ChainSyncEvent | null, E>;
      }>();

      const pull = (index: number) => {
        pulling.add(index);
        return Effect.forkIn(
          pulls[index]!.pipe(
            Effect.map(([value]): ChainSyncEvent | null => value),
            Pull.catchDone(() => Effect.succeed(null)),
            Effect.exit,
            Effect.flatMap((exit) => Queue.offer(completed, { index, exit })),
          ),
          scope,
          { startImmediately: true },
        );
      };

      /** Wait for a pull to complete. */
      const awaitPull = Effect.gen(function* () {
        const { index, exit } = yield* Queue.take(completed);
        pulling.delete(index);
        if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause);
        heads[index] = exit.value;
        if (exit.value !== null) chains[index] = exit.value.chain;
      });

      for (const index of streams.keys()) yield* pull(index);

      return Stream.paginate<void, ChainSyncEvent, E>(undefined, () =>
        Effect.gen(function* () {
          while (true) {
            let index = heads.findIndex(
              (head) =>
                head != null &&
                (head.event.type === "reorg" || head.event.type === "finalize"),
            );

            if (index === -1) {
              const blockCheckpoints = heads.map((head) =>
                head == null || head.event.type !== "block"
                  ? undefined
                  : encodeCheckpoint(
                      blockToCheckpoint(head.event.block, head.chain.id, "up"),
                    ),
              );

              const isWaiting = Array.from(pulling).some(
                (index) =>
                  chains[index] === undefined ||
                  isComplete(chains[index]!) === false,
              );

              if (
                isWaiting ||
                blockCheckpoints.every((checkpoint) => checkpoint === undefined)
              ) {
                if (pulling.size === 0) return [[], Option.none()] as const;
                yield* awaitPull;
                continue;
              }

              index = blockCheckpoints.indexOf(min(...blockCheckpoints));
            }

            const head = heads[index]!;
            heads[index] = undefined;
            yield* pull(index);

            return [[head], Option.some(undefined)] as const;
          }
        }),
      );
    }),
  );
