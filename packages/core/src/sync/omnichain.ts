import type { Common } from "@/internal/common.js";
import type { Factory, Network, RawEvent, Status } from "@/internal/types.js";
import type { IndexingBuild } from "@/internal/types.js";
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
  ZERO_CHECKPOINT_STRING,
  decodeCheckpoint,
  encodeCheckpoint,
  min,
} from "@/utils/checkpoint.js";
import { bufferAsyncGenerator } from "@/utils/generators.js";
import { never } from "@/utils/never.js";
import { partition } from "@/utils/partition.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import { zipperMany } from "@/utils/zipper.js";
import { type Address, hexToNumber } from "viem";
import { buildEvents } from "./events.js";
import { isAddressFactory } from "./filter.js";
import {
  type Seconds,
  type Sync,
  type SyncProgress,
  blockToCheckpoint,
  getChainCheckpoint,
  getLocalEventGenerator,
  getLocalSyncGenerator,
  getLocalSyncProgress,
  getRealtimeSyncEventHandler,
  isSyncEnd,
} from "./index.js";
import type { RealtimeEvent } from "./index.js";

/**
 * Merges multiple event generators into a single generator while preserving
 * the order of events.
 *
 * @param generators - Generators to merge.
 * @returns A single generator that yields events from all generators.
 */
export async function* mergeEventGenerators(
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

export const createSyncOmnichain = async (params: {
  common: Common;
  indexingBuild: Pick<IndexingBuild, "sources" | "networks">;
  requestQueues: RequestQueue[];
  syncStore: SyncStore;
  onRealtimeEvent(event: RealtimeEvent): Promise<void>;
  onFatalError(error: Error): void;
  initialCheckpoint: string;
}): Promise<Sync> => {
  const perNetworkSync = new Map<
    Network,
    {
      syncProgress: SyncProgress;
      historicalSync: HistoricalSync;
      realtimeSync: RealtimeSync;
    }
  >();

  /** Returns the minimum checkpoint across all chains. */
  const getOmnichainCheckpoint = (
    tag: "start" | "end" | "current" | "finalized",
  ): string | undefined => {
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
      status[network.chainId]!.block = {
        timestamp: decodeCheckpoint(checkpoint).blockTimestamp,
        number: Number(decodeCheckpoint(checkpoint).blockNumber),
      };
    } else {
      let i = events.length - 1;
      while (i >= 0) {
        const event = events[i]!;

        if (network.chainId === event.chainId) {
          status[network.chainId]!.block = {
            timestamp: decodeCheckpoint(event.checkpoint).blockTimestamp,
            number: Number(decodeCheckpoint(event.checkpoint).blockNumber),
          };
        }

        i--;
      }
    }
  };

  const updateRealtimeStatus = ({
    checkpoint,
    network,
  }: {
    checkpoint: string;
    network: Network;
  }) => {
    const localBlock = perNetworkSync
      .get(network)!
      .realtimeSync.unfinalizedBlocks.findLast(
        (block) =>
          encodeCheckpoint(blockToCheckpoint(block, network.chainId, "up")) <=
          checkpoint,
      );
    if (localBlock !== undefined) {
      status[network.chainId]!.block = {
        timestamp: hexToNumber(localBlock.timestamp),
        number: hexToNumber(localBlock.number),
      };
    }
  };

  const getRealtimeSyncEventHandlerOmnichain = ({
    network,
    syncProgress,
    realtimeSync,
  }: {
    network: Network;
    syncProgress: SyncProgress;
    realtimeSync: RealtimeSync;
  }) => {
    const checkpoints = {
      current: ZERO_CHECKPOINT_STRING,
      finalized: ZERO_CHECKPOINT_STRING,
    };

    const latencyTimers = new Map<string, () => number>();

    return (event: RealtimeSyncEvent): void => {
      switch (event.type) {
        case "block": {
          const from = checkpoints.current;
          checkpoints.current = getOmnichainCheckpoint("current")!;
          const to = getOmnichainCheckpoint("current")!;

          if (event.endClock !== undefined) {
            latencyTimers.set(
              encodeCheckpoint(
                blockToCheckpoint(event.block, network.chainId, "up"),
              ),
              event.endClock,
            );
          }

          const newEvents = buildEvents({
            sources: params.indexingBuild.sources,
            chainId: network.chainId,
            blockWithEventData: event,
            finalizedChildAddresses: realtimeSync.finalizedChildAddresses,
            unfinalizedChildAddresses: realtimeSync.unfinalizedChildAddresses,
          });

          pendingEvents.push(...newEvents);

          if (to > from) {
            for (const network of params.indexingBuild.networks) {
              updateRealtimeStatus({ checkpoint: to, network });
            }

            seconds.end = decodeCheckpoint(to).blockTimestamp;

            // Move events from pending to executed

            const events = pendingEvents
              .filter((event) => event.checkpoint < to)
              .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));

            pendingEvents = pendingEvents.filter(
              ({ checkpoint }) => checkpoint > to,
            );
            executedEvents.push(...events);

            params
              .onRealtimeEvent({
                type: "block",
                checkpoint: to,
                status: structuredClone(status),
                events,
                network,
              })
              .then(() => {
                if (events.length > 0 && isKilled === false) {
                  params.common.logger.info({
                    service: "app",
                    msg: `Indexed ${events.length} events`,
                  });
                }

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
          }

          break;
        }

        case "finalize": {
          const prev = checkpoints.finalized;
          checkpoints.finalized = getOmnichainCheckpoint("finalized")!;
          const checkpoint = getOmnichainCheckpoint("finalized")!;

          if (
            getChainCheckpoint({ syncProgress, network, tag: "finalized" })! >
            getOmnichainCheckpoint("current")!
          ) {
            params.common.logger.warn({
              service: "sync",
              msg: `Finalized block for '${network.name}' has surpassed overall indexing checkpoint`,
            });
          }

          // Remove all finalized data

          executedEvents = executedEvents.filter(
            (e) => e.checkpoint > checkpoint,
          );

          // Raise event to parent function (runtime)
          if (checkpoint > prev) {
            params.onRealtimeEvent({
              type: "finalize",
              checkpoint,
              network,
            });
          }

          break;
        }

        case "reorg": {
          // Note: this checkpoint is <= the previous checkpoint
          checkpoints.current = getOmnichainCheckpoint("current")!;
          const checkpoint = getOmnichainCheckpoint("current")!;

          // Remove all reorged data

          const isReorgedEvent = ({ chainId, block }: RawEvent) =>
            chainId === network.chainId &&
            Number(block.number) > hexToNumber(event.block.number);

          pendingEvents = pendingEvents.filter(
            (e) => isReorgedEvent(e) === false,
          );
          executedEvents = executedEvents.filter(
            (e) => isReorgedEvent(e) === false,
          );

          // Move events from executed to pending

          const events = executedEvents.filter(
            (e) => e.checkpoint > checkpoint,
          );
          executedEvents = executedEvents.filter(
            (e) => e.checkpoint < checkpoint,
          );
          pendingEvents.push(...events);

          params.onRealtimeEvent({
            type: "reorg",
            checkpoint,
            network,
          });

          break;
        }

        default:
          never(event);
      }
    };
  };

  /** Events that have been executed but not finalized. */
  let executedEvents: RawEvent[] = [];
  /** Events that have not been executed yet. */
  let pendingEvents: RawEvent[] = [];

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
        onEvent: (event) =>
          // TODO(kyle) do we need a queue
          onRealtimeSyncEventBase(event)
            .then(onRealtimeSyncEventOmnichain)
            .catch((error) => {
              params.common.logger.error({
                service: "sync",
                msg: `Fatal error: Unable to process ${event.type} event`,
                error,
              });
              params.onFatalError(error);
            }),
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

      const onRealtimeSyncEventBase = getRealtimeSyncEventHandler({
        common: params.common,
        network,
        sources,
        syncStore: params.syncStore,
        syncProgress,
        realtimeSync,
      });

      perNetworkSync.set(network, {
        syncProgress,
        historicalSync,
        realtimeSync,
      });

      const onRealtimeSyncEventOmnichain = getRealtimeSyncEventHandlerOmnichain(
        { network, syncProgress, realtimeSync },
      );
    }),
  );

  const status: Status = {};

  for (const network of params.indexingBuild.networks) {
    status[network.chainId] = { block: null, ready: false };
  }

  const seconds: Seconds = {
    start: decodeCheckpoint(getOmnichainCheckpoint("start")!).blockTimestamp,
    end: decodeCheckpoint(
      min(getOmnichainCheckpoint("end"), getOmnichainCheckpoint("finalized")),
    ).blockTimestamp,
  };

  let isKilled = false;

  async function* getEvents() {
    const to = min(
      getOmnichainCheckpoint("end"),
      getOmnichainCheckpoint("finalized"),
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
          syncStore: params.syncStore,
          sources,
          localSyncGenerator,
          from:
            params.initialCheckpoint !== ZERO_CHECKPOINT_STRING
              ? params.initialCheckpoint
              : getChainCheckpoint({ syncProgress, network, tag: "start" })!,
          to,
          limit: 1000,
        });

        return bufferAsyncGenerator(localEventGenerator, 2);
      },
    );

    for await (const { events, checkpoint } of mergeEventGenerators(
      eventGenerators,
    )) {
      for (const network of params.indexingBuild.networks) {
        updateHistoricalStatus({ events, checkpoint, network });
      }
      yield events;
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

        status[network.chainId]!.block = {
          number: hexToNumber(syncProgress.current!.number),
          timestamp: hexToNumber(syncProgress.current!.timestamp),
        };
        status[network.chainId]!.ready = true;

        // Fetch any events between the omnichain finalized checkpoint and the single-chain
        // finalized checkpoint and add them to pendingEvents. These events are synced during
        // the historical phase, but must be indexed in the realtime phase because events
        // synced in realtime on other chains might be ordered before them.
        const from = getOmnichainCheckpoint("finalized")!;

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
          pendingEvents.push(...events.events);
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

          realtimeSync.start({ syncProgress, initialChildAddresses });
        }
      }
    },
    getStatus() {
      return status;
    },
    getSeconds() {
      return seconds;
    },
    getFinalizedCheckpoint() {
      return getOmnichainCheckpoint("finalized")!;
    },
    async kill() {
      isKilled = true;
      const promises: Promise<void>[] = [];
      for (const network of params.indexingBuild.networks) {
        const { historicalSync, realtimeSync } = perNetworkSync.get(network)!;
        historicalSync.kill();
        promises.push(realtimeSync.kill());
      }
      await Promise.all(promises);
    },
  };
};
