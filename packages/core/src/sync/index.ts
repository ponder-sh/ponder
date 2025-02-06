import type { Common } from "@/internal/common.js";
import type {
  Factory,
  Filter,
  IndexingBuild,
  Network,
  RawEvent,
  Seconds,
  Source,
  Status,
} from "@/internal/types.js";
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
import type { LightBlock, SyncBlock } from "@/types/sync.js";
import {
  type Checkpoint,
  MAX_CHECKPOINT,
  ZERO_CHECKPOINT,
  ZERO_CHECKPOINT_STRING,
  decodeCheckpoint,
  encodeCheckpoint,
  min,
} from "@/utils/checkpoint.js";
import { estimate } from "@/utils/estimate.js";
import { formatPercentage } from "@/utils/format.js";
import {
  bufferAsyncGenerator,
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
import type { RequestQueue } from "@/utils/requestQueue.js";
import { _eth_getBlockByNumber } from "@/utils/rpc.js";
import { startClock } from "@/utils/timer.js";
import { zipperMany } from "@/utils/zipper.js";
import { type Address, type Hash, hexToBigInt, hexToNumber, toHex } from "viem";
import { buildEvents } from "./events.js";
import { isAddressFactory } from "./filter.js";

export type Sync = {
  getEvents(): AsyncGenerator<RawEvent[]>;
  startRealtime(): Promise<void>;
  getStatus(): Status;
  seconds: Seconds;
  getFinalizedCheckpoint(): string;
};

export type RealtimeEvent =
  | {
      type: "block";
      checkpoint: string;
      status: Status;
      events: RawEvent[];
      network: Network;
    }
  | {
      type: "reorg";
      checkpoint: string;
      network: Network;
    }
  | {
      type: "finalize";
      checkpoint: string;
      network: Network;
    };

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
    blockTimestamp: hexToNumber(block.timestamp),
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
  events: RawEvent[],
): { checkpoint: string; events: RawEvent[] }[] => {
  let hash: Hash | undefined;
  const result: { checkpoint: string; events: RawEvent[] }[] = [];

  for (const event of events) {
    if (hash === undefined || hash !== event.block.hash) {
      result.push({
        checkpoint: encodeCheckpoint({
          ...MAX_CHECKPOINT,
          blockTimestamp: Number(event.block.timestamp),
          chainId: BigInt(event.chainId),
          blockNumber: event.block.number,
        }),
        events: [],
      });
      hash = event.block.hash;
    }

    result[result.length - 1]!.events.push(event);
  }

  return result;
};

/** Returns the checkpoint for a given block tag. */
export const getChainCheckpoint = ({
  syncProgress,
  network,
  tag,
}: {
  syncProgress: SyncProgress;
  network: Network;
  tag: "start" | "current" | "finalized" | "end";
}): string | undefined => {
  if (tag === "end" && syncProgress.end === undefined) {
    return undefined;
  }

  if (tag === "current" && isSyncEnd(syncProgress)) {
    return undefined;
  }

  const block = syncProgress[tag]!;
  return encodeCheckpoint(
    blockToCheckpoint(
      block,
      network.chainId,
      // The checkpoint returned by this function is meant to be used in
      // a closed interval (includes endpoints), so "start" should be inclusive.
      tag === "start" ? "down" : "up",
    ),
  );
};

export const createSync = async (params: {
  common: Common;
  indexingBuild: Pick<IndexingBuild, "sources" | "networks">;
  requestQueues: RequestQueue[];
  syncStore: SyncStore;
  onRealtimeEvent(event: RealtimeEvent): Promise<void>;
  onFatalError(error: Error): void;
  initialCheckpoint: string;
  ordering: "omnichain" | "multichain";
}): Promise<Sync> => {
  const perNetworkSync = new Map<
    Network,
    {
      syncProgress: SyncProgress;
      historicalSync: HistoricalSync;
      realtimeSync: RealtimeSync;
    }
  >();

  const getMultichainCheckpoint = ({
    tag,
    network,
  }: { tag: "start" | "end" | "current" | "finalized"; network: Network }):
    | string
    | undefined => {
    const syncProgress = perNetworkSync.get(network)!.syncProgress;
    return getChainCheckpoint({ syncProgress, network, tag });
  };

  const getOmnichainCheckpoint = ({
    tag,
  }: { tag: "start" | "end" | "current" | "finalized" }):
    | string
    | undefined => {
    const checkpoints = Array.from(perNetworkSync.entries()).map(
      ([network, { syncProgress }]) =>
        getChainCheckpoint({ syncProgress, network, tag }),
    );

    if (tag === "end" && checkpoints.some((c) => c === undefined)) {
      return undefined;
    }

    if (tag === "current" && checkpoints.every((c) => c === undefined)) {
      return undefined;
    }

    return min(...checkpoints);
  };

  const updateHistoricalStatus = ({
    events,
    checkpoint,
    network,
  }: { events: RawEvent[]; checkpoint: string; network: Network }) => {
    if (Number(decodeCheckpoint(checkpoint).chainId) === network.chainId) {
      status[network.name]!.block = {
        timestamp: decodeCheckpoint(checkpoint).blockTimestamp,
        number: Number(decodeCheckpoint(checkpoint).blockNumber),
      };
      return;
    }

    let i = events.length - 1;
    while (i >= 0) {
      const event = events[i]!;

      if (network.chainId === event.chainId) {
        status[network.name]!.block = {
          timestamp: decodeCheckpoint(event.checkpoint).blockTimestamp,
          number: Number(decodeCheckpoint(event.checkpoint).blockNumber),
        };
        return;
      }

      i--;
    }
  };

  const updateRealtimeStatus = ({
    checkpoint,
    network,
  }: { checkpoint: string; network: Network }) => {
    const localBlock = perNetworkSync
      .get(network)!
      .realtimeSync.unfinalizedBlocks.findLast(
        (block) =>
          encodeCheckpoint(blockToCheckpoint(block, network.chainId, "up")) <=
          checkpoint,
      );
    if (localBlock !== undefined) {
      status[network.name]!.block = {
        timestamp: hexToNumber(localBlock.timestamp),
        number: hexToNumber(localBlock.number),
      };
    }
  };

  async function* getEvents() {
    let cursor =
      params.initialCheckpoint !== ZERO_CHECKPOINT_STRING
        ? params.initialCheckpoint
        : getOmnichainCheckpoint({ tag: "start" })!;

    const to = min(
      getOmnichainCheckpoint({ tag: "end" }),
      getOmnichainCheckpoint({ tag: "finalized" }),
    );

    const eventGenerators = Array.from(perNetworkSync.entries()).map(
      ([network, { syncProgress, historicalSync }]) => {
        const sources = params.indexingBuild.sources.filter(
          ({ filter }) => filter.chainId === network.chainId,
        );

        const localSyncGenerator = getLocalSyncGenerator({
          common: params.common,
          network,
          syncProgress,
          historicalSync,
        });

        const localEventGenerator = getLocalEventGenerator({
          common: params.common,
          network,
          syncStore: params.syncStore,
          sources,
          localSyncGenerator,
          from:
            params.initialCheckpoint !== ZERO_CHECKPOINT_STRING
              ? params.initialCheckpoint
              : getChainCheckpoint({ syncProgress, network, tag: "start" })!,
          to,
          limit: Math.round(
            params.common.options.syncEventsQuerySize /
              (params.indexingBuild.networks.length * 2),
          ),
        });

        return bufferAsyncGenerator(localEventGenerator, 1);
      },
    );

    const mergeAsync =
      params.ordering === "multichain"
        ? mergeAsyncGenerators
        : mergeAsyncGeneratorsWithEventOrder;

    for await (const { events, checkpoint } of mergeAsync(eventGenerators)) {
      if (params.ordering === "multichain") {
        const network = params.indexingBuild.networks.find(
          (network) =>
            network.chainId === Number(decodeCheckpoint(checkpoint).chainId),
        )!;
        params.common.logger.debug({
          service: "sync",
          msg: `Sequenced ${events.length} '${network.name}' events for timestamp range [${decodeCheckpoint(cursor).blockTimestamp}, ${decodeCheckpoint(checkpoint).blockTimestamp}]`,
        });
      } else {
        params.common.logger.debug({
          service: "sync",
          msg: `Sequenced ${events.length} events for timestamp range [${decodeCheckpoint(cursor).blockTimestamp}, ${decodeCheckpoint(checkpoint).blockTimestamp}]`,
        });
      }

      for (const network of params.indexingBuild.networks) {
        updateHistoricalStatus({ events, checkpoint, network });
      }
      yield events;
      cursor = checkpoint;
    }
  }

  /** Events that have been executed but not finalized. */
  let executedEvents: RawEvent[] = [];
  /** Events that have not been executed. */
  let pendingEvents: RawEvent[] = [];

  const realtimeMutex = createMutex();

  const checkpoints = {
    // Note: `checkpoints.current` not used in multichain ordering
    current: ZERO_CHECKPOINT_STRING,
    finalized: ZERO_CHECKPOINT_STRING,
  };

  // Note: `latencyTimers` not used in multichain ordering
  const latencyTimers = new Map<string, () => number>();

  const onRealtimeSyncEvent = (
    event: RealtimeSyncEvent,
    {
      network,
      syncProgress,
      realtimeSync,
    }: {
      network: Network;
      syncProgress: SyncProgress;
      realtimeSync: RealtimeSync;
    },
  ): void => {
    switch (event.type) {
      case "block": {
        const events = buildEvents({
          sources: params.indexingBuild.sources,
          chainId: network.chainId,
          blockWithEventData: event,
          finalizedChildAddresses: realtimeSync.finalizedChildAddresses,
          unfinalizedChildAddresses: realtimeSync.unfinalizedChildAddresses,
        });

        params.common.logger.debug({
          service: "sync",
          msg: `Extracted ${events.length} '${network.name}' events for block ${hexToNumber(event.block.number)}`,
        });

        if (params.ordering === "multichain") {
          // Note: `checkpoints.current` not used in multichain ordering
          const checkpoint = getMultichainCheckpoint({
            tag: "current",
            network,
          })!;

          status[network.name]!.block = {
            timestamp: hexToNumber(event.block.timestamp),
            number: hexToNumber(event.block.number),
          };

          const readyEvents = events.concat(pendingEvents);
          pendingEvents = [];
          executedEvents = executedEvents.concat(readyEvents);

          params.common.logger.debug({
            service: "sync",
            msg: `Sequenced ${readyEvents.length} '${network.name}' events for block ${hexToNumber(event.block.number)}`,
          });

          params
            .onRealtimeEvent({
              type: "block",
              checkpoint,
              status: structuredClone(status),
              events: readyEvents.sort((a, b) =>
                a.checkpoint < b.checkpoint ? -1 : 1,
              ),
              network,
            })
            .then(() => {
              // update `ponder_realtime_latency` metric
              if (event.endClock) {
                params.common.metrics.ponder_realtime_latency.observe(
                  { network: network.name },
                  event.endClock(),
                );
              }
            });
        } else {
          const from = checkpoints.current;
          checkpoints.current = getOmnichainCheckpoint({ tag: "current" })!;
          const to = getOmnichainCheckpoint({ tag: "current" })!;

          if (event.endClock !== undefined) {
            latencyTimers.set(
              encodeCheckpoint(
                blockToCheckpoint(event.block, network.chainId, "up"),
              ),
              event.endClock,
            );
          }

          if (to > from) {
            for (const network of params.indexingBuild.networks) {
              updateRealtimeStatus({ checkpoint: to, network });
            }

            // Move ready events from pending to executed

            const readyEvents = pendingEvents
              .concat(events)
              .filter(({ checkpoint }) => checkpoint < to);
            pendingEvents = pendingEvents
              .concat(events)
              .filter(({ checkpoint }) => checkpoint > to);
            executedEvents = executedEvents.concat(readyEvents);

            params.common.logger.debug({
              service: "sync",
              msg: `Sequenced ${readyEvents.length} '${network.name}' events for timestamp range [${decodeCheckpoint(from).blockTimestamp}, ${decodeCheckpoint(to).blockTimestamp}]`,
            });

            params
              .onRealtimeEvent({
                type: "block",
                checkpoint: to,
                status: structuredClone(status),
                events: readyEvents.sort((a, b) =>
                  a.checkpoint < b.checkpoint ? -1 : 1,
                ),
                network,
              })
              .then(() => {
                // update `ponder_realtime_latency` metric
                for (const [checkpoint, timer] of latencyTimers) {
                  if (checkpoint > from && checkpoint <= to) {
                    const chainId = Number(
                      decodeCheckpoint(checkpoint).chainId,
                    );
                    const network = params.indexingBuild.networks.find(
                      (network) => network.chainId === chainId,
                    )!;
                    params.common.metrics.ponder_realtime_latency.observe(
                      { network: network.name },
                      timer(),
                    );
                  }
                }
              });
          } else {
            pendingEvents = pendingEvents.concat(events);
          }
        }

        break;
      }

      case "finalize": {
        const from = checkpoints.finalized;
        checkpoints.finalized = getOmnichainCheckpoint({ tag: "finalized" })!;
        const to = getOmnichainCheckpoint({ tag: "finalized" })!;

        if (
          params.ordering === "omnichain" &&
          getChainCheckpoint({ syncProgress, network, tag: "finalized" })! >
            getOmnichainCheckpoint({ tag: "current" })!
        ) {
          params.common.logger.warn({
            service: "sync",
            msg: `Finalized '${network.name}' block has surpassed overall indexing checkpoint`,
          });
        }

        // Remove all finalized data

        executedEvents = executedEvents.filter((e) => e.checkpoint > to);

        // Raise event to parent function (runtime)
        if (to > from) {
          params.onRealtimeEvent({
            type: "finalize",
            checkpoint: to,
            network,
          });
        }

        break;
      }

      case "reorg": {
        // Remove all reorged data

        let reorgedEvents = 0;

        const isReorgedEvent = ({ chainId, block }: RawEvent) => {
          if (
            chainId === network.chainId &&
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

        params.common.logger.debug({
          service: "sync",
          msg: `Removed ${reorgedEvents} reorged '${network.name}' events`,
        });

        if (params.ordering === "multichain") {
          // Note: `checkpoints.current` not used in multichain ordering
          const checkpoint = getMultichainCheckpoint({
            tag: "current",
            network,
          })!;

          // Move events from executed to pending

          const events = executedEvents.filter(
            (e) => e.checkpoint > checkpoint,
          );
          executedEvents = executedEvents.filter(
            (e) => e.checkpoint < checkpoint,
          );
          pendingEvents = pendingEvents.concat(events);

          params.common.logger.debug({
            service: "sync",
            msg: `Rescheduled ${events.length} reorged events`,
          });

          params.onRealtimeEvent({ type: "reorg", checkpoint, network });
        } else {
          const from = checkpoints.current;
          checkpoints.current = getOmnichainCheckpoint({ tag: "current" })!;
          const to = getOmnichainCheckpoint({ tag: "current" })!;

          // Move events from executed to pending

          const events = executedEvents.filter((e) => e.checkpoint > to);
          executedEvents = executedEvents.filter((e) => e.checkpoint < to);
          pendingEvents = pendingEvents.concat(events);

          params.common.logger.debug({
            service: "sync",
            msg: `Rescheduled ${events.length} reorged events`,
          });

          if (to < from) {
            params.onRealtimeEvent({
              type: "reorg",
              checkpoint: to,
              network,
            });
          }
        }

        break;
      }

      default:
        never(event);
    }
  };

  await Promise.all(
    params.indexingBuild.networks.map(async (network, index) => {
      const requestQueue = params.requestQueues[index]!;

      const sources = params.indexingBuild.sources.filter(
        ({ filter }) => filter.chainId === network.chainId,
      );

      // Invalidate sync cache for devnet sources
      if (network.disableCache) {
        params.common.logger.warn({
          service: "sync",
          msg: `Deleting cache records for '${network.name}'`,
        });

        await params.syncStore.pruneByChain({
          chainId: network.chainId,
        });
      }

      const historicalSync = await createHistoricalSync({
        common: params.common,
        sources,
        syncStore: params.syncStore,
        requestQueue,
        network,
        onFatalError: params.onFatalError,
      });

      const syncProgress = await getLocalSyncProgress({
        common: params.common,
        network,
        sources,
        requestQueue,
        intervalsCache: historicalSync.intervalsCache,
      });

      const realtimeSync = createRealtimeSync({
        common: params.common,
        sources,
        requestQueue,
        network,
        onEvent: realtimeMutex((event) =>
          perChainOnRealtimeSyncEvent(event)
            .then((event) => {
              onRealtimeSyncEvent(event, {
                network,
                syncProgress,
                realtimeSync,
              });

              if (isSyncFinalized(syncProgress) && isSyncEnd(syncProgress)) {
                // The realtime service can be killed if `endBlock` is
                // defined has become finalized.

                params.common.metrics.ponder_sync_is_realtime.set(
                  { network: network.name },
                  0,
                );
                params.common.metrics.ponder_sync_is_complete.set(
                  { network: network.name },
                  1,
                );
                params.common.logger.info({
                  service: "sync",
                  msg: `Killing '${network.name}' live indexing because the end block ${hexToNumber(syncProgress.end!.number)} has been finalized`,
                });
                realtimeSync.kill();
              }
            })
            .catch((error) => {
              params.common.logger.error({
                service: "sync",
                msg: `Fatal error: Unable to process ${event.type} event`,
                error,
              });
              params.onFatalError(error);
            }),
        ),
        onFatalError: params.onFatalError,
      });

      params.common.metrics.ponder_sync_is_realtime.set(
        { network: network.name },
        0,
      );
      params.common.metrics.ponder_sync_is_complete.set(
        { network: network.name },
        0,
      );

      perNetworkSync.set(network, {
        syncProgress,
        historicalSync,
        realtimeSync,
      });

      const perChainOnRealtimeSyncEvent = getPerChainOnRealtimeSyncEvent({
        common: params.common,
        network,
        sources,
        syncStore: params.syncStore,
        syncProgress,
      });
    }),
  );

  const status: Status = {};
  const seconds: Seconds = {};

  for (const network of params.indexingBuild.networks) {
    status[network.name] = { block: null, ready: false };
  }

  if (params.ordering === "multichain") {
    for (const network of params.indexingBuild.networks) {
      seconds[network.name] = {
        start: decodeCheckpoint(
          getMultichainCheckpoint({ tag: "start", network })!,
        ).blockTimestamp,
        end: decodeCheckpoint(
          min(
            getOmnichainCheckpoint({ tag: "end" }),
            getOmnichainCheckpoint({ tag: "finalized" }),
          ),
        ).blockTimestamp,
        cached: decodeCheckpoint(params.initialCheckpoint).blockTimestamp,
      };
    }
  } else {
    for (const network of params.indexingBuild.networks) {
      seconds[network.name] = {
        start: decodeCheckpoint(getOmnichainCheckpoint({ tag: "start" })!)
          .blockTimestamp,
        end: decodeCheckpoint(
          min(
            getOmnichainCheckpoint({ tag: "end" }),
            getOmnichainCheckpoint({ tag: "finalized" }),
          ),
        ).blockTimestamp,
        cached: decodeCheckpoint(params.initialCheckpoint).blockTimestamp,
      };
    }
  }

  return {
    getEvents,
    async startRealtime() {
      for (const network of params.indexingBuild.networks) {
        const { syncProgress, realtimeSync } = perNetworkSync.get(network)!;

        const filters = params.indexingBuild.sources
          .filter(({ filter }) => filter.chainId === network.chainId)
          .map(({ filter }) => filter);

        status[network.name]!.block = {
          number: hexToNumber(syncProgress.current!.number),
          timestamp: hexToNumber(syncProgress.current!.timestamp),
        };
        status[network.name]!.ready = true;

        // Fetch any events between the omnichain finalized checkpoint and the single-chain
        // finalized checkpoint and add them to pendingEvents. These events are synced during
        // the historical phase, but must be indexed in the realtime phase because events
        // synced in realtime on other chains might be ordered before them.
        const from = getOmnichainCheckpoint({ tag: "finalized" })!;

        const finalized = getChainCheckpoint({
          syncProgress,
          network,
          tag: "finalized",
        })!;
        const end = getChainCheckpoint({
          syncProgress,
          network,
          tag: "end",
        })!;
        const to = min(finalized, end);

        if (to > from) {
          const events = await params.syncStore.getEvents({
            filters,
            from,
            to,
          });

          params.common.logger.debug({
            service: "sync",
            msg: `Extracted and scheduled ${events.events.length} '${network.name}' events`,
          });

          pendingEvents = pendingEvents.concat(events.events);
        }

        if (isSyncEnd(syncProgress)) {
          params.common.metrics.ponder_sync_is_complete.set(
            { network: network.name },
            1,
          );
        } else {
          params.common.metrics.ponder_sync_is_realtime.set(
            { network: network.name },
            1,
          );

          const initialChildAddresses = new Map<Factory, Set<Address>>();

          for (const filter of filters) {
            switch (filter.type) {
              case "log":
                if (isAddressFactory(filter.address)) {
                  const addresses = await params.syncStore.getChildAddresses({
                    filter: filter.address,
                  });

                  initialChildAddresses.set(filter.address, new Set(addresses));
                }
                break;

              case "transaction":
              case "transfer":
              case "trace":
                if (isAddressFactory(filter.fromAddress)) {
                  const addresses = await params.syncStore.getChildAddresses({
                    filter: filter.fromAddress,
                  });

                  initialChildAddresses.set(
                    filter.fromAddress,
                    new Set(addresses),
                  );
                }

                if (isAddressFactory(filter.toAddress)) {
                  const addresses = await params.syncStore.getChildAddresses({
                    filter: filter.toAddress,
                  });

                  initialChildAddresses.set(
                    filter.toAddress,
                    new Set(addresses),
                  );
                }

                break;
            }
          }

          params.common.logger.debug({
            service: "sync",
            msg: `Initialized '${network.name}' realtime sync with ${initialChildAddresses.size} factory child addresses`,
          });

          realtimeSync.start({ syncProgress, initialChildAddresses });
        }
      }
    },
    getStatus() {
      return status;
    },
    seconds,
    getFinalizedCheckpoint() {
      return getOmnichainCheckpoint({ tag: "finalized" })!;
    },
  };
};

export const getPerChainOnRealtimeSyncEvent = ({
  common,
  network,
  sources,
  syncStore,
  syncProgress,
}: {
  common: Common;
  network: Network;
  sources: Source[];
  syncStore: SyncStore;
  syncProgress: SyncProgress;
}) => {
  let unfinalizedBlocks: Omit<
    Extract<RealtimeSyncEvent, { type: "block" }>,
    "type"
  >[] = [];

  return async (event: RealtimeSyncEvent): Promise<RealtimeSyncEvent> => {
    switch (event.type) {
      case "block": {
        syncProgress.current = event.block;

        common.logger.debug({
          service: "sync",
          msg: `Updated '${network.name}' current block to ${hexToNumber(event.block.number)}`,
        });

        common.metrics.ponder_sync_block.set(
          { network: network.name },
          hexToNumber(syncProgress.current.number),
        );

        unfinalizedBlocks.push(event);

        return event;
      }

      case "finalize": {
        const finalizedInterval = [
          hexToNumber(syncProgress.finalized.number),
          hexToNumber(event.block.number),
        ] satisfies Interval;

        syncProgress.finalized = event.block;

        common.logger.debug({
          service: "sync",
          msg: `Updated '${network.name}' finalized block to ${hexToNumber(event.block.number)}`,
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

        await Promise.all([
          syncStore.insertBlocks({
            blocks: finalizedBlocks
              .filter(({ hasMatchedFilter }) => hasMatchedFilter)
              .map(({ block }) => block),
            chainId: network.chainId,
          }),
          syncStore.insertLogs({
            logs: finalizedBlocks.flatMap(({ logs, block }) =>
              logs.map((log) => ({ log, block })),
            ),
            shouldUpdateCheckpoint: true,
            chainId: network.chainId,
          }),
          syncStore.insertLogs({
            logs: finalizedBlocks.flatMap(({ factoryLogs }) =>
              factoryLogs.map((log) => ({ log })),
            ),
            shouldUpdateCheckpoint: false,
            chainId: network.chainId,
          }),
          syncStore.insertTransactions({
            transactions: finalizedBlocks.flatMap(({ transactions, block }) =>
              transactions.map((transaction) => ({
                transaction,
                block,
              })),
            ),
            chainId: network.chainId,
          }),
          syncStore.insertTransactionReceipts({
            transactionReceipts: finalizedBlocks.flatMap(
              ({ transactionReceipts }) => transactionReceipts,
            ),
            chainId: network.chainId,
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
            chainId: network.chainId,
          }),
        ]);

        // Add corresponding intervals to the sync-store
        // Note: this should happen after insertion so the database doesn't become corrupted

        if (network.disableCache === false) {
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
            chainId: network.chainId,
          });
        }

        return event;
      }

      case "reorg": {
        syncProgress.current = event.block;

        common.logger.debug({
          service: "sync",
          msg: `Updated '${network.name}' current block to ${hexToNumber(event.block.number)}`,
        });

        common.metrics.ponder_sync_block.set(
          { network: network.name },
          hexToNumber(syncProgress.current.number),
        );

        // Remove all reorged data

        unfinalizedBlocks = unfinalizedBlocks.filter(
          ({ block }) =>
            hexToNumber(block.number) <= hexToNumber(event.block.number),
        );

        await syncStore.pruneRpcRequestResult({
          chainId: network.chainId,
          blocks: event.reorgedBlocks,
        });

        return event;
      }
    }
  };
};

export async function* getLocalEventGenerator(params: {
  common: Common;
  network: Network;
  syncStore: SyncStore;
  sources: Source[];
  localSyncGenerator: AsyncGenerator<string>;
  from: string;
  to: string;
  limit: number;
}): AsyncGenerator<{ events: RawEvent[]; checkpoint: string }> {
  let cursor = params.from;
  // Estimate optimal range (seconds) to query at a time, eventually
  // used to determine `to` passed to `getEvents`.
  let estimateSeconds = 1_000;

  params.common.logger.debug({
    service: "sync",
    msg: `Initialized '${params.network.name}' extract query for timestamp range [${decodeCheckpoint(params.from).blockTimestamp}, ${decodeCheckpoint(params.to).blockTimestamp}]`,
  });

  for await (const syncCheckpoint of bufferAsyncGenerator(
    params.localSyncGenerator,
    Number.POSITIVE_INFINITY,
  )) {
    let consecutiveErrors = 0;
    while (cursor < min(syncCheckpoint, params.to)) {
      const estimateCheckpoint = encodeCheckpoint({
        ...ZERO_CHECKPOINT,
        chainId: BigInt(params.network.chainId),
        blockTimestamp: Math.min(
          decodeCheckpoint(cursor).blockTimestamp + estimateSeconds,
          MAX_CHECKPOINT.blockTimestamp,
        ),
      });
      const to = min(syncCheckpoint, estimateCheckpoint, params.to);
      try {
        const { events, cursor: queryCursor } =
          await params.syncStore.getEvents({
            filters: params.sources.map(({ filter }) => filter),
            from: cursor,
            to,
            limit: params.limit,
          });

        params.common.logger.debug({
          service: "sync",
          msg: `Extracted ${events.length} '${params.network.name}' events for timestamp range [${decodeCheckpoint(cursor).blockTimestamp}, ${decodeCheckpoint(queryCursor).blockTimestamp}]`,
        });

        estimateSeconds = estimate({
          from: decodeCheckpoint(cursor).blockTimestamp,
          to: decodeCheckpoint(queryCursor).blockTimestamp,
          target: params.limit,
          result: events.length,
          min: 10,
          max: 86_400,
          prev: estimateSeconds,
          maxIncrease: 1.08,
        });

        params.common.logger.debug({
          service: "sync",
          msg: `Updated '${params.network.name}' extract query estimate to ${estimateSeconds} seconds`,
        });

        consecutiveErrors = 0;
        cursor = queryCursor;
        yield { events, checkpoint: cursor };
      } catch (error) {
        params.common.logger.warn({
          service: "sync",
          msg: `Failed '${params.network.name}' extract query for timestamp range [${decodeCheckpoint(cursor).blockTimestamp}, ${decodeCheckpoint(to).blockTimestamp}]`,
          error: error as Error,
        });

        // Handle errors by reducing the requested range by 10x
        estimateSeconds = Math.max(10, Math.round(estimateSeconds / 10));

        params.common.logger.debug({
          service: "sync",
          msg: `Updated '${params.network.name}' getEvents query estimate to ${estimateSeconds} seconds`,
        });

        if (++consecutiveErrors > 4) throw error;
      }
    }
  }
}

export async function* getLocalSyncGenerator({
  common,
  network,
  syncProgress,
  historicalSync,
}: {
  common: Common;
  network: Network;
  syncProgress: SyncProgress;
  historicalSync: HistoricalSync;
}): AsyncGenerator<string> {
  const label = { network: network.name };

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
      msg: `Skipped '${network.name}' historical sync because the start block is unfinalized`,
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
    msg: `Initialized '${network.name}' historical sync for block range [${totalInterval[0]}, ${totalInterval[1]}]`,
  });

  const requiredIntervals = Array.from(
    historicalSync.intervalsCache.entries(),
  ).flatMap(([filter, fragmentIntervals]) =>
    intervalDifference(
      [
        [
          filter.fromBlock ?? 0,
          Math.min(
            filter.toBlock ?? Number.POSITIVE_INFINITY,
            totalInterval[1],
          ),
        ],
      ],
      intervalIntersectionMany(
        fragmentIntervals.map(({ intervals }) => intervals),
      ),
    ),
  );

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
    yield encodeCheckpoint(
      blockToCheckpoint(syncProgress.current, network.chainId, "up"),
    );

    if (hexToNumber(syncProgress.current.number) === hexToNumber(last.number)) {
      common.logger.info({
        service: "sync",
        msg: `Skipped '${network.name}' historical sync because all blocks are cached`,
      });
      return;
    } else {
      common.logger.info({
        service: "sync",
        msg: `Started '${network.name}' historical sync with ${formatPercentage(
          (total - required) / total,
        )} cached`,
      });
    }

    cursor = hexToNumber(syncProgress.current.number) + 1;
  } else {
    common.logger.info({
      service: "historical",
      msg: `Started '${network.name}' historical sync with 0% cached`,
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
      msg: `Synced ${interval[1] - interval[0] + 1} '${network.name}' blocks in range [${interval[0]}, ${interval[1]}]`,
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

      common.logger.debug({
        service: "sync",
        msg: `Updated '${network.name}' historical sync estimate to ${estimateRange} blocks`,
      });
    }

    yield encodeCheckpoint(
      blockToCheckpoint(syncProgress.current!, network.chainId, "up"),
    );

    if (isSyncEnd(syncProgress) || isSyncFinalized(syncProgress)) {
      common.logger.info({
        service: "sync",
        msg: `Completed '${network.name}' historical sync`,
      });
      return;
    }
  }
}

export const getLocalSyncProgress = async ({
  common,
  sources,
  network,
  requestQueue,
  intervalsCache,
}: {
  common: Common;
  sources: Source[];
  network: Network;
  requestQueue: RequestQueue;
  intervalsCache: HistoricalSync["intervalsCache"];
}): Promise<SyncProgress> => {
  const syncProgress = {} as SyncProgress;
  const filters = sources.map(({ filter }) => filter);

  // Earliest `fromBlock` among all `filters`
  const start = Math.min(...filters.map((filter) => filter.fromBlock ?? 0));
  const cached = getCachedBlock({ filters, intervalsCache });

  const diagnostics = await Promise.all(
    cached === undefined
      ? [
          requestQueue.request({ method: "eth_chainId" }),
          _eth_getBlockByNumber(requestQueue, { blockTag: "latest" }),
          _eth_getBlockByNumber(requestQueue, { blockNumber: start }),
        ]
      : [
          requestQueue.request({ method: "eth_chainId" }),
          _eth_getBlockByNumber(requestQueue, { blockTag: "latest" }),
          _eth_getBlockByNumber(requestQueue, { blockNumber: start }),
          _eth_getBlockByNumber(requestQueue, { blockNumber: cached }),
        ],
  );

  const finalized = Math.max(
    0,
    hexToNumber(diagnostics[1].number) - network.finalityBlockCount,
  );
  syncProgress.finalized = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: finalized,
  });
  syncProgress.start = diagnostics[2];
  if (diagnostics.length === 4) {
    syncProgress.current = diagnostics[3];
  }

  // Warn if the config has a different chainId than the remote.
  if (hexToNumber(diagnostics[0]) !== network.chainId) {
    common.logger.warn({
      service: "sync",
      msg: `Remote chain ID (${diagnostics[0]}) does not match configured chain ID (${network.chainId}) for network "${network.name}"`,
    });
  }

  if (filters.some((filter) => filter.toBlock === undefined)) {
    return syncProgress;
  }

  // Latest `toBlock` among all `filters`
  const end = Math.max(...filters.map((filter) => filter.toBlock!));

  if (end > hexToNumber(diagnostics[1].number)) {
    syncProgress.end = {
      number: toHex(end),
      hash: "0x",
      parentHash: "0x",
      timestamp: toHex(MAX_CHECKPOINT.blockTimestamp),
    } satisfies LightBlock;
  } else {
    syncProgress.end = await _eth_getBlockByNumber(requestQueue, {
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
  generators: AsyncGenerator<{ events: RawEvent[]; checkpoint: string }>[],
): AsyncGenerator<{ events: RawEvent[]; checkpoint: string }> {
  const results = await Promise.all(generators.map((gen) => gen.next()));

  while (results.some((res) => res.done !== true)) {
    const supremum = min(
      ...results.map((res) => (res.done ? undefined : res.value.checkpoint)),
    );

    const eventArrays: RawEvent[][] = [];

    for (const result of results) {
      if (result.done === false) {
        const [left, right] = partition(
          result.value.events,
          (event) => event.checkpoint <= supremum,
        );

        eventArrays.push(left);
        result.value.events = right;
      }
    }

    const events = zipperMany(eventArrays).sort((a, b) =>
      a.checkpoint < b.checkpoint ? -1 : 1,
    );

    const index = results.findIndex(
      (res) => res.done === false && res.value.checkpoint === supremum,
    );

    const resultPromise = generators[index]!.next();
    if (events.length > 0) {
      yield { events, checkpoint: supremum };
    }
    results[index] = await resultPromise;
  }
}
