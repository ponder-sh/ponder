import type { Common } from "@/internal/common.js";
import type {
  Chain,
  CrashRecoveryCheckpoint,
  Event,
  Factory,
  FactoryId,
  Filter,
  IndexingBuild,
  LightBlock,
  Ordering,
  RawEvent,
  Seconds,
  Source,
  SyncBlock,
  SyncBlockHeader,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import {
  type HistoricalSync,
  createHistoricalSync,
} from "@/sync-historical/index.js";
import {
  type RealtimeSync,
  type RealtimeSyncEvent,
  createRealtimeSync,
} from "@/sync-realtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  type Checkpoint,
  MAX_CHECKPOINT,
  ZERO_CHECKPOINT,
  ZERO_CHECKPOINT_STRING,
  decodeCheckpoint,
  encodeCheckpoint,
  max,
  min,
} from "@/utils/checkpoint.js";
import { formatPercentage } from "@/utils/format.js";
import {
  bufferAsyncGenerator,
  createCallbackGenerator,
  mapAsyncGenerator,
  mergeAsyncGenerators,
} from "@/utils/generators.js";
import {
  type Interval,
  intervalDifference,
  intervalIntersection,
  intervalIntersectionMany,
  intervalSum,
  sortIntervals,
} from "@/utils/interval.js";
import { intervalUnion } from "@/utils/interval.js";
import { partition } from "@/utils/partition.js";
import { _eth_getBlockByNumber } from "@/utils/rpc.js";
import { startClock } from "@/utils/timer.js";
import { zipperMany } from "@/utils/zipper.js";
import { type Address, type Hash, hexToBigInt, hexToNumber, toHex } from "viem";
import {
  buildEvents,
  decodeEvents,
  syncBlockToInternal,
  syncLogToInternal,
  syncTraceToInternal,
  syncTransactionReceiptToInternal,
  syncTransactionToInternal,
} from "./events.js";
import { isAddressFactory } from "./filter.js";
import { initGenerator, initSyncProgress } from "./init.js";

export type Sync = {
  getHistoricalEvents(): EventGenerator;
  getRealtimeEvents(): AsyncGenerator<RealtimeEvent>;
  getStartCheckpoint(chain: Chain): string;
  seconds: Seconds;
};

export type RealtimeEvent =
  | {
      type: "block";
      events: Event[];
      chain: Chain;
      checkpoint: string;
      blockCallback?: (isAccepted: boolean) => void;
    }
  | {
      type: "reorg";
      chain: Chain;
      checkpoint: string;
    }
  | {
      type: "finalize";
      chain: Chain;
      checkpoint: string;
    };

type EventGenerator = AsyncGenerator<{
  events: Event[];
  /**
   * Closest-to-tip checkpoint for each chain,
   * excluding chains that were not updated with this batch of events.
   */
  checkpoints: { chainId: number; checkpoint: string }[];
}>;

export type SyncProgress = {
  start: SyncBlock | LightBlock;
  end: SyncBlock | LightBlock | undefined;
  current: SyncBlock | LightBlock | undefined;
  finalized: SyncBlock | LightBlock;
};

export const syncBlockToLightBlock = ({
  hash,
  parentHash,
  number,
  timestamp,
}: SyncBlock | SyncBlockHeader): LightBlock => ({
  hash,
  parentHash,
  number,
  timestamp,
});

/** Convert `block` to a `Checkpoint`. */
export const blockToCheckpoint = (
  block: LightBlock | SyncBlock,
  chainId: number,
  rounding: "up" | "down",
): Checkpoint => {
  return {
    ...(rounding === "up" ? MAX_CHECKPOINT : ZERO_CHECKPOINT),
    blockTimestamp: hexToBigInt(block.timestamp),
    chainId: BigInt(chainId),
    blockNumber: hexToBigInt(block.number),
  };
};

/**
 * Returns true if all filters have a defined end block and the current
 * sync progress has reached the final end block.
 */
const isSyncEnd = (syncProgress: SyncProgress) => {
  if (syncProgress.end === undefined || syncProgress.current === undefined) {
    return false;
  }

  return (
    hexToNumber(syncProgress.current.number) >=
    hexToNumber(syncProgress.end.number)
  );
};

/** Returns true if sync progress has reached the finalized block. */
const isSyncFinalized = (syncProgress: SyncProgress) => {
  if (syncProgress.current === undefined) {
    return false;
  }

  return (
    hexToNumber(syncProgress.current.number) >=
    hexToNumber(syncProgress.finalized.number)
  );
};

/** Returns the closest-to-tip block that is part of the historical sync. */
const getHistoricalLast = (
  syncProgress: Pick<SyncProgress, "finalized" | "end">,
) => {
  return syncProgress.end === undefined
    ? syncProgress.finalized
    : hexToNumber(syncProgress.end.number) >
        hexToNumber(syncProgress.finalized.number)
      ? syncProgress.finalized
      : syncProgress.end;
};

export const splitEvents = (
  events: Event[],
): { events: Event[]; chainId: number; checkpoint: string }[] => {
  let hash: Hash | undefined;
  const result: { events: Event[]; chainId: number; checkpoint: string }[] = [];

  for (const event of events) {
    if (hash === undefined || hash !== event.event.block.hash) {
      result.push({
        events: [],
        chainId: event.chainId,
        checkpoint: encodeCheckpoint({
          ...MAX_CHECKPOINT,
          blockTimestamp: event.event.block.timestamp,
          chainId: BigInt(event.chainId),
          blockNumber: event.event.block.number,
        }),
      });
      hash = event.event.block.hash;
    }

    result[result.length - 1]!.events.push(event);
  }

  return result;
};

/**
 * Returns the checkpoint for a given block tag.
 */
export const getChainCheckpoint = <
  tag extends "start" | "current" | "finalized" | "end",
>({
  syncProgress,
  chain,
  tag,
}: {
  syncProgress: SyncProgress;
  chain: Chain;
  tag: tag;
}): tag extends "end" ? string | undefined : string => {
  if (tag === "end" && syncProgress.end === undefined) {
    return undefined as tag extends "end" ? string | undefined : string;
  }

  // Note: `current` is guaranteed to be defined because it is only used once the historical
  // backfill is complete.
  const block = syncProgress[tag]!;
  return encodeCheckpoint(
    blockToCheckpoint(
      block,
      chain.id,
      // The checkpoint returned by this function is meant to be used in
      // a closed interval (includes endpoints), so "start" should be inclusive.
      tag === "start" ? "down" : "up",
    ),
  ) as tag extends "end" ? string | undefined : string;
};

export const createSync = async (params: {
  common: Common;
  indexingBuild: Pick<
    IndexingBuild,
    "sources" | "chains" | "rpcs" | "finalizedBlocks"
  >;
  syncStore: SyncStore;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  ordering: Ordering;
}): Promise<Sync> => {
  const perChainSync = new Map<
    Chain,
    {
      syncProgress: SyncProgress;
      historicalSync: HistoricalSync;
      realtimeSync: RealtimeSync | undefined;
      childAddresses: Map<FactoryId, Map<Address, number>>;
    }
  >();

  /**
   * Compute the checkpoint for a single chain.
   */
  const getMultichainCheckpoint = <
    tag extends "start" | "end" | "current" | "finalized",
  >({
    tag,
    chain,
  }: { tag: tag; chain: Chain }): tag extends "end"
    ? string | undefined
    : string => {
    const syncProgress = perChainSync.get(chain)!.syncProgress;
    return getChainCheckpoint({ syncProgress, chain, tag });
  };

  /**
   * Compute the checkpoint across all chains.
   */
  const getOmnichainCheckpoint = <
    tag extends "start" | "end" | "current" | "finalized",
  >({
    tag,
  }: { tag: tag }): tag extends "end" ? string | undefined : string => {
    const checkpoints = Array.from(perChainSync.entries()).map(
      ([chain, { syncProgress }]) =>
        getChainCheckpoint({ syncProgress, chain, tag }),
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
        ({ syncProgress }) => isSyncEnd(syncProgress),
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

    return min(...checkpoints) as tag extends "end"
      ? string | undefined
      : string;
  };

  async function* getHistoricalEvents() {
    const to = min(
      getOmnichainCheckpoint({ tag: "finalized" }),
      getOmnichainCheckpoint({ tag: "end" }),
    );

    const eventGenerators = await Promise.all(
      Array.from(perChainSync.entries()).map(
        async ([chain, { syncProgress, historicalSync, childAddresses }]) => {
          const sources = params.indexingBuild.sources.filter(
            ({ filter }) => filter.chainId === chain.id,
          );

          const crashRecoveryCheckpoint = params.crashRecoveryCheckpoint?.find(
            ({ chainId }) => chainId === chain.id,
          )?.checkpoint;

          async function* decodeEventGenerator(
            eventGenerator: AsyncGenerator<{
              events: RawEvent[];
              checkpoint: string;
            }>,
          ) {
            for await (const { events, checkpoint } of eventGenerator) {
              const endClock = startClock();
              const decodedEvents = decodeEvents(
                params.common,
                sources,
                events,
              );
              params.common.logger.debug({
                service: "app",
                msg: `Decoded ${decodedEvents.length} '${chain.name}' events`,
              });
              params.common.metrics.ponder_historical_extract_duration.inc(
                { step: "decode" },
                endClock(),
              );

              await new Promise(setImmediate);

              yield { events: decodedEvents, checkpoint };
            }
          }

          // Removes events that have a checkpoint earlier than (or equal to)
          // the crash recovery checkpoint.
          async function* sortCrashRecoveryEvents(
            eventGenerator: AsyncGenerator<{
              events: Event[];
              checkpoint: string;
            }>,
          ) {
            for await (const { events, checkpoint } of eventGenerator) {
              if (
                crashRecoveryCheckpoint &&
                events.length > 0 &&
                events[0]!.checkpoint <= crashRecoveryCheckpoint
              ) {
                const [, right] = partition(
                  events,
                  (event) => event.checkpoint <= crashRecoveryCheckpoint,
                );
                yield { events: right, checkpoint };
              } else {
                yield { events, checkpoint };
              }
            }
          }

          async function* sortCompletedAndPendingEvents(
            eventGenerator: AsyncGenerator<{
              events: Event[];
              checkpoint: string;
            }>,
          ) {
            for await (const { events, checkpoint } of eventGenerator) {
              // Sort out any events between the omnichain finalized checkpoint and the single-chain
              // finalized checkpoint and add them to pendingEvents. These events are synced during
              // the historical phase, but must be indexed in the realtime phase because events
              // synced in realtime on other chains might be ordered before them.
              if (params.ordering === "omnichain" && checkpoint > to) {
                const [left, right] = partition(
                  events,
                  (event) => event.checkpoint <= to,
                );
                pendingEvents = pendingEvents.concat(right);
                yield { events: left, checkpoint: to };
              } else {
                yield { events, checkpoint };
              }
            }
          }

          const getLocalGenerator = async () => {
            const localSyncGenerator = getLocalSyncGenerator({
              common: params.common,
              chain,
              syncProgress,
              historicalSync,
            });

            // In order to speed up the "extract" phase when there is a crash recovery,
            // the beginning cursor is moved forwards. This only works when `crashRecoveryCheckpoint`
            // is defined.
            let from: string;
            if (crashRecoveryCheckpoint === undefined) {
              from = getMultichainCheckpoint({ tag: "start", chain });
            } else if (
              Number(decodeCheckpoint(crashRecoveryCheckpoint).chainId) ===
              chain.id
            ) {
              from = crashRecoveryCheckpoint;
            } else {
              const fromBlock =
                await params.syncStore.getSafeCrashRecoveryBlock({
                  chainId: chain.id,
                  timestamp: Number(
                    decodeCheckpoint(crashRecoveryCheckpoint).blockTimestamp,
                  ),
                });

              if (fromBlock === undefined) {
                from = getMultichainCheckpoint({ tag: "start", chain });
              } else {
                from = encodeCheckpoint({
                  ...ZERO_CHECKPOINT,
                  blockNumber: fromBlock.number,
                  blockTimestamp: fromBlock.timestamp,
                  chainId: BigInt(chain.id),
                });
              }
            }

            return getLocalEventGenerator({
              common: params.common,
              chain,
              syncStore: params.syncStore,
              sources,
              localSyncGenerator,
              childAddresses,
              from,
              to: min(
                getMultichainCheckpoint({ tag: "finalized", chain }),
                getMultichainCheckpoint({ tag: "end", chain }),
              ),
              limit:
                Math.round(
                  params.common.options.syncEventsQuerySize /
                    (params.indexingBuild.chains.length + 1),
                ) + 6,
            });
          };

          return await initGenerator({
            common: params.common,
            indexingBuild: params.indexingBuild,
            chain,
            syncProgress,
            getLocalGenerator,
            decodeEventGenerator,
            sortCrashRecoveryEvents,
            sortCompletedAndPendingEvents,
          });
        },
      ),
    );

    let eventGenerator: EventGenerator;
    if (params.ordering === "multichain") {
      eventGenerator = mapAsyncGenerator(
        mergeAsyncGenerators(eventGenerators),
        ({ events, checkpoint }) => {
          return {
            events,
            checkpoints: [
              {
                chainId: Number(decodeCheckpoint(checkpoint).chainId),
                checkpoint,
              },
            ],
          };
        },
      );
    } else {
      eventGenerator = mergeAsyncGeneratorsWithEventOrder(eventGenerators);
    }

    for await (const { events, checkpoints } of eventGenerator) {
      params.common.logger.debug({
        service: "sync",
        msg: `Sequenced ${events.length} events`,
      });

      yield { events, checkpoints };
    }
  }

  async function* getRealtimeEvents(): AsyncGenerator<RealtimeEvent> {
    const eventGenerators = await Promise.all(
      Array.from(perChainSync.entries()).map(async function* ([
        chain,
        { syncProgress, childAddresses },
      ]) {
        const rpc =
          params.indexingBuild.rpcs[
            params.indexingBuild.chains.indexOf(chain)
          ]!;
        const sources = params.indexingBuild.sources.filter(
          ({ filter }) => filter.chainId === chain.id,
        );
        if (isSyncEnd(syncProgress)) {
          params.common.metrics.ponder_sync_is_complete.set(
            { chain: chain.name },
            1,
          );
        } else {
          params.common.metrics.ponder_sync_is_realtime.set(
            { chain: chain.name },
            1,
          );

          const perChainOnRealtimeSyncEvent = getPerChainOnRealtimeSyncEvent({
            common: params.common,
            chain,
            sources,
            syncStore: params.syncStore,
            syncProgress,
          });

          const realtimeSync = createRealtimeSync({
            common: params.common,
            chain,
            rpc,
            sources,
            syncProgress,
            childAddresses,
          });

          perChainSync.get(chain)!.realtimeSync = realtimeSync;

          let childCount = 0;
          for (const [, factoryChildAddresses] of childAddresses) {
            childCount += factoryChildAddresses.size;
          }

          params.common.logger.debug({
            service: "sync",
            msg: `Initialized '${chain.name}' realtime sync with ${childCount} factory child addresses`,
          });

          const { callback, generator } = createCallbackGenerator<
            SyncBlock | SyncBlockHeader,
            boolean
          >();

          rpc.subscribe({ onBlock: callback, onError: realtimeSync.onError });

          for await (const { value: block, onComplete } of generator) {
            const arrivalMs = Date.now();

            const endClock = startClock();

            const syncGenerator = realtimeSync.sync(block, (isAccepted) => {
              if (isAccepted) {
                params.common.metrics.ponder_realtime_block_arrival_latency.observe(
                  { chain: chain.name },
                  arrivalMs - hexToNumber(block.timestamp) * 1_000,
                );

                params.common.metrics.ponder_realtime_latency.observe(
                  { chain: chain.name },
                  endClock(),
                );
              }

              onComplete(isAccepted);
            });

            for await (const event of syncGenerator) {
              await perChainOnRealtimeSyncEvent(event);

              yield { chain, event };
            }

            if (isSyncFinalized(syncProgress) && isSyncEnd(syncProgress)) {
              // The realtime service can be killed if `endBlock` is
              // defined has become finalized.

              params.common.metrics.ponder_sync_is_realtime.set(
                { chain: chain.name },
                0,
              );
              params.common.metrics.ponder_sync_is_complete.set(
                { chain: chain.name },
                1,
              );
              params.common.logger.info({
                service: "sync",
                msg: `Killing '${chain.name}' live indexing because the end block ${hexToNumber(syncProgress.end!.number)} has been finalized`,
              });
              await rpc.unsubscribe();
              return;
            }
          }
        }
      }),
    );

    const merge =
      params.ordering === "multichain"
        ? mergeAsyncGenerators
        : mergeAsyncGeneratorsWithRealtimeOrder;

    for await (const { chain, event } of merge(eventGenerators)) {
      const { syncProgress, childAddresses } = perChainSync.get(chain)!;

      const sources = params.indexingBuild.sources.filter(
        ({ filter }) => filter.chainId === chain.id,
      );

      const result = onRealtimeSyncEvent(event, {
        chain,
        sources,
        syncProgress,
        childAddresses,
      });

      if (result === undefined) {
        continue;
      }

      yield result;
    }
  }

  /** Events that have been executed but not finalized. */
  let executedEvents: Event[] = [];
  /** Events that have not been executed. */
  let pendingEvents: Event[] = [];
  /** Closest-to-tip finalized checkpoint across all chains. */
  let finalizedCheckpoint = ZERO_CHECKPOINT_STRING;

  const onRealtimeSyncEvent = (
    event: RealtimeSyncEvent,
    {
      chain,
      sources,
      syncProgress,
      childAddresses,
    }: {
      chain: Chain;
      sources: Source[];
      syncProgress: SyncProgress;
      childAddresses: Map<FactoryId, Map<Address, number>>;
    },
  ): RealtimeEvent | undefined => {
    switch (event.type) {
      case "block": {
        const events = buildEvents({
          sources,
          chainId: chain.id,
          blockData: {
            block: syncBlockToInternal({ block: event.block }),
            logs: event.logs.map((log) => syncLogToInternal({ log })),
            transactions: event.transactions.map((transaction) =>
              syncTransactionToInternal({ transaction }),
            ),
            transactionReceipts: event.transactionReceipts.map(
              (transactionReceipt) =>
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
          },
          childAddresses,
        });

        params.common.logger.debug({
          service: "sync",
          msg: `Extracted ${events.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
        });

        const decodedEvents = decodeEvents(params.common, sources, events);
        params.common.logger.debug({
          service: "sync",
          msg: `Decoded ${decodedEvents.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
        });

        if (params.ordering === "multichain") {
          const checkpoint = getMultichainCheckpoint({ tag: "current", chain });

          const readyEvents = decodedEvents
            .concat(pendingEvents)
            .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
          pendingEvents = [];
          executedEvents = executedEvents.concat(readyEvents);

          params.common.logger.debug({
            service: "sync",
            msg: `Sequenced ${readyEvents.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
          });

          return {
            type: "block",
            events: readyEvents,
            chain,
            checkpoint,
            blockCallback: event.blockCallback,
          };
        } else {
          const checkpoint = getOmnichainCheckpoint({ tag: "current" });

          const readyEvents = pendingEvents
            .concat(decodedEvents)
            .filter((e) => e.checkpoint < checkpoint)
            .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
          pendingEvents = pendingEvents
            .concat(decodedEvents)
            .filter((e) => e.checkpoint > checkpoint);
          executedEvents = executedEvents.concat(readyEvents);

          params.common.logger.debug({
            service: "sync",
            msg: `Sequenced ${readyEvents.length} events`,
          });

          return {
            type: "block",
            events: readyEvents,
            chain,
            checkpoint,
            blockCallback: event.blockCallback,
          };
        }
      }

      case "finalize": {
        const from = finalizedCheckpoint;
        finalizedCheckpoint = getOmnichainCheckpoint({ tag: "finalized" });
        const to = getOmnichainCheckpoint({ tag: "finalized" });

        if (
          params.ordering === "omnichain" &&
          getChainCheckpoint({ syncProgress, chain, tag: "finalized" }) >
            getOmnichainCheckpoint({ tag: "current" })
        ) {
          const chainId = Number(
            decodeCheckpoint(getOmnichainCheckpoint({ tag: "current" }))
              .chainId,
          );
          const chain = params.indexingBuild.chains.find(
            (chain) => chain.id === chainId,
          )!;
          params.common.logger.warn({
            service: "sync",
            msg: `'${chain.name}' is lagging behind other chains`,
          });
        }

        if (to <= from) return;

        // index of the first unfinalized event
        let finalizeIndex: number | undefined = undefined;
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

        params.common.logger.debug({
          service: "sync",
          msg: `Finalized ${finalizedEvents.length} executed events`,
        });

        return { type: "finalize", chain, checkpoint: to };
      }

      case "reorg": {
        const isReorgedEvent = (_event: Event) => {
          if (
            _event.chainId === chain.id &&
            Number(_event.event.block.number) > hexToNumber(event.block.number)
          ) {
            return true;
          }
          return false;
        };

        if (params.ordering === "multichain") {
          const checkpoint = getMultichainCheckpoint({ tag: "current", chain });

          // index of the first reorged event
          let reorgIndex: number | undefined = undefined;
          for (const [index, event] of executedEvents.entries()) {
            if (event.chainId === chain.id && event.checkpoint > checkpoint) {
              reorgIndex = index;
              break;
            }
          }

          if (reorgIndex === undefined) {
            return;
          }

          // Move events from executed to pending

          const reorgedEvents = executedEvents.slice(reorgIndex);
          executedEvents = executedEvents.slice(0, reorgIndex);
          pendingEvents = pendingEvents.concat(reorgedEvents);

          params.common.logger.debug({
            service: "sync",
            msg: `Rescheduled ${reorgedEvents.length} reorged events`,
          });

          pendingEvents = pendingEvents.filter(
            (e) => isReorgedEvent(e) === false,
          );

          return { type: "reorg", chain, checkpoint };
        } else {
          const checkpoint = getOmnichainCheckpoint({ tag: "current" });

          // Move events from executed to pending

          const reorgedEvents = executedEvents.filter(
            (e) => e.checkpoint > checkpoint,
          );
          executedEvents = executedEvents.filter(
            (e) => e.checkpoint < checkpoint,
          );
          pendingEvents = pendingEvents.concat(reorgedEvents);

          params.common.logger.debug({
            service: "sync",
            msg: `Rescheduled ${reorgedEvents.length} reorged events`,
          });

          pendingEvents = pendingEvents.filter(
            (e) => isReorgedEvent(e) === false,
          );

          return { type: "reorg", chain, checkpoint };
        }
      }
    }
  };

  await Promise.all(
    params.indexingBuild.chains.map(async (chain, index) => {
      const rpc = params.indexingBuild.rpcs[index]!;
      const finalizedBlock = params.indexingBuild.finalizedBlocks[index]!;

      const sources = params.indexingBuild.sources.filter(
        ({ filter }) => filter.chainId === chain.id,
      );

      // Invalidate sync cache for devnet sources
      if (chain.disableCache) {
        params.common.logger.warn({
          service: "sync",
          msg: `Deleting cache records for '${chain.name}'`,
        });

        await params.syncStore.pruneByChain({
          chainId: chain.id,
        });
      }

      const childAddresses: Map<FactoryId, Map<Address, number>> = new Map();
      for (const source of sources) {
        switch (source.filter.type) {
          case "log":
            if (isAddressFactory(source.filter.address)) {
              const _childAddresses = await params.syncStore.getChildAddresses({
                factory: source.filter.address,
              });
              childAddresses.set(source.filter.address.id, _childAddresses);
            }
            break;
          case "transaction":
          case "transfer":
          case "trace":
            if (isAddressFactory(source.filter.fromAddress)) {
              const _childAddresses = await params.syncStore.getChildAddresses({
                factory: source.filter.fromAddress,
              });
              childAddresses.set(source.filter.fromAddress.id, _childAddresses);
            }

            if (isAddressFactory(source.filter.toAddress)) {
              const _childAddresses = await params.syncStore.getChildAddresses({
                factory: source.filter.toAddress,
              });
              childAddresses.set(source.filter.toAddress.id, _childAddresses);
            }

            break;
        }
      }

      const historicalSync = await createHistoricalSync({
        common: params.common,
        sources,
        syncStore: params.syncStore,
        childAddresses,
        rpc,
        chain,
      });

      const syncProgress = await initSyncProgress({
        common: params.common,
        chain,
        sources,
        rpc,
        finalizedBlock,
        historicalSync,
      });

      params.common.metrics.ponder_sync_is_realtime.set(
        { chain: chain.name },
        0,
      );
      params.common.metrics.ponder_sync_is_complete.set(
        { chain: chain.name },
        0,
      );

      perChainSync.set(chain, {
        syncProgress,
        historicalSync,
        realtimeSync: undefined,
        childAddresses,
      });
    }),
  );

  const seconds: Seconds = {};

  if (params.ordering === "multichain") {
    for (const chain of params.indexingBuild.chains) {
      const crashRecoveryCheckpoint = params.crashRecoveryCheckpoint?.find(
        ({ chainId }) => chainId === chain.id,
      )?.checkpoint;
      const start = Number(
        decodeCheckpoint(getMultichainCheckpoint({ tag: "start", chain }))
          .blockTimestamp,
      );

      const end = Number(
        decodeCheckpoint(
          min(
            getMultichainCheckpoint({ tag: "end", chain }),
            getMultichainCheckpoint({ tag: "finalized", chain }),
          ),
        ).blockTimestamp,
      );

      const cached = Math.min(
        Number(
          decodeCheckpoint(crashRecoveryCheckpoint ?? ZERO_CHECKPOINT_STRING)
            .blockTimestamp,
        ),
        end,
      );

      seconds[chain.name] = {
        start,
        end,
        cached,
      };
    }
  } else {
    const start = Number(
      decodeCheckpoint(getOmnichainCheckpoint({ tag: "start" })).blockTimestamp,
    );
    const end = Number(
      decodeCheckpoint(
        min(
          getOmnichainCheckpoint({ tag: "end" }),
          getOmnichainCheckpoint({ tag: "finalized" }),
        ),
      ).blockTimestamp,
    );

    for (const chain of params.indexingBuild.chains) {
      const crashRecoveryCheckpoint = params.crashRecoveryCheckpoint?.find(
        ({ chainId }) => chainId === chain.id,
      )?.checkpoint;

      const cached = Math.min(
        Number(
          decodeCheckpoint(crashRecoveryCheckpoint ?? ZERO_CHECKPOINT_STRING)
            .blockTimestamp,
        ),
        end,
      );

      seconds[chain.name] = {
        start,
        end,
        cached,
      };
    }
  }

  return {
    getHistoricalEvents,
    getRealtimeEvents,
    seconds,
    getStartCheckpoint(chain) {
      return getMultichainCheckpoint({ tag: "start", chain });
    },
  };
};

export const getPerChainOnRealtimeSyncEvent = ({
  common,
  chain,
  sources,
  syncProgress,
  syncStore,
}: {
  common: Common;
  chain: Chain;
  sources: Source[];
  syncProgress: SyncProgress;
  syncStore: SyncStore;
}) => {
  let unfinalizedBlocks: Omit<
    Extract<RealtimeSyncEvent, { type: "block" }>,
    "type"
  >[] = [];

  return async (event: RealtimeSyncEvent): Promise<void> => {
    switch (event.type) {
      case "block": {
        syncProgress.current = event.block;

        common.logger.debug({
          service: "sync",
          msg: `Updated '${chain.name}' current block to ${hexToNumber(event.block.number)}`,
        });

        common.metrics.ponder_sync_block.set(
          { chain: chain.name },
          hexToNumber(syncProgress.current!.number),
        );
        common.metrics.ponder_sync_block_timestamp.set(
          { chain: chain.name },
          hexToNumber(syncProgress.current!.timestamp),
        );

        unfinalizedBlocks.push(event);

        return;
      }

      case "finalize": {
        const finalizedInterval = [
          hexToNumber(syncProgress.finalized.number),
          hexToNumber(event.block.number),
        ] satisfies Interval;

        syncProgress.finalized = event.block;

        common.logger.debug({
          service: "sync",
          msg: `Updated '${chain.name}' finalized block to ${hexToNumber(event.block.number)}`,
        });

        // Remove all finalized data

        const finalizedBlocks = unfinalizedBlocks.filter(
          ({ block }) =>
            hexToNumber(block.number) <= hexToNumber(event.block.number),
        );

        unfinalizedBlocks = unfinalizedBlocks.filter(
          ({ block }) =>
            hexToNumber(block.number) > hexToNumber(event.block.number),
        );

        // Add finalized blocks, logs, transactions, receipts, and traces to the sync-store.

        const childAddresses = new Map<Factory, Map<Address, number>>();

        for (const block of finalizedBlocks) {
          for (const [factory, addresses] of block.childAddresses) {
            if (childAddresses.has(factory) === false) {
              childAddresses.set(factory, new Map());
            }
            for (const address of addresses) {
              if (childAddresses.get(factory)!.has(address) === false) {
                childAddresses
                  .get(factory)!
                  .set(address, hexToNumber(block.block.number));
              }
            }
          }
        }

        await Promise.all([
          syncStore.insertBlocks({
            blocks: finalizedBlocks
              .filter(({ hasMatchedFilter }) => hasMatchedFilter)
              .map(({ block }) => block),
            chainId: chain.id,
          }),
          syncStore.insertTransactions({
            transactions: finalizedBlocks.flatMap(
              ({ transactions }) => transactions,
            ),
            chainId: chain.id,
          }),
          syncStore.insertTransactionReceipts({
            transactionReceipts: finalizedBlocks.flatMap(
              ({ transactionReceipts }) => transactionReceipts,
            ),
            chainId: chain.id,
          }),
          syncStore.insertLogs({
            logs: finalizedBlocks.flatMap(({ logs }) => logs),
            chainId: chain.id,
          }),
          syncStore.insertTraces({
            traces: finalizedBlocks.flatMap(({ traces, block, transactions }) =>
              traces.map((trace) => ({
                trace,
                block: block as SyncBlock, // SyncBlock is expected for traces.length !== 0
                transaction: transactions.find(
                  (t) => t.hash === trace.transactionHash,
                )!,
              })),
            ),
            chainId: chain.id,
          }),
          ...Array.from(childAddresses.entries()).map(
            ([factory, childAddresses]) =>
              syncStore.insertChildAddresses({
                factory,
                childAddresses,
                chainId: chain.id,
              }),
          ),
        ]);

        // Add corresponding intervals to the sync-store
        // Note: this should happen after insertion so the database doesn't become corrupted

        if (chain.disableCache === false) {
          const syncedIntervals: {
            interval: Interval;
            filter: Filter;
          }[] = [];

          for (const { filter } of sources) {
            const intervals = intervalIntersection(
              [finalizedInterval],
              [
                [
                  filter.fromBlock ?? 0,
                  filter.toBlock ?? Number.POSITIVE_INFINITY,
                ],
              ],
            );

            for (const interval of intervals) {
              syncedIntervals.push({ interval, filter });
            }
          }

          await syncStore.insertIntervals({
            intervals: syncedIntervals,
            chainId: chain.id,
          });
        }

        return;
      }

      case "reorg": {
        syncProgress.current = event.block;

        common.logger.debug({
          service: "sync",
          msg: `Updated '${chain.name}' current block to ${hexToNumber(event.block.number)}`,
        });

        common.metrics.ponder_sync_block.set(
          { chain: chain.name },
          hexToNumber(syncProgress.current!.number),
        );
        common.metrics.ponder_sync_block_timestamp.set(
          { chain: chain.name },
          hexToNumber(syncProgress.current!.timestamp),
        );

        // Remove all reorged data

        unfinalizedBlocks = unfinalizedBlocks.filter(
          ({ block }) =>
            hexToNumber(block.number) <= hexToNumber(event.block.number),
        );

        await syncStore.pruneRpcRequestResults({
          chainId: chain.id,
          blocks: event.reorgedBlocks,
        });

        return;
      }
    }
  };
};

export async function* getLocalEventGenerator(params: {
  common: Common;
  chain: Chain;
  syncStore: SyncStore;
  sources: Source[];
  localSyncGenerator: AsyncGenerator<number>;
  childAddresses: Map<FactoryId, Map<Address, number>>;
  from: string;
  to: string;
  limit: number;
}): AsyncGenerator<{ events: RawEvent[]; checkpoint: string }> {
  const fromBlock = Number(decodeCheckpoint(params.from).blockNumber);
  const toBlock = Number(decodeCheckpoint(params.to).blockNumber);
  let cursor = fromBlock;

  params.common.logger.debug({
    service: "sync",
    msg: `Initialized '${params.chain.name}' extract query for block range [${fromBlock}, ${toBlock}]`,
  });

  for await (const syncCursor of bufferAsyncGenerator(
    params.localSyncGenerator,
    Number.POSITIVE_INFINITY,
  )) {
    while (cursor <= Math.min(syncCursor, toBlock)) {
      const { blockData, cursor: queryCursor } =
        await params.syncStore.getEventBlockData({
          filters: params.sources.map(({ filter }) => filter),
          fromBlock: cursor,
          toBlock: Math.min(syncCursor, toBlock),
          chainId: params.chain.id,
          limit: params.limit,
        });

      const endClock = startClock();
      const events = blockData.flatMap((bd) =>
        buildEvents({
          sources: params.sources,
          blockData: bd,
          childAddresses: params.childAddresses,
          chainId: params.chain.id,
        }),
      );
      params.common.metrics.ponder_historical_extract_duration.inc(
        { step: "build" },
        endClock(),
      );

      params.common.logger.debug({
        service: "sync",
        msg: `Extracted ${events.length} '${params.chain.name}' events for block range [${cursor}, ${queryCursor}]`,
      });

      await new Promise(setImmediate);

      cursor = queryCursor + 1;
      if (cursor === toBlock) {
        yield { events, checkpoint: params.to };
      } else if (blockData.length > 0) {
        const checkpoint = encodeCheckpoint({
          ...MAX_CHECKPOINT,
          blockTimestamp: blockData[blockData.length - 1]!.block.timestamp,
          chainId: BigInt(params.chain.id),
          blockNumber: blockData[blockData.length - 1]!.block.number,
        });
        yield { events, checkpoint };
      }
    }
  }
}

export async function* getLocalSyncGenerator({
  common,
  chain,
  syncProgress,
  historicalSync,
}: {
  common: Common;
  chain: Chain;
  syncProgress: SyncProgress;
  historicalSync: HistoricalSync;
}): AsyncGenerator<number> {
  const label = { chain: chain.name };

  let cursor = hexToNumber(syncProgress.start.number);
  const last = getHistoricalLast(syncProgress);

  // Estimate optimal range (blocks) to sync at a time, eventually to be used to
  // determine `interval` passed to `historicalSync.sync()`.
  let estimateRange = 25;

  // Handle two special cases:
  // 1. `syncProgress.start` > `syncProgress.finalized`
  // 2. `cached` is defined

  if (
    hexToNumber(syncProgress.start.number) >
    hexToNumber(syncProgress.finalized.number)
  ) {
    syncProgress.current = syncProgress.finalized;

    common.logger.warn({
      service: "sync",
      msg: `Skipped '${chain.name}' historical sync because the start block is unfinalized`,
    });

    common.metrics.ponder_sync_block.set(
      label,
      hexToNumber(syncProgress.current.number),
    );
    common.metrics.ponder_sync_block_timestamp.set(
      label,
      hexToNumber(syncProgress.current.timestamp),
    );
    common.metrics.ponder_historical_total_blocks.set(label, 0);
    common.metrics.ponder_historical_cached_blocks.set(label, 0);

    return;
  }

  const totalInterval = [
    hexToNumber(syncProgress.start.number),
    hexToNumber(last.number),
  ] satisfies Interval;

  common.logger.debug({
    service: "sync",
    msg: `Initialized '${chain.name}' historical sync for block range [${totalInterval[0]}, ${totalInterval[1]}]`,
  });

  const requiredIntervals = Array.from(
    historicalSync.intervalsCache.entries(),
  ).flatMap(([filter, fragmentIntervals]) => {
    const filterIntervals: Interval[] = [
      [
        filter.fromBlock ?? 0,
        Math.min(filter.toBlock ?? Number.POSITIVE_INFINITY, totalInterval[1]),
      ],
    ];

    switch (filter.type) {
      case "log":
        if (isAddressFactory(filter.address)) {
          filterIntervals.push([
            filter.address.fromBlock ?? 0,
            Math.min(
              filter.address.toBlock ?? Number.POSITIVE_INFINITY,
              totalInterval[1],
            ),
          ]);
        }
        break;
      case "trace":
      case "transaction":
      case "transfer":
        if (isAddressFactory(filter.fromAddress)) {
          filterIntervals.push([
            filter.fromAddress.fromBlock ?? 0,
            Math.min(
              filter.fromAddress.toBlock ?? Number.POSITIVE_INFINITY,
              totalInterval[1],
            ),
          ]);
        }

        if (isAddressFactory(filter.toAddress)) {
          filterIntervals.push([
            filter.toAddress.fromBlock ?? 0,
            Math.min(
              filter.toAddress.toBlock ?? Number.POSITIVE_INFINITY,
              totalInterval[1],
            ),
          ]);
        }
    }

    return intervalDifference(
      intervalUnion(filterIntervals),
      intervalIntersectionMany(
        fragmentIntervals.map(({ intervals }) => intervals),
      ),
    );
  });

  const required = intervalSum(intervalUnion(requiredIntervals));
  const total = totalInterval[1] - totalInterval[0] + 1;

  common.metrics.ponder_historical_total_blocks.set(label, total);
  common.metrics.ponder_historical_cached_blocks.set(label, total - required);

  // Handle cache hit
  if (syncProgress.current !== undefined) {
    common.metrics.ponder_sync_block.set(
      label,
      hexToNumber(syncProgress.current.number),
    );
    common.metrics.ponder_sync_block_timestamp.set(
      label,
      hexToNumber(syncProgress.current.timestamp),
    );

    // `getEvents` can make progress without calling `sync`, so immediately "yield"
    yield hexToNumber(syncProgress.current.number);

    if (hexToNumber(syncProgress.current.number) === hexToNumber(last.number)) {
      common.logger.info({
        service: "sync",
        msg: `Skipped '${chain.name}' historical sync because all blocks are cached`,
      });
      return;
    } else {
      common.logger.info({
        service: "sync",
        msg: `Started '${chain.name}' historical sync with ${formatPercentage(
          (total - required) / total,
        )} cached`,
      });
    }

    cursor = hexToNumber(syncProgress.current.number) + 1;
  } else {
    common.logger.info({
      service: "historical",
      msg: `Started '${chain.name}' historical sync with 0% cached`,
    });
  }

  while (true) {
    // Select a range of blocks to sync bounded by `finalizedBlock`.
    // It is important for devEx that the interval is not too large, because
    // time spent syncing ≈ time before indexing function feedback.

    const interval: Interval = [
      Math.min(cursor, hexToNumber(last.number)),
      Math.min(cursor + estimateRange, hexToNumber(last.number)),
    ];

    const endClock = startClock();

    const synced = await historicalSync.sync(interval);

    common.logger.debug({
      service: "sync",
      msg: `Synced ${interval[1] - interval[0] + 1} '${chain.name}' blocks in range [${interval[0]}, ${interval[1]}]`,
    });

    // Update cursor to record progress
    cursor = interval[1] + 1;

    // `synced` will be undefined if a cache hit occur in `historicalSync.sync()`.

    if (synced === undefined) {
      // If the all known blocks are synced, then update `syncProgress.current`, else
      // progress to the next iteration.
      if (interval[1] === hexToNumber(last.number)) {
        syncProgress.current = last;
      } else {
        continue;
      }
    } else {
      if (interval[1] === hexToNumber(last.number)) {
        syncProgress.current = last;
      } else {
        syncProgress.current = synced;
      }

      const duration = endClock();

      common.metrics.ponder_sync_block.set(
        label,
        hexToNumber(syncProgress.current.number),
      );
      common.metrics.ponder_sync_block_timestamp.set(
        label,
        hexToNumber(syncProgress.current.timestamp),
      );
      common.metrics.ponder_historical_duration.observe(label, duration);
      common.metrics.ponder_historical_completed_blocks.inc(
        label,
        interval[1] - interval[0] + 1,
      );

      // Use the duration and interval of the last call to `sync` to update estimate
      // 25 <= estimate(new) <= estimate(prev) * 2 <= 100_000
      estimateRange = Math.min(
        Math.max(
          25,
          Math.round((1_000 * (interval[1] - interval[0])) / duration),
        ),
        estimateRange * 2,
        100_000,
      );

      common.logger.trace({
        service: "sync",
        msg: `Updated '${chain.name}' historical sync estimate to ${estimateRange} blocks`,
      });
    }

    yield hexToNumber(syncProgress.current.number);

    if (isSyncEnd(syncProgress) || isSyncFinalized(syncProgress)) {
      common.logger.info({
        service: "sync",
        msg: `Completed '${chain.name}' historical sync`,
      });
      return;
    }
  }
}

export const getLocalSyncProgress = async ({
  common,
  sources,
  chain,
  rpc,
  finalizedBlock,
  intervalsCache,
}: {
  common: Common;
  sources: Source[];
  chain: Chain;
  rpc: Rpc;
  finalizedBlock: LightBlock;
  intervalsCache: HistoricalSync["intervalsCache"];
}): Promise<SyncProgress> => {
  const syncProgress = {} as SyncProgress;
  const filters = sources.map(({ filter }) => filter);

  // Earliest `fromBlock` among all `filters`
  const start = Math.min(
    ...filters.flatMap((filter) => {
      const fromBlocks: number[] = [filter.fromBlock ?? 0];
      switch (filter.type) {
        case "log":
          if (isAddressFactory(filter.address)) {
            fromBlocks.push(filter.address.fromBlock ?? 0);
          }
          break;
        case "transaction":
        case "trace":
        case "transfer":
          if (isAddressFactory(filter.fromAddress)) {
            fromBlocks.push(filter.fromAddress.fromBlock ?? 0);
          }

          if (isAddressFactory(filter.toAddress)) {
            fromBlocks.push(filter.toAddress.fromBlock ?? 0);
          }
      }

      return fromBlocks;
    }),
  );

  const cached = getCachedBlock({ filters, intervalsCache });

  const diagnostics = await Promise.all(
    cached === undefined
      ? [
          rpc.request({ method: "eth_chainId" }),
          _eth_getBlockByNumber(rpc, { blockNumber: start }),
        ]
      : [
          rpc.request({ method: "eth_chainId" }),
          _eth_getBlockByNumber(rpc, { blockNumber: start }),
          _eth_getBlockByNumber(rpc, { blockNumber: cached }),
        ],
  );

  syncProgress.finalized = finalizedBlock;
  syncProgress.start = diagnostics[1];
  if (diagnostics.length === 3) {
    syncProgress.current = diagnostics[2];
  }

  // Warn if the config has a different chainId than the remote.
  if (hexToNumber(diagnostics[0]) !== chain.id) {
    common.logger.warn({
      service: "sync",
      msg: `Remote chain ID (${diagnostics[0]}) does not match configured chain ID (${chain.id}) for chain "${chain.name}"`,
    });
  }

  if (filters.some((filter) => filter.toBlock === undefined)) {
    return syncProgress;
  }

  // Latest `toBlock` among all `filters`
  const end = Math.max(...filters.map((filter) => filter.toBlock!));

  if (end > hexToNumber(finalizedBlock.number)) {
    syncProgress.end = {
      number: toHex(end),
      hash: "0x",
      parentHash: "0x",
      timestamp: toHex(MAX_CHECKPOINT.blockTimestamp),
    } satisfies LightBlock;
  } else {
    syncProgress.end = await _eth_getBlockByNumber(rpc, {
      blockNumber: end,
    });
  }

  return syncProgress;
};

/** Returns the closest-to-tip block that has been synced for all `sources`. */
export const getCachedBlock = ({
  filters,
  intervalsCache,
}: {
  filters: Filter[];
  intervalsCache: HistoricalSync["intervalsCache"];
}): number | undefined => {
  const latestCompletedBlocks = filters.map((filter) => {
    const requiredInterval = [
      filter.fromBlock ?? 0,
      filter.toBlock ?? Number.POSITIVE_INFINITY,
    ] satisfies Interval;
    const fragmentIntervals = intervalsCache.get(filter)!;

    const completedIntervals = sortIntervals(
      intervalIntersection(
        [requiredInterval],
        intervalIntersectionMany(
          fragmentIntervals.map(({ intervals }) => intervals),
        ),
      ),
    );

    if (completedIntervals.length === 0) return undefined;

    const earliestCompletedInterval = completedIntervals[0]!;
    if (earliestCompletedInterval[0] !== (filter.fromBlock ?? 0)) {
      return undefined;
    }
    return earliestCompletedInterval[1];
  });

  const minCompletedBlock = Math.min(
    ...(latestCompletedBlocks.filter(
      (block) => block !== undefined,
    ) as number[]),
  );

  //  Filter i has known progress if a completed interval is found or if
  // `_latestCompletedBlocks[i]` is undefined but `filters[i].fromBlock`
  // is > `_minCompletedBlock`.

  if (
    latestCompletedBlocks.every(
      (block, i) =>
        block !== undefined || (filters[i]!.fromBlock ?? 0) > minCompletedBlock,
    )
  ) {
    return minCompletedBlock;
  }

  return undefined;
};

/**
 * Merges multiple event generators into a single generator while preserving
 * the order of events.
 *
 * @param generators - Generators to merge.
 * @returns A single generator that yields events from all generators.
 */
export async function* mergeAsyncGeneratorsWithEventOrder(
  generators: AsyncGenerator<{ events: Event[]; checkpoint: string }>[],
): EventGenerator {
  const results = await Promise.all(generators.map((gen) => gen.next()));

  while (results.some((res) => res.done !== true)) {
    const supremum = min(
      ...results.map((res) => (res.done ? undefined : res.value.checkpoint)),
    );

    const eventArrays: {
      events: Event[];
      chainId: number;
      checkpoint: string;
    }[] = [];

    for (const result of results) {
      if (result.done === false) {
        const [left, right] = partition(
          result.value.events,
          (event) => event.checkpoint <= supremum,
        );

        const event = left[left.length - 1];

        if (event) {
          eventArrays.push({
            events: left,
            chainId: event.chainId,
            checkpoint: event.checkpoint,
          });
        }

        result.value.events = right;
      }
    }

    const events = zipperMany(eventArrays.map(({ events }) => events)).sort(
      (a, b) => (a.checkpoint < b.checkpoint ? -1 : 1),
    );

    const index = results.findIndex(
      (res) => res.done === false && res.value.checkpoint === supremum,
    );

    const resultPromise = generators[index]!.next();
    if (events.length > 0) {
      const checkpoints = eventArrays.map(({ chainId, checkpoint }) => ({
        chainId,
        checkpoint,
      }));

      yield { events, checkpoints };
    }
    results[index] = await resultPromise;
  }
}

export async function* mergeAsyncGeneratorsWithRealtimeOrder(
  generators: AsyncGenerator<{ chain: Chain; event: RealtimeSyncEvent }>[],
): AsyncGenerator<{ chain: Chain; event: RealtimeSyncEvent }> {
  const results = await Promise.all(generators.map((gen) => gen.next()));

  while (results.some((res) => res.done !== true)) {
    let index: number;

    if (
      results.some(
        (result) =>
          result.done === false &&
          (result.value.event.type === "reorg" ||
            result.value.event.type === "finalize"),
      )
    ) {
      index = results.findIndex(
        (result) =>
          result.done === false &&
          (result.value.event.type === "reorg" ||
            result.value.event.type === "finalize"),
      );
    } else {
      const blockCheckpoints = results.map((result) =>
        result.done
          ? undefined
          : encodeCheckpoint(
              blockToCheckpoint(
                result.value.event.block,
                result.value.chain.id,
                "up",
              ),
            ),
      );

      const supremum = min(...blockCheckpoints);

      index = blockCheckpoints.findIndex(
        (checkpoint) => checkpoint === supremum,
      );
    }

    const resultPromise = generators[index]!.next();

    yield {
      chain: results[index]!.value.chain,
      event: results[index]!.value.event,
    };
    results[index] = await resultPromise;
  }
}
