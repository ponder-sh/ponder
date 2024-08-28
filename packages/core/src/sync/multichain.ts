import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import { createHistoricalSync } from "@/sync-historical/index.js";
import {
  type RealtimeSyncEvent,
  createRealtimeSync,
} from "@/sync-realtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { never } from "@/utils/never.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import { createQueue } from "@ponder/common";
import { hexToNumber } from "viem";
import { _eth_getBlockByNumber } from "../utils/rpc.js";
import { buildEvents } from "./events.js";
import {
  type BlockProgress,
  type RealtimeEvent,
  type Status,
  type Sync,
  getChainCheckpoint,
  isSyncExhaustive,
  localHistoricalSyncHelper,
  onEventHelper,
  syncDiagnostic,
} from "./index.js";
import type { Source } from "./source.js";
import { cachedTransport } from "./transport.js";

type CreateMultichainSyncParameters = {
  common: Common;
  syncStore: SyncStore;
  sources: Source[];
  network: Network;
  onRealtimeEvent(event: RealtimeEvent): void;
  onFatalError(error: Error): void;
  initialCheckpoint: string;
};

export const createMultichainSync = async (
  args: CreateMultichainSyncParameters,
): Promise<Sync> => {
  ////////
  // State
  ////////
  let isKilled = false;
  const requestQueue = createRequestQueue({
    network: args.network,
    common: args.common,
  });
  let blockProgress: BlockProgress = {
    ...(await syncDiagnostic({ ...args, requestQueue })),
    latest: undefined,
  };
  const status: Status[string] = {
    block: null,
    ready: false,
  };
  const historicalSync = await createHistoricalSync({
    ...args,
    requestQueue,
  });
  const realtimeSync = createRealtimeSync({
    ...args,
    requestQueue,
    onEvent: (event) =>
      eventQueue.add({ event }).catch((error) => {
        args.common.logger.error({
          service: "sync",
          msg: `Fatal error: Unable to process ${event.type} event`,
          error,
        });
        args.onFatalError(error);
      }),
  });
  let rawUnfinalizedData: Omit<
    Extract<RealtimeSyncEvent, { type: "block" }>,
    "type"
  >[] = [];

  // Invalidate sync cache for devnet sources
  if (args.network.disableCache) {
    const startBlock = hexToNumber(blockProgress.start.number);

    args.common.logger.warn({
      service: "sync",
      msg: `Deleting cache records for '${args.network.name}' from block ${startBlock}`,
    });

    await args.syncStore.pruneByChain({
      fromBlock: startBlock,
      chainId: args.network.chainId,
    });
  }

  /**
   * Estimate optimal range (seconds) to query at a time, eventually
   * used to determine `to` passed to `getEvents`
   */
  let estimateSeconds = 10_000;

  async function* getEvents() {
    /**
     * Calculate start checkpoint, if `initialCheckpoint` is non-zero,
     * use that. Otherwise, use `startBlock`
     */
    const start =
      args.initialCheckpoint !== encodeCheckpoint(zeroCheckpoint)
        ? args.initialCheckpoint
        : getChainCheckpoint(blockProgress, args.network, "start")!;

    // Cursor used to track progress.
    let from = start;

    for await (const _ of localHistoricalSyncHelper({
      ...args,
      blockProgress,
      historicalSync,
      requestQueue,
    })) {
      /**
       * Calculate the mininum "latest" checkpoint, falling back to `end` if
       * all networks have completed.
       *
       * `end`: If every network has an `endBlock` and it's less than
       * `finalized`, use that. Otherwise, use `finalized`
       */
      const end =
        blockProgress.end !== undefined &&
        getChainCheckpoint(blockProgress, args.network, "end")! <
          getChainCheckpoint(blockProgress, args.network, "finalized")!
          ? getChainCheckpoint(blockProgress, args.network, "end")!
          : getChainCheckpoint(blockProgress, args.network, "finalized")!;
      const to =
        getChainCheckpoint(blockProgress, args.network, "latest") ?? end;

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

        status.block = {
          number: Number(decodeCheckpoint(cursor).blockNumber),
          timestamp: decodeCheckpoint(cursor).blockTimestamp,
        };

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

  const eventQueue = createQueue({
    browser: false,
    concurrency: 1,
    initialStart: true,
    worker: async ({ event }: { event: RealtimeSyncEvent }) => {
      const eventResult = await onEventHelper({
        ...args,
        event,
        realtimeSync,
        blockProgress,
        rawUnfinalizedData,
      });
      blockProgress = eventResult.blockProgress;
      rawUnfinalizedData = eventResult.rawUnfinalizedData;
      switch (event.type) {
        /**
         * Handle a new block being ingested.
         */
        case "block": {
          const checkpoint = getChainCheckpoint(
            blockProgress,
            args.network,
            "latest",
          )!;
          const events = buildEvents(args.sources, event);

          status.block = {
            number: hexToNumber(event.block.number),
            timestamp: hexToNumber(event.block.timestamp),
          };

          args.onRealtimeEvent({ type: "block", checkpoint, events });
          break;
        }
        /**
         * Handle a new block being finalized.
         */
        case "finalize": {
          const checkpoint = getChainCheckpoint(
            blockProgress,
            args.network,
            "finalized",
          )!;
          // Raise event to parent function (runtime)
          args.onRealtimeEvent({ type: "finalize", checkpoint });
          break;
        }
        /**
         * Handle a reorg with a new common ancestor block being found.
         */
        case "reorg": {
          const checkpoint = getChainCheckpoint(
            blockProgress,
            args.network,
            "latest",
          )!;
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
      status.block = {
        number: hexToNumber(blockProgress.latest!.number),
        timestamp: hexToNumber(blockProgress.latest!.timestamp),
      };
      status.ready = true;

      if (isSyncExhaustive(blockProgress) === false) {
        realtimeSync.start(blockProgress.finalized);
      }
    },
    getStartCheckpoint() {
      return getChainCheckpoint(blockProgress, args.network, "start")!;
    },
    getFinalizedCheckpoint() {
      return getChainCheckpoint(blockProgress, args.network, "finalized")!;
    },
    getStatus() {
      return { [args.network.name]: status };
    },
    getCachedTransport() {
      return cachedTransport({ requestQueue, syncStore: args.syncStore });
    },
    async kill() {
      isKilled = true;

      eventQueue.pause();
      eventQueue.clear();

      await Promise.all([
        historicalSync.kill(),
        realtimeSync.kill(),
        eventQueue.onIdle(),
      ]);
    },
  };
};
