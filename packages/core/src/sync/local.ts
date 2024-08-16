import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import { createHistoricalSync } from "@/sync-historical/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import type { LightBlock } from "@/types/sync.js";
import { estimate } from "@/utils/estimate.js";
import type { Interval } from "@/utils/interval.js";
import { type RequestQueue, createRequestQueue } from "@/utils/requestQueue.js";
import { startClock } from "@/utils/timer.js";
import { hexToNumber } from "viem";
import { _eth_getBlockByNumber } from "../utils/rpc.js";
import type { Source } from "./source.js";

export type LocalSync = {
  requestQueue: RequestQueue;
  startBlock: LightBlock;
  endBlock: LightBlock | undefined;
  latestBlock: LightBlock | undefined;
  finalizedBlock: LightBlock;
  sync(): Promise<void>;
  /** Returns true when `latestBlock` is closer to tip than `endBlock` */
  isComplete(): boolean;
  refetchFinalizedBlock(): Promise<void>;
  kill(): void;
};

type CreateLocalSyncParameters = {
  common: Common;
  syncStore: SyncStore;
  sources: Source[];
  network: Network;
};

export const createLocalSync = async (
  args: CreateLocalSyncParameters,
): Promise<LocalSync> => {
  const requestQueue = createRequestQueue({
    network: args.network,
    common: args.common,
  });

  /** Earliest `startBlock` among all `filters` */
  const start = Math.min(
    ...args.sources.map(({ filter }) => filter.fromBlock ?? 0),
  );
  /**
   * Latest `endBlock` among all filters. `undefined` if at least one
   * of the filters doesn't have an `endBlock`.
   */
  const end = args.sources.some(({ filter }) => filter.toBlock === undefined)
    ? undefined
    : Math.min(...args.sources.map(({ filter }) => filter.toBlock!));

  const [remoteChainId, startBlock, endBlock, latestBlock] = await Promise.all([
    requestQueue.request({ method: "eth_chainId" }),
    _eth_getBlockByNumber(requestQueue, { blockNumber: start }),
    end === undefined
      ? undefined
      : _eth_getBlockByNumber(requestQueue, { blockNumber: end }),
    _eth_getBlockByNumber(requestQueue, { blockTag: "latest" }),
  ]);

  // Warn if the config has a different chainId than the remote.
  if (hexToNumber(remoteChainId) !== args.network.chainId) {
    args.common.logger.warn({
      service: "sync",
      msg: `Remote chain ID (${remoteChainId}) does not match configured chain ID (${args.network.chainId}) for network "${args.network.name}"`,
    });
  }

  const finalizedBlockNumber = Math.max(
    0,
    hexToNumber(latestBlock.number) - args.network.finalityBlockCount,
  );

  let finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: finalizedBlockNumber,
  });

  const historicalSync = await createHistoricalSync({
    common: args.common,
    sources: args.sources,
    syncStore: args.syncStore,
    network: args.network,
    requestQueue,
  });
  historicalSync.initializeMetrics(finalizedBlock, true);

  /**
   * Estimate optimal range (blocks) to sync at a time, eventually to be used to
   * determine `interval` passed to `historicalSync.sync()`.
   */
  let estimateRange = 25;

  // Cursor to track progress.
  let fromBlock = hexToNumber(startBlock.number);

  // Attempt move the `fromBlock` forward if `historicalSync.latestBlock`
  // is defined (a cache hit has occurred)
  if (historicalSync.latestBlock !== undefined) {
    fromBlock = hexToNumber(historicalSync.latestBlock.number);
  }

  // `latestBlock` override. Set during realtime sync
  let _latestBlock: LightBlock | undefined;

  const localSync = {
    requestQueue,
    startBlock,
    endBlock,
    get latestBlock() {
      if (_latestBlock !== undefined) return _latestBlock;
      /**
       * Use `fromBlock` to determine if the sync is complete. If the sync is
       * complete, return the most relevant block (`endBlock` takes precedence over `finalizedBlock`),
       * otherwise, return the `latestBlock` according to `historicalSync`.
       *
       * This extra complexity is needed to make sure omnichain ordering can happen accurately.
       */
      if (endBlock !== undefined && fromBlock >= hexToNumber(endBlock.number)) {
        return endBlock;
      }
      if (fromBlock >= hexToNumber(finalizedBlock.number)) {
        return finalizedBlock;
      }
      return historicalSync.latestBlock;
    },
    set latestBlock(block) {
      if (block === undefined) return;
      _latestBlock = block;
    },
    get finalizedBlock() {
      return finalizedBlock;
    },
    set finalizedBlock(block) {
      finalizedBlock = block;
    },
    async sync() {
      /**
       * Select a range of blocks to sync bounded by `finalizedBlock`.
       *
       * It is important for devEx that the interval is not too large, because
       * time spent syncing ≈ time before indexing function feedback.
       */
      const interval: Interval = [
        fromBlock,
        Math.min(hexToNumber(finalizedBlock.number), fromBlock + estimateRange),
      ];

      const endClock = startClock();
      await historicalSync.sync(interval);
      const duration = endClock();

      // Use the duration and interval of the last call to `sync` to update estimate
      estimateRange = estimate({
        from: interval[0],
        to: interval[1],
        target: 2_000,
        result: duration,
        min: 25,
        max: 50_000,
        prev: estimateRange,
        maxIncrease: 1.08,
      });

      // Update cursor to record progress
      fromBlock = interval[1] + 1;
    },
    isComplete() {
      if (this.endBlock === undefined || this.latestBlock === undefined)
        return false;
      return (
        hexToNumber(this.latestBlock.number) >=
        hexToNumber(this.endBlock.number)
      );
    },
    async refetchFinalizedBlock() {
      const latestBlock = await _eth_getBlockByNumber(requestQueue, {
        blockTag: "latest",
      });

      const finalizedBlockNumber = Math.max(
        0,
        hexToNumber(latestBlock.number) - args.network.finalityBlockCount,
      );

      finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
        blockNumber: finalizedBlockNumber,
      });
      historicalSync.initializeMetrics(finalizedBlock, false);
    },
    kill() {
      historicalSync.kill();
    },
  };

  return localSync;
};
