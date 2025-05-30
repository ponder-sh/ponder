import type { Common } from "@/internal/common.js";
import type {
  Chain,
  CrashRecoveryCheckpoint,
  Event,
  Factory,
  Filter,
  IndexingBuild,
  LightBlock,
  RawEvent,
  Seconds,
  Source,
  SyncBlock,
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
import { createMutex } from "@/utils/mutex.js";
import { never } from "@/utils/never.js";
import { partition } from "@/utils/partition.js";
import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
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

export type Sync = {
  getEvents(): EventGenerator;
  startRealtime(): Promise<void>;
  getStartCheckpoint(chain: Chain): string;
  getFinalizedCheckpoint(chain: Chain): string;
  seconds: Seconds;
};

export type RealtimeEvent =
  | {
      type: "block";
      chain: Chain;
      events: Event[];
      /**
       * Closest-to-tip checkpoint for each chain,
       * excluding chains that were not updated with this event.
       */
      checkpoints: { chainId: number; checkpoint: string }[];
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
}: SyncBlock): LightBlock => ({
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
  onRealtimeEvent(event: RealtimeEvent): Promise<void>;
  onFatalError(error: Error): void;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  ordering: "omnichain" | "multichain";
}): Promise<Sync> => {
  const perChainSync = new Map<
    Chain,
    {
      syncProgress: SyncProgress;
      historicalSync: HistoricalSync;
      realtimeSync: RealtimeSync | undefined;
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

  async function* getEvents() {
    const to = min(
      getOmnichainCheckpoint({ tag: "finalized" }),
      getOmnichainCheckpoint({ tag: "end" }),
    );

    const eventGenerators = Array.from(perChainSync.entries()).map(
      ([chain, { syncProgress, historicalSync }]) => {
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
            const decodedEvents = decodeEvents(params.common, sources, events);
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

        async function* sortCrashRecoveryEvents(
          eventGenerator: AsyncGenerator<{
            events: Event[];
            checkpoint: string;
          }>,
        ) {
          for await (const { events, checkpoint } of eventGenerator) {
            // Sort out any events before the crash recovery checkpoint

            if (
              crashRecoveryCheckpoint &&
              events.length > 0 &&
              events[0]!.checkpoint < crashRecoveryCheckpoint
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
            if (checkpoint > to) {
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

        const localSyncGenerator = getLocalSyncGenerator({
          common: params.common,
          chain,
          syncProgress,
          historicalSync,
        });

        // In order to speed up the "extract" phase when there is a crash recovery,
        // the beginning cursor is moved forwards. This only works when `crashRecoveryCheckpoint`
        // is defined and `crashRecoveryCheckpoint` refers to the same chain as `chain`.
        let from: string;
        if (
          crashRecoveryCheckpoint &&
          Number(decodeCheckpoint(crashRecoveryCheckpoint).chainId) === chain.id
        ) {
          from = crashRecoveryCheckpoint;
        } else {
          from = getMultichainCheckpoint({ tag: "start", chain });
        }

        const localEventGenerator = getLocalEventGenerator({
          common: params.common,
          chain,
          syncStore: params.syncStore,
          sources,
          localSyncGenerator,
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

        return sortCompletedAndPendingEvents(
          sortCrashRecoveryEvents(decodeEventGenerator(localEventGenerator)),
        );
      },
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

  /** Events that have been executed but not finalized. */
  let executedEvents: Event[] = [];
  /** Events that have not been executed. */
  let pendingEvents: Event[] = [];

  const realtimeMutex = createMutex();

  const checkpoints = {
    // Note: `checkpoints.current` not used in multichain ordering
    current: ZERO_CHECKPOINT_STRING,
    finalized: ZERO_CHECKPOINT_STRING,
  };

  // Note: `omnichainCheckpointHooks` not used in multichain ordering
  let omnichainHooks: {
    checkpoint: string;
    callback: () => void;
  }[] = [];

  const onRealtimeSyncEvent = async (
    event: RealtimeSyncEvent,
    {
      chain,
      sources,
      syncProgress,
      realtimeSync,
    }: {
      chain: Chain;
      sources: Source[];
      syncProgress: SyncProgress;
      realtimeSync: RealtimeSync;
    },
  ): Promise<void> => {
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
          childAddresses: realtimeSync.childAddresses,
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
          // Note: `checkpoints.current` not used in multichain ordering
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

          await params.onRealtimeEvent({
            type: "block",
            chain,
            events: readyEvents,
            checkpoints: [{ chainId: chain.id, checkpoint }],
          });
        } else {
          const from = checkpoints.current;
          checkpoints.current = getOmnichainCheckpoint({ tag: "current" });
          const to = getOmnichainCheckpoint({ tag: "current" });

          const pwr = promiseWithResolvers<void>();
          omnichainHooks.push({
            checkpoint: encodeCheckpoint(
              blockToCheckpoint(event.block, chain.id, "down"),
            ),
            callback: () => pwr.resolve(),
          });

          if (to > from) {
            // Move ready events from pending to executed

            const readyEvents = pendingEvents
              .concat(decodedEvents)
              .filter(({ checkpoint }) => checkpoint < to)
              .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
            pendingEvents = pendingEvents
              .concat(decodedEvents)
              .filter(({ checkpoint }) => checkpoint > to);
            executedEvents = executedEvents.concat(readyEvents);

            params.common.logger.debug({
              service: "sync",
              msg: `Sequenced ${readyEvents.length} events`,
            });

            const checkpoints: { chainId: number; checkpoint: string }[] = [];
            for (const chain of params.indexingBuild.chains) {
              const localBlock = perChainSync
                .get(chain)!
                .realtimeSync!.unfinalizedBlocks.findLast((block) => {
                  const checkpoint = encodeCheckpoint(
                    blockToCheckpoint(block, chain.id, "up"),
                  );
                  return checkpoint > from && checkpoint <= to;
                });

              if (localBlock) {
                const checkpoint = encodeCheckpoint(
                  blockToCheckpoint(localBlock, chain.id, "up"),
                );

                checkpoints.push({ chainId: chain.id, checkpoint });
              }
            }

            await params.onRealtimeEvent({
              type: "block",
              events: readyEvents,
              chain,
              checkpoints,
            });

            const completedHooks = omnichainHooks.filter(
              ({ checkpoint }) => checkpoint > from && checkpoint <= to,
            );
            omnichainHooks = omnichainHooks.filter(
              ({ checkpoint }) =>
                (checkpoint > from && checkpoint <= to) === false,
            );
            for (const { callback } of completedHooks) {
              callback();
            }
          } else {
            pendingEvents = pendingEvents.concat(decodedEvents);
          }

          return pwr.promise;
        }

        break;
      }

      case "finalize": {
        const from = checkpoints.finalized;
        checkpoints.finalized = getOmnichainCheckpoint({ tag: "finalized" });
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

        // Remove all finalized data

        executedEvents = executedEvents.filter((e) => e.checkpoint > to);

        // Raise event to parent function (runtime)
        if (to > from) {
          params.onRealtimeEvent({ type: "finalize", chain, checkpoint: to });
        }

        break;
      }

      case "reorg": {
        // Remove all reorged data

        let reorgedEvents = 0;

        params.common.logger.debug({
          service: "sync",
          msg: `Removed ${reorgedEvents} reorged '${chain.name}' events`,
        });

        if (params.ordering === "multichain") {
          // Note: `checkpoints.current` not used in multichain ordering
          const checkpoint = getMultichainCheckpoint({ tag: "current", chain });

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

          params.onRealtimeEvent({ type: "reorg", chain, checkpoint });
        } else {
          const from = checkpoints.current;
          checkpoints.current = getOmnichainCheckpoint({ tag: "current" });
          const to = getOmnichainCheckpoint({ tag: "current" });

          // Move events from executed to pending

          const reorgedEvents = executedEvents.filter((e) => e.checkpoint > to);
          executedEvents = executedEvents.filter((e) => e.checkpoint < to);
          pendingEvents = pendingEvents.concat(reorgedEvents);

          params.common.logger.debug({
            service: "sync",
            msg: `Rescheduled ${reorgedEvents.length} reorged events`,
          });

          if (to < from) {
            params.onRealtimeEvent({ type: "reorg", chain, checkpoint: to });
          }
        }

        const isReorgedEvent = ({ chainId, event: { block } }: Event) => {
          if (
            chainId === chain.id &&
            Number(block.number) > hexToNumber(event.block.number)
          ) {
            reorgedEvents++;
            return true;
          }
          return false;
        };

        pendingEvents = pendingEvents.filter(
          (e) => isReorgedEvent(e) === false,
        );
        executedEvents = executedEvents.filter(
          (e) => isReorgedEvent(e) === false,
        );

        break;
      }

      default:
        never(event);
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

      const historicalSync = await createHistoricalSync({
        common: params.common,
        sources,
        syncStore: params.syncStore,
        rpc,
        chain,
        onFatalError: params.onFatalError,
      });

      const syncProgress = await getLocalSyncProgress({
        common: params.common,
        chain,
        sources,
        rpc,
        finalizedBlock,
        intervalsCache: historicalSync.intervalsCache,
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
      });
    }),
  );

  const seconds: Seconds = {};

  for (const chain of params.indexingBuild.chains) {
    const crashRecoveryCheckpoint = params.crashRecoveryCheckpoint?.find(
      ({ chainId }) => chainId === chain.id,
    )?.checkpoint;

    seconds[chain.name] = {
      start: Number(
        decodeCheckpoint(getOmnichainCheckpoint({ tag: "start" }))
          .blockTimestamp,
      ),
      end: Number(
        decodeCheckpoint(
          min(
            getOmnichainCheckpoint({ tag: "end" }),
            getOmnichainCheckpoint({ tag: "finalized" }),
          ),
        ).blockTimestamp,
      ),
      cached: Number(
        decodeCheckpoint(
          min(
            getOmnichainCheckpoint({ tag: "end" }),
            getOmnichainCheckpoint({ tag: "finalized" }),
            crashRecoveryCheckpoint ?? ZERO_CHECKPOINT_STRING,
          ),
        ).blockTimestamp,
      ),
    };
  }

  return {
    getEvents,
    async startRealtime() {
      for (let index = 0; index < params.indexingBuild.chains.length; index++) {
        const chain = params.indexingBuild.chains[index]!;
        const rpc = params.indexingBuild.rpcs[index]!;

        const { syncProgress } = perChainSync.get(chain)!;

        const sources = params.indexingBuild.sources.filter(
          ({ filter }) => filter.chainId === chain.id,
        );
        const filters = sources.map(({ filter }) => filter);

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

          const initialChildAddresses = new Map<
            Factory,
            Map<Address, number>
          >();

          for (const filter of filters) {
            switch (filter.type) {
              case "log":
                if (isAddressFactory(filter.address)) {
                  const childAddresses =
                    await params.syncStore.getChildAddresses({
                      factory: filter.address,
                    });

                  initialChildAddresses.set(filter.address, childAddresses);
                }
                break;

              case "transaction":
              case "transfer":
              case "trace":
                if (isAddressFactory(filter.fromAddress)) {
                  const childAddresses =
                    await params.syncStore.getChildAddresses({
                      factory: filter.fromAddress,
                    });

                  initialChildAddresses.set(filter.fromAddress, childAddresses);
                }

                if (isAddressFactory(filter.toAddress)) {
                  const childAddresses =
                    await params.syncStore.getChildAddresses({
                      factory: filter.toAddress,
                    });

                  initialChildAddresses.set(filter.toAddress, childAddresses);
                }

                break;
            }
          }

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
            initialChildAddresses,
            onEvent: realtimeMutex(async (event) => {
              try {
                await perChainOnRealtimeSyncEvent(event);
                // Note: `promise` resolves when the event is fully processed, however,
                // awaiting it will cause a deadlock in "omnichain" ordering.
                const promise = onRealtimeSyncEvent(event, {
                  chain,
                  sources,
                  syncProgress,
                  realtimeSync,
                });

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
                  rpc.unsubscribe();
                }

                return { promise };
              } catch (error) {
                params.common.logger.error({
                  service: "sync",
                  msg: `Fatal error: Unable to process ${event.type} event`,
                  error: error as Error,
                });
                params.onFatalError(error as Error);
                return { promise: Promise.resolve() };
              }
            }),
            onFatalError: params.onFatalError,
          });

          perChainSync.get(chain)!.realtimeSync = realtimeSync;

          let childCount = 0;
          for (const [, childAddresses] of initialChildAddresses) {
            childCount += childAddresses.size;
          }

          params.common.logger.debug({
            service: "sync",
            msg: `Initialized '${chain.name}' realtime sync with ${childCount} factory child addresses`,
          });

          rpc.subscribe({
            onBlock: async (block) => {
              const arrivalMs = Date.now();

              const endClock = startClock();
              const syncResult = await realtimeSync.sync(block);

              if (syncResult.type === "accepted") {
                syncResult.blockPromise.then(() => {
                  params.common.metrics.ponder_realtime_block_arrival_latency.observe(
                    { chain: chain.name },
                    arrivalMs - hexToNumber(block.timestamp) * 1_000,
                  );

                  params.common.metrics.ponder_realtime_latency.observe(
                    { chain: chain.name },
                    endClock(),
                  );
                });
              }

              return syncResult;
            },
            onError: (error) => {
              realtimeSync.onError(error);
            },
          });
        }
      }
    },
    seconds,
    getStartCheckpoint(chain) {
      return getMultichainCheckpoint({ tag: "start", chain });
    },
    getFinalizedCheckpoint(chain) {
      return getMultichainCheckpoint({ tag: "finalized", chain });
    },
  };
};

export const getPerChainOnRealtimeSyncEvent = ({
  common,
  chain,
  sources,
  syncStore,
  syncProgress,
}: {
  common: Common;
  chain: Chain;
  sources: Source[];
  syncStore: SyncStore;
  syncProgress: SyncProgress;
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
                block,
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
    const initialChildAddresses = new Map<Factory, Map<Address, number>>();

    for (const filter of params.sources.map(({ filter }) => filter)) {
      switch (filter.type) {
        case "log":
          if (isAddressFactory(filter.address)) {
            const childAddresses = await params.syncStore.getChildAddresses({
              factory: filter.address,
            });

            initialChildAddresses.set(filter.address, childAddresses);
          }
          break;

        case "transaction":
        case "transfer":
        case "trace":
          if (isAddressFactory(filter.fromAddress)) {
            const childAddresses = await params.syncStore.getChildAddresses({
              factory: filter.fromAddress,
            });

            initialChildAddresses.set(filter.fromAddress, childAddresses);
          }

          if (isAddressFactory(filter.toAddress)) {
            const childAddresses = await params.syncStore.getChildAddresses({
              factory: filter.toAddress,
            });

            initialChildAddresses.set(filter.toAddress, childAddresses);
          }

          break;
      }
    }

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
          childAddresses: initialChildAddresses,
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
        hexToNumber(syncProgress.current!.number),
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
