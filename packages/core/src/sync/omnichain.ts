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
  decodeCheckpoint,
  encodeCheckpoint,
  min,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { bufferAsyncGenerator } from "@/utils/generators.js";
import type { Interval } from "@/utils/interval.js";
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
  isSyncEnd,
} from "./index.js";
import type { RealtimeEvent } from "./index.js";

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
      requestQueue: RequestQueue;
      syncProgress: SyncProgress;
      historicalSync: HistoricalSync;
      realtimeSync: RealtimeSync;
      unfinalizedBlocks: Omit<
        Extract<RealtimeSyncEvent, { type: "block" }>,
        "type"
      >[];
    }
  >();

  await Promise.all(
    params.indexingBuild.networks.map(async (network, index) => {
      const requestQueue = params.requestQueues[index]!;

      const sources = params.indexingBuild.sources.filter(
        ({ filter }) => filter.chainId === network.chainId,
      );

      const syncProgress = await getLocalSyncProgress({
        common: params.common,
        network,
        sources,
        requestQueue,
      });

      const historicalSync = await createHistoricalSync({
        common: params.common,
        sources,
        syncStore: params.syncStore,
        requestQueue,
        network,
        onFatalError: params.onFatalError,
      });

      const realtimeSync = createRealtimeSync({
        common: params.common,
        sources,
        requestQueue,
        network,
        onEvent: (event) =>
          onRealtimeSyncEvent({ event, network }).catch((error) => {
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

      perNetworkSync.set(network, {
        requestQueue,
        syncProgress,
        historicalSync,
        realtimeSync,
        unfinalizedBlocks: [],
      });
    }),
  );

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

  /** Events that have been executed but not finalized. */
  let executedEvents: RawEvent[] = [];
  /** Events that have not been executed yet. */
  let pendingEvents: RawEvent[] = [];

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
      ([network, { requestQueue, syncProgress, historicalSync }]) => {
        const sources = params.indexingBuild.sources.filter(
          ({ filter }) => filter.chainId === network.chainId,
        );
        const filters = sources.map(({ filter }) => filter);

        const localSyncGenerator = getLocalSyncGenerator({
          common: params.common,
          syncStore: params.syncStore,
          network,
          requestQueue,
          sources,
          filters,
          syncProgress,
          historicalSync,
          onFatalError: params.onFatalError,
        });

        const localEventGenerator = getLocalEventGenerator({
          syncStore: params.syncStore,
          filters,
          localSyncGenerator,
          from:
            params.initialCheckpoint !== encodeCheckpoint(zeroCheckpoint)
              ? params.initialCheckpoint
              : getChainCheckpoint({ syncProgress, network, tag: "start" })!,
          to,
          batch: 1000,
        });

        return bufferAsyncGenerator(localEventGenerator, 2);
      },
    );

    const eventResults = await Promise.all(
      eventGenerators.map((gen) => gen.next()),
    );

    while (eventResults.some((res) => res.done !== true)) {
      const supremum = min(
        ...eventResults.map((res) =>
          res.done ? undefined : res.value.checkpoint,
        ),
      );

      const eventArrays: RawEvent[][] = [];

      for (const res of eventResults) {
        if (res.done === false) {
          const [left, right] = partition(
            res.value.events,
            (event) => event.checkpoint <= supremum,
          );

          eventArrays.push(left);
          res.value.events = right;
        }
      }

      const events = zipperMany(eventArrays).sort((a, b) =>
        a.checkpoint < b.checkpoint ? -1 : 1,
      );

      const index = eventResults.findIndex(
        (res) => res.done === false && res.value.checkpoint === supremum,
      );
      eventResults[index] = await eventGenerators[index]!.next();

      for (const network of params.indexingBuild.networks) {
        updateHistoricalStatus({ events, checkpoint: supremum, network });
      }

      yield events;
    }
  }

  const onRealtimeSyncEvent = async ({
    network,
    event,
  }: { network: Network; event: RealtimeSyncEvent }) => {
    const { syncProgress, realtimeSync, unfinalizedBlocks } =
      perNetworkSync.get(network)!;

    switch (event.type) {
      case "block": {
        const from = getOmnichainCheckpoint("current")!;
        syncProgress.current = event.block;
        const to = getOmnichainCheckpoint("current")!;

        params.common.metrics.ponder_sync_block.set(
          { network: network.name },
          hexToNumber(syncProgress.current.number),
        );

        const newEvents = buildEvents({
          sources: params.indexingBuild.sources,
          chainId: network.chainId,
          blockWithEventData: event,
          finalizedChildAddresses: realtimeSync.finalizedChildAddresses,
          unfinalizedChildAddresses: realtimeSync.unfinalizedChildAddresses,
        });

        unfinalizedBlocks.push(event);
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
            })
            .then(() => {
              if (events.length > 0 && isKilled === false) {
                params.common.logger.info({
                  service: "app",
                  msg: `Indexed ${events.length} events`,
                });
              }

              // update `ponder_realtime_latency` metric
              for (const network of params.indexingBuild.networks) {
                for (const { block, endClock } of perNetworkSync.get(network)!
                  .unfinalizedBlocks) {
                  const checkpoint = encodeCheckpoint(
                    blockToCheckpoint(block, network.chainId, "up"),
                  );
                  if (checkpoint > from && checkpoint <= to && endClock) {
                    params.common.metrics.ponder_realtime_latency.observe(
                      { network: network.name },
                      endClock(),
                    );
                  }
                }
              }
            });
        }

        break;
      }

      case "finalize": {
        // Newly finalized range
        const interval = [
          hexToNumber(syncProgress.finalized.number),
          hexToNumber(event.block.number),
        ] satisfies Interval;

        const prev = getOmnichainCheckpoint("finalized")!;
        syncProgress.finalized = event.block;
        const checkpoint = getOmnichainCheckpoint("finalized")!;

        // Raise event to parent function (runtime)
        if (checkpoint > prev) {
          params.onRealtimeEvent({ type: "finalize", checkpoint });
        }

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

        const finalizedBlocks = unfinalizedBlocks.filter(
          ({ block }) =>
            hexToNumber(block.number) <= hexToNumber(event.block.number),
        );

        perNetworkSync.get(network)!.unfinalizedBlocks =
          unfinalizedBlocks.filter(
            ({ block }) =>
              hexToNumber(block.number) > hexToNumber(event.block.number),
          );

        executedEvents = executedEvents.filter(
          (e) => e.checkpoint > checkpoint,
        );

        // Add finalized blocks, logs, transactions, receipts, and traces to the sync-store.

        await Promise.all([
          params.syncStore.insertBlocks({
            blocks: finalizedBlocks
              .filter(({ hasMatchedFilter }) => hasMatchedFilter)
              .map(({ block }) => block),
            chainId: network.chainId,
          }),
          params.syncStore.insertLogs({
            logs: finalizedBlocks.flatMap(({ logs, block }) =>
              logs.map((log) => ({ log, block })),
            ),
            shouldUpdateCheckpoint: true,
            chainId: network.chainId,
          }),
          params.syncStore.insertLogs({
            logs: finalizedBlocks.flatMap(({ factoryLogs }) =>
              factoryLogs.map((log) => ({ log })),
            ),
            shouldUpdateCheckpoint: false,
            chainId: network.chainId,
          }),
          params.syncStore.insertTransactions({
            transactions: finalizedBlocks.flatMap(({ transactions, block }) =>
              transactions.map((transaction) => ({
                transaction,
                block,
              })),
            ),
            chainId: network.chainId,
          }),
          params.syncStore.insertTransactionReceipts({
            transactionReceipts: finalizedBlocks.flatMap(
              ({ transactionReceipts }) => transactionReceipts,
            ),
            chainId: network.chainId,
          }),
          params.syncStore.insertTraces({
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
        // Note: this should happen after so the database doesn't become corrupted

        if (network.disableCache === false) {
          await params.syncStore.insertIntervals({
            intervals: params.indexingBuild.sources
              .filter(({ filter }) => filter.chainId === network.chainId)
              .map(({ filter }) => ({ filter, interval })),
            chainId: network.chainId,
          });
        }

        /**
         * The realtime service can be killed if `endBlock` is
         * defined has become finalized.
         */
        if (isSyncEnd(syncProgress)) {
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
            msg: `Synced final end block for '${network.name}' (${hexToNumber(syncProgress.end!.number)}), killing realtime sync service`,
          });
          realtimeSync.kill();
        }
        break;
      }
      case "reorg": {
        syncProgress.current = event.block;
        // Note: this checkpoint is <= the previous checkpoint
        const checkpoint = getOmnichainCheckpoint("current")!;

        // Update "ponder_sync_block" metric
        params.common.metrics.ponder_sync_block.set(
          { network: network.name },
          hexToNumber(syncProgress.current.number),
        );

        // Remove all reorged data

        perNetworkSync.get(network)!.unfinalizedBlocks =
          unfinalizedBlocks.filter(
            ({ block }) =>
              hexToNumber(block.number) <= hexToNumber(event.block.number),
          );

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

        const events = executedEvents.filter((e) => e.checkpoint > checkpoint);
        executedEvents = executedEvents.filter(
          (e) => e.checkpoint < checkpoint,
        );
        pendingEvents.push(...events);

        await params.syncStore.pruneRpcRequestResult({
          chainId: network.chainId,
          blocks: event.reorgedBlocks,
        });

        params.onRealtimeEvent({ type: "reorg", checkpoint });

        break;
      }

      default:
        never(event);
    }
  };

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
            // TODO(kyle) this is a bug for accounts sources
            if ("address" in filter && isAddressFactory(filter.address)) {
              const addresses = await params.syncStore.getChildAddresses({
                filter: filter.address,
              });

              initialChildAddresses.set(filter.address, new Set(addresses));
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
