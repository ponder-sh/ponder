import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import { createHistoricalSync } from "@/sync-historical/index.js";
import {
  type RealtimeSyncEvent,
  createRealtimeSync,
} from "@/sync-realtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import type { LightBlock, SyncBlock } from "@/types/sync.js";
import {
  type Checkpoint,
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import type { Interval } from "@/utils/interval.js";
import { never } from "@/utils/never.js";
import { type RequestQueue, createRequestQueue } from "@/utils/requestQueue.js";
import { startClock } from "@/utils/timer.js";
import { createQueue } from "@ponder/common";
import { hexToNumber } from "viem";
import { _eth_getBlockByNumber } from "../utils/rpc.js";
import { buildEvents } from "./events.js";
import {
  type RealtimeEvent,
  type Status,
  type Sync,
  blockToCheckpoint,
} from "./index.js";
import type { Source } from "./source.js";
import { cachedTransport } from "./transport.js";

type CreateSyncParameters = {
  common: Common;
  syncStore: SyncStore;
  sources: Source[];
  network: Network;
  onRealtimeEvent(event: RealtimeEvent): void;
  onFatalError(error: Error): void;
  initialCheckpoint: Checkpoint;
};

const syncDiagnostic = async ({
  common,
  sources,
  network,
  requestQueue,
}: Pick<CreateSyncParameters, "common" | "sources" | "network"> & {
  requestQueue: RequestQueue;
}) => {
  /** Earliest `startBlock` among all `filters` */
  const start = Math.min(...sources.map(({ filter }) => filter.fromBlock ?? 0));
  /**
   * Latest `endBlock` among all filters. `undefined` if at least one
   * of the filters doesn't have an `endBlock`.
   */
  const end = sources.some(({ filter }) => filter.toBlock === undefined)
    ? undefined
    : Math.min(...sources.map(({ filter }) => filter.toBlock!));

  const [remoteChainId, startBlock, endBlock, latestBlock] = await Promise.all([
    requestQueue.request({ method: "eth_chainId" }),
    _eth_getBlockByNumber(requestQueue, { blockNumber: start }),
    end === undefined
      ? undefined
      : _eth_getBlockByNumber(requestQueue, { blockNumber: end }),
    _eth_getBlockByNumber(requestQueue, { blockTag: "latest" }),
  ]);

  // Warn if the config has a different chainId than the remote.
  if (hexToNumber(remoteChainId) !== network.chainId) {
    common.logger.warn({
      service: "sync",
      msg: `Remote chain ID (${remoteChainId}) does not match configured chain ID (${network.chainId}) for network "${network.name}"`,
    });
  }

  const finalizedBlockNumber = Math.max(
    0,
    hexToNumber(latestBlock.number) - network.finalityBlockCount,
  );

  const finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: finalizedBlockNumber,
  });

  return {
    start: startBlock,
    end: endBlock,
    finalized: finalizedBlock,
  };
};

type BlockProgress = {
  start: SyncBlock | LightBlock;
  end: SyncBlock | LightBlock | undefined;
  finalized: SyncBlock | LightBlock;
  latest: SyncBlock | LightBlock | undefined;
};

export const createMultichainSync = async (
  args: CreateSyncParameters,
): Promise<Sync> => {
  ////////
  // State
  ////////
  let isKilled = false;
  const requestQueue = createRequestQueue({
    network: args.network,
    common: args.common,
  });
  const blockProgress: BlockProgress = {
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
  /** ... */
  let rawData: Omit<Extract<RealtimeSyncEvent, { type: "block" }>, "type">[] =
    [];

  ////////
  // Helper functions
  ////////

  /** Returns true if all possible blocks have been synced. */
  const isSyncExhaustive = () => {
    if (blockProgress.end === undefined || blockProgress.latest === undefined)
      return false;
    return (
      hexToNumber(blockProgress.latest.number) >=
      hexToNumber(blockProgress.end.number)
    );
  };

  /** Returns the checkpoint for a given block tag. */
  const getChainCheckpoint = (
    tag: "start" | "latest" | "finalized" | "end",
  ): string | undefined => {
    if (tag === "end" && blockProgress.end === undefined) {
      return undefined;
    }

    if (tag === "latest" && isSyncExhaustive()) {
      return undefined;
    }

    const block = blockProgress[tag]!;
    return encodeCheckpoint(
      blockToCheckpoint(
        block,
        args.network.chainId,
        // The checkpoint returned by this function is meant to be used in
        // a closed interval (includes endpoints), so "start" should be inclusive.
        tag === "start" ? "down" : "up",
      ),
    );
  };

  async function* localSyncHelper() {
    /**
     * Estimate optimal range (blocks) to sync at a time, eventually to be used to
     * determine `interval` passed to `historicalSync.sync()`.
     */
    let estimateRange = 25;
    let latestFinalizedFetch = Date.now() / 1_000;
    // Cursor to track progress.
    let fromBlock = hexToNumber(blockProgress.start.number);
    // Attempt move the `fromBlock` forward if `historicalSync.latestBlock`
    // is defined (a cache hit has occurred)
    if (historicalSync.latestBlock !== undefined) {
      fromBlock = hexToNumber(historicalSync.latestBlock.number);
    }
    /**
     * Calculate start checkpoint, if `args.initial` is non-zero,
     * use that. Otherwise, use `startBlock`
     */
    const start =
      encodeCheckpoint(args.initialCheckpoint) !==
      encodeCheckpoint(zeroCheckpoint)
        ? encodeCheckpoint(args.initialCheckpoint)
        : getChainCheckpoint("start")!;
    // Cursor used to track progress.
    let from = start;

    historicalSync.initializeMetrics(
      blockProgress.finalized as SyncBlock,
      true,
    );

    while (true) {
      /**
       * Select a range of blocks to sync bounded by `finalizedBlock`.
       *
       * It is important for devEx that the interval is not too large, because
       * time spent syncing ≈ time before indexing function feedback.
       */
      const interval: Interval = [
        fromBlock,
        Math.min(
          hexToNumber(blockProgress.finalized.number),
          fromBlock + estimateRange,
        ),
      ];

      const endClock = startClock();
      await historicalSync.sync(interval);
      const duration = endClock();

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

      // Update cursor to record progress
      fromBlock = interval[1] + 1;

      if (blockProgress.latest === undefined) continue;

      const end =
        blockProgress.end !== undefined &&
        getChainCheckpoint("end")! < getChainCheckpoint("finalized")!
          ? getChainCheckpoint("end")!
          : getChainCheckpoint("finalized")!;

      const to = getChainCheckpoint("latest") ?? end;

      yield { from, to };
      from = to;

      if (isSyncExhaustive()) return;
      if (blockProgress.finalized === blockProgress.latest) {
        const staleSeconds = Date.now() / 1000 - latestFinalizedFetch;
        if (staleSeconds <= args.common.options.syncHandoffStaleSeconds) {
          return;
        }

        args.common.logger.debug({
          service: "sync",
          msg: `Refetching '${args.network.name}' finalized block`,
        });

        const latestBlock = await _eth_getBlockByNumber(requestQueue, {
          blockTag: "latest",
        });

        const finalizedBlockNumber = Math.max(
          0,
          hexToNumber(latestBlock.number) - args.network.finalityBlockCount,
        );

        blockProgress.finalized = await _eth_getBlockByNumber(requestQueue, {
          blockNumber: finalizedBlockNumber,
        });

        historicalSync.initializeMetrics(
          blockProgress.finalized as SyncBlock,
          false,
        );

        latestFinalizedFetch = Date.now() / 1_000;
      }
    }
  }

  /** Implements predictive pagination for `getEvents` */
  async function* getEventsHelper(from: string, to: string) {
    /**
     * Estimate optimal range (seconds) to query at a time, eventually
     * used to determine `to` passed to `getEvents`
     */
    let estimateSeconds = 10_000;

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

      // updateStatus(events, cursor, false);

      const fromTime = decodeCheckpoint(from).blockTimestamp;
      const cursorTime = decodeCheckpoint(cursor).blockTimestamp;
      const receivedDensity = (cursorTime - fromTime) / (events.length || 1);

      // Use range and number of events returned to update estimate
      // 10 <= estimate(new) <= estimate(prev) * 2
      estimateSeconds = Math.min(
        Math.max(10, Math.round(receivedDensity * getEventsMaxBatchSize)),
        estimateSeconds * 2,
      );

      yield { events, cursor };
      from = cursor;
    }
  }

  async function* getEvents() {
    for await (const { from, to } of localSyncHelper()) {
      for await (const { events, cursor } of getEventsHelper(from, to)) {
        status.block = {
          number: Number(decodeCheckpoint(cursor).blockNumber),
          timestamp: decodeCheckpoint(cursor).blockTimestamp,
        };
        yield { events, checkpoint: to };
      }
    }
  }

  const eventQueue = createQueue({
    browser: false,
    concurrency: 1,
    initialStart: true,
    worker: async ({ event }: { event: RealtimeSyncEvent }) => {
      switch (event.type) {
        /**
         * Handle a new block being ingested.
         */
        case "block":
          {
            rawData.push(event);
            blockProgress.latest = event.block;

            const checkpoint = getChainCheckpoint("latest")!;
            const events = buildEvents(args.sources, event);

            status.block = {
              number: hexToNumber(event.block.number),
              timestamp: hexToNumber(event.block.timestamp),
            };

            args.onRealtimeEvent({ type: "block", checkpoint, events });
          }
          break;
        /**
         * Handle a new block being finalized.
         */
        case "finalize":
          {
            // Add finalized block, logs, transactions, receipts, and traces to the sync-store.

            const chainId = args.network.chainId;
            const finalizedData = rawData.filter(
              (d) =>
                hexToNumber(d.block.number) <= hexToNumber(event.block.number),
            );

            await Promise.all([
              args.syncStore.insertBlocks({
                blocks: finalizedData.map(({ block }) => block),
                chainId,
              }),
              args.syncStore.insertLogs({
                logs: finalizedData.flatMap(({ logs, block }) =>
                  logs.map((log) => ({ log, block })),
                ),
                chainId,
              }),
              args.syncStore.insertTransactions({
                transactions: finalizedData.flatMap(
                  ({ transactions }) => transactions,
                ),
                chainId,
              }),
              args.syncStore.insertTransactionReceipts({
                transactionReceipts: finalizedData.flatMap(
                  ({ transactionReceipts }) => transactionReceipts,
                ),
                chainId,
              }),
              args.syncStore.insertCallTraces({
                callTraces: finalizedData.flatMap(({ callTraces, block }) =>
                  callTraces.map((callTrace) => ({ callTrace, block })),
                ),
                chainId,
              }),
            ]);

            rawData = rawData.filter(
              (d) =>
                hexToNumber(d.block.number) > hexToNumber(event.block.number),
            );

            // Newly finalized range
            const interval = [
              hexToNumber(blockProgress.finalized.number),
              hexToNumber(event.block.number),
            ] satisfies Interval;

            // Update local sync

            blockProgress.finalized = event.block;
            const checkpoint = getChainCheckpoint("finalized")!;

            const filters = args.sources
              .filter(({ filter }) => filter.chainId === args.network.chainId)
              .map(({ filter }) => filter);
            // Insert an interval for the newly finalized range.
            await Promise.all(
              filters.map((filter) =>
                args.syncStore.insertInterval({ filter, interval }),
              ),
            );

            // Raise event to parent function (runtime)
            args.onRealtimeEvent({ type: "finalize", checkpoint });

            /**
             * The realtime service can be killed if `endBlock` is
             * defined has become finalized.
             */
            if (isSyncExhaustive()) {
              args.common.logger.info({
                service: "sync",
                msg: `Synced final end block for '${args.network.name}' (${hexToNumber(blockProgress.end!.number)}), killing realtime sync service`,
              });
              await realtimeSync.kill();
            }
          }
          break;
        /**
         * Handle a reorg with a new common ancestor block being found.
         */
        case "reorg":
          {
            // Update local sync

            rawData = rawData.filter(
              (d) =>
                hexToNumber(d.block.number) <= hexToNumber(event.block.number),
            );

            blockProgress.latest = event.block;
            const checkpoint = getChainCheckpoint("latest")!;

            // Note: this should only drop rpc requests
            await args.syncStore.pruneByBlock({
              fromBlock: hexToNumber(event.block.number),
              chainId: args.network.chainId,
            });

            args.onRealtimeEvent({ type: "reorg", checkpoint });
          }
          break;

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

      realtimeSync.start(blockProgress.finalized);
    },
    getStartCheckpoint() {
      return getChainCheckpoint("start")!;
    },
    getFinalizedCheckpoint() {
      return getChainCheckpoint("finalized")!;
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
