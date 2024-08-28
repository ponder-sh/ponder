import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import type { HistoricalSync } from "@/sync-historical/index.js";
import type { RealtimeSync, RealtimeSyncEvent } from "@/sync-realtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import type { LightBlock, SyncBlock } from "@/types/sync.js";
import {
  type Checkpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import type { Interval } from "@/utils/interval.js";
import { never } from "@/utils/never.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import { startClock } from "@/utils/timer.js";
import { type Transport, hexToBigInt, hexToNumber } from "viem";
import { _eth_getBlockByNumber } from "../utils/rpc.js";
import type { RawEvent } from "./events.js";
import type { Source } from "./source.js";

export type Sync = {
  getEvents(): AsyncGenerator<{ events: RawEvent[]; checkpoint: string }>;
  startRealtime(): void;
  getStatus(): Status;
  getStartCheckpoint(): string;
  getFinalizedCheckpoint(): string;
  getCachedTransport(network: Network): Transport;
  kill(): Promise<void>;
};

export type RealtimeEvent =
  | {
      type: "block";
      checkpoint: string;
      events: RawEvent[];
    }
  | {
      type: "reorg";
      checkpoint: string;
    }
  | {
      type: "finalize";
      checkpoint: string;
    };

export type Status = {
  [networkName: string]: {
    block: { number: number; timestamp: number } | null;
    ready: boolean;
  };
};

export type BlockProgress = {
  start: SyncBlock | LightBlock;
  end: SyncBlock | LightBlock | undefined;
  finalized: SyncBlock | LightBlock;
  latest: SyncBlock | LightBlock | undefined;
};

export const syncBlockToLightBlock = ({
  hash,
  parentHash,
  number,
  timestamp,
}: SyncBlock): LightBlock => ({ hash, parentHash, number, timestamp });

/** Convert `block` to a `Checkpoint`. */
export const blockToCheckpoint = (
  block: LightBlock | SyncBlock,
  chainId: number,
  rounding: "up" | "down",
): Checkpoint => {
  return {
    ...(rounding === "up" ? maxCheckpoint : zeroCheckpoint),
    blockTimestamp: hexToNumber(block.timestamp),
    chainId: BigInt(chainId),
    blockNumber: hexToBigInt(block.number),
  };
};

/** Returns true if all possible blocks have been synced. */
export const isSyncExhaustive = (blockProgress: BlockProgress) => {
  if (blockProgress.end === undefined || blockProgress.latest === undefined)
    return false;
  return (
    hexToNumber(blockProgress.latest.number) >=
    hexToNumber(blockProgress.end.number)
  );
};

/** Returns the checkpoint for a given block tag. */
export const getChainCheckpoint = (
  blockProgress: BlockProgress,
  network: Network,
  tag: "start" | "latest" | "finalized" | "end",
): string | undefined => {
  if (tag === "end" && blockProgress.end === undefined) {
    return undefined;
  }

  if (tag === "latest" && isSyncExhaustive(blockProgress)) {
    return undefined;
  }

  const block = blockProgress[tag]!;
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

/** ... */
export const syncDiagnostic = async ({
  common,
  sources,
  network,
  requestQueue,
}: {
  common: Common;
  sources: Source[];
  network: Network;
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

/** Predictive pagination for `historicalSync.sync()` */
export async function* localHistoricalSyncHelper({
  common,
  network,
  requestQueue,
  blockProgress,
  historicalSync,
}: {
  common: Common;
  network: Network;
  requestQueue: RequestQueue;
  blockProgress: BlockProgress;
  historicalSync: HistoricalSync;
}): AsyncGenerator {
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

  historicalSync.initializeMetrics(blockProgress.finalized as SyncBlock, true);

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

    yield;

    if (isSyncExhaustive(blockProgress)) return;
    // Dynamically refetch `finalized` block if it is considered "stale"
    if (blockProgress.finalized === blockProgress.latest) {
      const staleSeconds = Date.now() / 1000 - latestFinalizedFetch;
      if (staleSeconds <= common.options.syncHandoffStaleSeconds) {
        return;
      }

      common.logger.debug({
        service: "sync",
        msg: `Refetching '${network.name}' finalized block`,
      });

      const latestBlock = await _eth_getBlockByNumber(requestQueue, {
        blockTag: "latest",
      });

      const finalizedBlockNumber = Math.max(
        0,
        hexToNumber(latestBlock.number) - network.finalityBlockCount,
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

/** ... */
export const onEventHelper = async ({
  common,
  syncStore,
  event,
  network,
  sources,
  realtimeSync,
  blockProgress,
  rawUnfinalizedData,
}: {
  common: Common;
  syncStore: SyncStore;
  event: RealtimeSyncEvent;
  network: Network;
  sources: Source[];
  realtimeSync: RealtimeSync;
  blockProgress: BlockProgress;
  rawUnfinalizedData: Omit<
    Extract<RealtimeSyncEvent, { type: "block" }>,
    "type"
  >[];
}): Promise<{
  blockProgress: BlockProgress;
  rawUnfinalizedData: Omit<
    Extract<RealtimeSyncEvent, { type: "block" }>,
    "type"
  >[];
}> => {
  switch (event.type) {
    /**
     * Handle a new block being ingested.
     */
    case "block": {
      rawUnfinalizedData.push(event);
      blockProgress.latest = event.block;

      break;
    }
    /**
     * Handle a new block being finalized.
     */
    case "finalize": {
      // Add finalized block, logs, transactions, receipts, and traces to the sync-store.

      const chainId = network.chainId;
      const finalizedData = rawUnfinalizedData.filter(
        (d) => hexToNumber(d.block.number) <= hexToNumber(event.block.number),
      );

      await Promise.all([
        syncStore.insertBlocks({
          blocks: finalizedData.map(({ block }) => block),
          chainId,
        }),
        syncStore.insertLogs({
          logs: finalizedData.flatMap(({ logs, block }) =>
            logs.map((log) => ({ log, block })),
          ),
          chainId,
        }),
        syncStore.insertTransactions({
          transactions: finalizedData.flatMap(
            ({ transactions }) => transactions,
          ),
          chainId,
        }),
        syncStore.insertTransactionReceipts({
          transactionReceipts: finalizedData.flatMap(
            ({ transactionReceipts }) => transactionReceipts,
          ),
          chainId,
        }),
        syncStore.insertCallTraces({
          callTraces: finalizedData.flatMap(({ callTraces, block }) =>
            callTraces.map((callTrace) => ({ callTrace, block })),
          ),
          chainId,
        }),
      ]);

      rawUnfinalizedData = rawUnfinalizedData.filter(
        (d) => hexToNumber(d.block.number) > hexToNumber(event.block.number),
      );

      // Newly finalized range
      const interval = [
        hexToNumber(blockProgress.finalized.number),
        hexToNumber(event.block.number),
      ] satisfies Interval;

      blockProgress.finalized = event.block;

      // Insert an interval for the newly finalized range.
      await Promise.all(
        sources.map(({ filter }) =>
          syncStore.insertInterval({ filter, interval }),
        ),
      );

      /**
       * The realtime service can be killed if `endBlock` is
       * defined has become finalized.
       */
      if (isSyncExhaustive(blockProgress)) {
        common.logger.info({
          service: "sync",
          msg: `Synced final end block for '${network.name}' (${hexToNumber(blockProgress.end!.number)}), killing realtime sync service`,
        });
        await realtimeSync.kill();
      }
      break;
    }
    /**
     * Handle a reorg with a new common ancestor block being found.
     */
    case "reorg": {
      rawUnfinalizedData = rawUnfinalizedData.filter(
        (d) => hexToNumber(d.block.number) <= hexToNumber(event.block.number),
      );

      blockProgress.latest = event.block;

      await syncStore.pruneByBlock({
        fromBlock: hexToNumber(event.block.number),
        chainId: network.chainId,
      });

      break;
    }

    default:
      never(event);
  }

  return { blockProgress, rawUnfinalizedData };
};
