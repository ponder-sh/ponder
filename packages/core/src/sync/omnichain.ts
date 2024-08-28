import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
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
  checkpointMin,
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { mergeAsyncGenerators } from "@/utils/generators.js";
import { never } from "@/utils/never.js";
import { type RequestQueue, createRequestQueue } from "@/utils/requestQueue.js";
import { createQueue } from "@ponder/common";
import { hexToNumber } from "viem";
import type { RawEvent } from "./events.js";
import {
  type BlockProgress,
  type RealtimeEvent,
  type Status,
  type Sync,
  blockToCheckpoint,
  getChainCheckpoint,
  isSyncExhaustive,
  localHistoricalSyncHelper,
  onEventHelper,
  syncDiagnostic,
} from "./index.js";
import type { Source } from "./source.js";
import { cachedTransport } from "./transport.js";

type CreateOmnichainSyncParameters = {
  common: Common;
  syncStore: SyncStore;
  sources: Source[];
  networks: Network[];
  onRealtimeEvent(event: RealtimeEvent): void;
  onFatalError(error: Error): void;
  initialCheckpoint: string;
};

export const createOmnichainSync = async (
  args: CreateOmnichainSyncParameters,
): Promise<Sync> => {
  const localSyncs = new Map<
    Network,
    {
      requestQueue: RequestQueue;
      blockProgress: BlockProgress;
      historicalSync: HistoricalSync;
      realtimeSync: RealtimeSync;
      rawUnfinalizedData: Omit<
        Extract<RealtimeSyncEvent, { type: "block" }>,
        "type"
      >[];
    }
  >();
  const status: Status = {};
  let isKilled = false;

  // Create a `LocalSync` for each network, populating `localSyncs`.
  await Promise.all(
    args.networks.map(async (network) => {
      const requestQueue = createRequestQueue({
        network,
        common: args.common,
      });
      const sources = args.sources.filter(
        ({ filter }) => filter.chainId === network.chainId,
      );
      const blockProgress: BlockProgress = {
        ...(await syncDiagnostic({
          common: args.common,
          sources,
          requestQueue,
          network,
        })),
        latest: undefined,
      };
      const historicalSync = await createHistoricalSync({
        common: args.common,
        sources,
        syncStore: args.syncStore,
        requestQueue,
        network,
      });
      const realtimeSync = createRealtimeSync({
        common: args.common,
        sources,
        syncStore: args.syncStore,
        requestQueue,
        network,
        onEvent: (event) =>
          eventQueue.add({ event, network }).catch((error) => {
            args.common.logger.error({
              service: "sync",
              msg: `Fatal error: Unable to process ${event.type} event`,
              error,
            });
            args.onFatalError(error);
          }),
        onFatalError: args.onFatalError,
      });

      localSyncs.set(network, {
        requestQueue,
        blockProgress,
        historicalSync,
        realtimeSync,
        rawUnfinalizedData: [],
      });
      status[network.name] = { block: null, ready: false };
    }),
  );

  // Invalidate sync cache for devnet sources
  for (const network of args.networks) {
    if (network.disableCache) {
      const startBlock = hexToNumber(
        localSyncs.get(network)!.blockProgress.start.number,
      );

      args.common.logger.warn({
        service: "sync",
        msg: `Deleting cache records for '${network.name}' from block ${startBlock}`,
      });

      await args.syncStore.pruneByChain({
        fromBlock: startBlock,
        chainId: network.chainId,
      });
    }
  }

  /**
   * Returns the minimum checkpoint across all chains.
   */
  const getChainsCheckpoint = (
    tag: "start" | "latest" | "finalized" | "end",
  ): string | undefined => {
    const checkpoints = [...localSyncs.entries()].map(
      ([network, { blockProgress }]) =>
        getChainCheckpoint(blockProgress, network, tag),
    );

    if (tag === "end" && checkpoints.some((c) => c === undefined)) {
      return undefined;
    }

    if (tag === "latest" && checkpoints.every((c) => c === undefined)) {
      return undefined;
    }

    return encodeCheckpoint(
      checkpointMin(
        ...checkpoints.map((c) => (c ? decodeCheckpoint(c) : maxCheckpoint)),
      ),
    );
  };

  const updateStatus = ({
    events,
    checkpoint,
    network,
  }: { events: RawEvent[]; checkpoint: string; network: Network }) => {
    if (Number(decodeCheckpoint(checkpoint).chainId) === network.chainId) {
      status[network.name]!.block = {
        timestamp: decodeCheckpoint(checkpoint).blockTimestamp,
        number: Number(decodeCheckpoint(checkpoint).blockNumber),
      };
    }

    let i = events.length - 1;
    while (i >= 0) {
      const event = events[i]!;

      if (network.chainId === event.chainId) {
        status[network.name]!.block = {
          timestamp: decodeCheckpoint(event.checkpoint).blockTimestamp,
          number: Number(decodeCheckpoint(event.checkpoint).blockNumber),
        };
      }

      i--;
    }
  };

  const updateRealtimeStatus = ({
    checkpoint,
    rawUnfinalizedData,
    network,
  }: {
    checkpoint: string;
    rawUnfinalizedData: Omit<
      Extract<RealtimeSyncEvent, { type: "block" }>,
      "type"
    >[];
    network: Network;
  }) => {
    const localBlock = rawUnfinalizedData.findLast(
      ({ block }) =>
        encodeCheckpoint(blockToCheckpoint(block, network.chainId, "up")) <=
        checkpoint,
    )?.block;
    if (localBlock !== undefined) {
      status[network.name]!.block = {
        timestamp: hexToNumber(localBlock.timestamp),
        number: hexToNumber(localBlock.number),
      };
    }
  };

  /**
   * Estimate optimal range (seconds) to query at a time, eventually
   * used to determine `to` passed to `getEvents`
   */
  let estimateSeconds = 10_000;
  /**
   * Omnichain `getEvents`
   *
   * Extract all events across `args.networks` ordered by checkpoint.
   * The generator is "completed" when all event have been extracted
   * before the minimum finalized checkpoint (supremum).
   *
   * Note: `syncStore.getEvents` is used to order between multiple
   * networks. This approach is not future proof.
   */
  async function* getEvents() {
    const mergedSyncHelper = mergeAsyncGenerators(
      Array.from(localSyncs.entries()).map(
        ([network, { requestQueue, blockProgress, historicalSync }]) =>
          localHistoricalSyncHelper({
            common: args.common,
            network,
            requestQueue,
            blockProgress,
            historicalSync,
          }),
      ),
    );

    /**
     * Calculate start checkpoint, if `initialCheckpoint` is non-zero,
     * use that. Otherwise, use `startBlock`
     */
    const start =
      args.initialCheckpoint !== encodeCheckpoint(zeroCheckpoint)
        ? args.initialCheckpoint
        : getChainsCheckpoint("start")!;

    // Cursor used to track progress.
    let from = start;

    for await (const _ of mergedSyncHelper) {
      /**
       * Calculate the mininum "latest" checkpoint, falling back to `end` if
       * all networks have completed.
       *
       * `end`: If every network has an `endBlock` and it's less than
       * `finalized`, use that. Otherwise, use `finalized`
       */
      const end =
        getChainsCheckpoint("end") !== undefined &&
        getChainsCheckpoint("end")! < getChainsCheckpoint("finalized")!
          ? getChainsCheckpoint("end")!
          : getChainsCheckpoint("finalized")!;
      const to = getChainsCheckpoint("latest") ?? end;

      /*
       * Extract events with `syncStore.getEvents()`, paginating to
       * avoid loading too many events into memory.
       */
      while (true) {
        if (isKilled) return;
        if (from === to) return;
        const getEventsMaxBatchSize = args.common.options.syncEventsQuerySize;
        // convert `estimateSeconds` to checkpoint
        const estimatedTo = encodeCheckpoint({
          ...zeroCheckpoint,
          blockTimestamp: Math.min(
            decodeCheckpoint(from).blockTimestamp + estimateSeconds,
            maxCheckpoint.blockTimestamp,
          ),
        });
        const { events, cursor } = await args.syncStore.getEvents({
          filters: args.sources.map(({ filter }) => filter),
          from,
          to: to < estimatedTo ? to : estimatedTo,
          limit: getEventsMaxBatchSize,
        });

        for (const network of args.networks) {
          updateStatus({ events, checkpoint: cursor, network });
        }

        const fromTime = decodeCheckpoint(from).blockTimestamp;
        const cursorTime = decodeCheckpoint(cursor).blockTimestamp;
        const receivedDensity = (cursorTime - fromTime) / (events.length || 1);

        // Use range and number of events returned to update estimate
        // 10 <= estimate(new) <= estimate(prev) * 2
        estimateSeconds = Math.min(
          Math.max(10, Math.round(receivedDensity * getEventsMaxBatchSize)),
          estimateSeconds * 2,
        );

        yield { events, checkpoint: to };
        from = cursor;
      }
    }
  }

  /**
   * Omnichain `onRealtimeSyncEvent`
   *
   * Handle callback events across all `args.networks`, and raising these
   * events to `args.onRealtimeEvent` while maintaining checkpoint ordering.
   *
   * Note: "block" events are still being handled by writing and reading from
   * the sync-store. This approach is not future proof and inefficient.
   */
  const eventQueue = createQueue({
    browser: false,
    concurrency: 1,
    initialStart: true,
    worker: async ({
      network,
      event,
    }: { network: Network; event: RealtimeSyncEvent }) => {
      const previousFinalizedCheckpoint = getChainsCheckpoint("finalized")!;
      const previousCheckpoint = getChainsCheckpoint("latest")!;

      const localSync = localSyncs.get(network)!;
      const eventResult = await onEventHelper({
        common: args.common,
        syncStore: args.syncStore,
        event,
        network,
        sources: args.sources.filter(
          ({ filter }) => filter.chainId === network.chainId,
        ),
        realtimeSync: localSync.realtimeSync,
        blockProgress: localSync.blockProgress,
        rawUnfinalizedData: localSync.rawUnfinalizedData,
      });
      localSync.blockProgress = eventResult.blockProgress;
      localSync.rawUnfinalizedData = eventResult.rawUnfinalizedData;

      switch (event.type) {
        /**
         * Handle a new block being ingested.
         */
        case "block": {
          const checkpoint = getChainsCheckpoint("latest")!;

          /*
           * Extract events with `syncStore.getEvents()`, paginating to
           * avoid loading too many events into memory.
           */
          while (true) {
            if (isKilled) return;
            if (previousCheckpoint === checkpoint) break;
            let from = previousCheckpoint;

            const { events, cursor } = await args.syncStore.getEvents({
              filters: args.sources.map(({ filter }) => filter),
              from,
              to: checkpoint,
              limit: args.common.options.syncEventsQuerySize,
            });

            updateRealtimeStatus({
              checkpoint,
              rawUnfinalizedData: localSync.rawUnfinalizedData,
              network,
            });

            args.onRealtimeEvent({ type: "block", checkpoint, events });

            from = cursor;
          }
          break;
        }
        /**
         * Handle a new block being finalized.
         */
        case "finalize": {
          const checkpoint = getChainsCheckpoint("finalized")!;
          // Raise event to parent function (runtime)
          if (checkpoint > previousFinalizedCheckpoint) {
            args.onRealtimeEvent({ type: "finalize", checkpoint });
          }
          break;
        }
        /**
         * Handle a reorg with a new common ancestor block being found.
         */
        case "reorg": {
          const checkpoint = getChainsCheckpoint("latest")!;
          // Raise event to parent function (runtime)
          args.onRealtimeEvent({ type: "reorg", checkpoint });
          break;
        }

        default:
          never(event);
      }
    },
  });

  return {
    getEvents,
    startRealtime() {
      for (const network of args.networks) {
        const { blockProgress, realtimeSync } = localSyncs.get(network)!;

        status[network.name]!.block = {
          number: hexToNumber(blockProgress.latest!.number),
          timestamp: hexToNumber(blockProgress.latest!.timestamp),
        };
        status[network.name]!.ready = true;

        if (isSyncExhaustive(blockProgress) === false) {
          realtimeSync.start(blockProgress.finalized);
        }
      }
    },
    getStartCheckpoint() {
      return getChainsCheckpoint("start")!;
    },
    getFinalizedCheckpoint() {
      return getChainsCheckpoint("finalized")!;
    },
    getStatus() {
      return status;
    },
    getCachedTransport(network) {
      const { requestQueue } = localSyncs.get(network)!;
      return cachedTransport({ requestQueue, syncStore: args.syncStore });
    },
    async kill() {
      isKilled = true;
      const promises: Promise<void>[] = [];
      for (const network of args.networks) {
        const { historicalSync, realtimeSync } = localSyncs.get(network)!;
        historicalSync.kill();
        promises.push(realtimeSync.kill());
      }

      eventQueue.pause();
      eventQueue.clear();
      promises.push(eventQueue.onIdle());

      await Promise.all(promises);
    },
  };
};
