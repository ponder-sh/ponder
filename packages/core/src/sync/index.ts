import type { Common } from "@/internal/common.js";
import type {
  Filter,
  Network,
  RawEvent,
  Source,
  Status,
} from "@/internal/types.js";
import type { HistoricalSync } from "@/sync-historical/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import type { LightBlock, SyncBlock } from "@/types/sync.js";
import {
  type Checkpoint,
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  min,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { estimate } from "@/utils/estimate.js";
import { formatPercentage } from "@/utils/format.js";
import { getNonBlockingAsyncGenerator } from "@/utils/generators.js";
import {
  type Interval,
  intervalDifference,
  intervalIntersection,
  intervalIntersectionMany,
  intervalSum,
  sortIntervals,
} from "@/utils/interval.js";
import { intervalUnion } from "@/utils/interval.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import { _eth_getBlockByNumber } from "@/utils/rpc.js";
import { startClock } from "@/utils/timer.js";
import { type Hash, hexToBigInt, hexToNumber, toHex } from "viem";

export type Sync = {
  getEvents(): AsyncGenerator<RawEvent[]>;
  startRealtime(): Promise<void>;
  getStatus(): Status;
  getSeconds(): Seconds;
  kill(): Promise<void>;
};

export type RealtimeEvent =
  | {
      type: "block";
      checkpoint: string;
      status: Status;
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

export type SyncProgress = {
  start: SyncBlock | LightBlock;
  end: SyncBlock | LightBlock | undefined;
  current: SyncBlock | LightBlock | undefined;
  finalized: SyncBlock | LightBlock;
};

export type Seconds = {
  start: number;
  end: number;
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
    ...(rounding === "up" ? maxCheckpoint : zeroCheckpoint),
    blockTimestamp: hexToNumber(block.timestamp),
    chainId: BigInt(chainId),
    blockNumber: hexToBigInt(block.number),
  };
};

/**
 * Returns true if all filters have a defined end block and the current
 * sync progress has reached the final end block.
 */
export const isSyncEnd = (syncProgress: SyncProgress) => {
  if (syncProgress.end === undefined || syncProgress.current === undefined) {
    return false;
  }

  return (
    hexToNumber(syncProgress.current.number) >=
    hexToNumber(syncProgress.end.number)
  );
};

/** Returns true if sync progress has reached the finalized block. */
export const isSyncFinalized = (syncProgress: SyncProgress) => {
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
  let prevHash: Hash | undefined;
  const result: { checkpoint: string; events: RawEvent[] }[] = [];

  for (const event of events) {
    if (prevHash === undefined || prevHash !== event.block.hash) {
      result.push({
        checkpoint: encodeCheckpoint({
          ...maxCheckpoint,
          blockTimestamp: Number(event.block.timestamp),
          chainId: BigInt(event.chainId),
          blockNumber: event.block.number,
        }),
        events: [],
      });
      prevHash = event.block.hash;
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

export async function* getLocalSyncGenerator(params: {
  common: Common;
  syncStore: SyncStore;
  network: Network;
  requestQueue: RequestQueue;
  sources: Source[];
  filters: Filter[];
  syncProgress: SyncProgress;
  historicalSync: HistoricalSync;
  onFatalError: (error: Error) => void;
}): AsyncGenerator<string> {
  const label = { network: params.network.name };

  // Invalidate sync cache for devnet sources
  if (params.network.disableCache) {
    params.common.logger.warn({
      service: "sync",
      msg: `Deleting cache records for '${params.network.name}' from block ${hexToNumber(params.syncProgress.start.number)}`,
    });

    await params.syncStore.pruneByChain({
      fromBlock: hexToNumber(params.syncProgress.start.number),
      chainId: params.network.chainId,
    });
  }

  const cached = await getCachedBlock({
    sources: params.sources,
    requestQueue: params.requestQueue,
    historicalSync: params.historicalSync,
  });

  params.syncProgress.current = cached;

  let cursor = hexToNumber(params.syncProgress.start.number);
  const last = getHistoricalLast(params.syncProgress);

  // Estimate optimal range (blocks) to sync at a time, eventually to be used to
  // determine `interval` passed to `historicalSync.sync()`.
  let estimateRange = 25;

  // Handle two special cases:
  // 1. `syncProgress.start` > `syncProgress.finalized`
  // 2. `cached` is defined

  if (
    hexToNumber(params.syncProgress.start.number) >
    hexToNumber(params.syncProgress.finalized.number)
  ) {
    params.syncProgress.current = params.syncProgress.finalized;

    params.common.logger.warn({
      service: "historical",
      msg: `Skipped historical sync for '${params.network.name}' because the start block is not finalized`,
    });

    params.common.metrics.ponder_sync_block.set(
      label,
      hexToNumber(params.syncProgress.current.number),
    );
    params.common.metrics.ponder_historical_total_blocks.set(label, 0);
    params.common.metrics.ponder_historical_cached_blocks.set(label, 0);

    return;
  }

  const totalInterval = [
    hexToNumber(params.syncProgress.start.number),
    hexToNumber(last.number),
  ] satisfies Interval;

  const requiredIntervals = Array.from(
    params.historicalSync.intervalsCache.entries(),
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

  params.common.metrics.ponder_historical_total_blocks.set(label, total);
  params.common.metrics.ponder_historical_cached_blocks.set(
    label,
    total - required,
  );

  params.common.logger.info({
    service: "historical",
    msg: `Started syncing '${params.network.name}' with ${formatPercentage(
      (total - required) / total,
    )} cached`,
  });

  // Handle cache hit
  if (cached !== undefined) {
    params.common.metrics.ponder_sync_block.set(
      label,
      hexToNumber(cached.number),
    );

    // `getEvents` can make progress without calling `sync`, so immediately "yield"
    yield encodeCheckpoint(
      blockToCheckpoint(cached, params.network.chainId, "up"),
    );

    if (hexToNumber(cached.number) === hexToNumber(last.number)) {
      params.common.logger.info({
        service: "historical",
        msg: `Skipped historical sync for '${params.network.name}' because all blocks are cached.`,
      });
      return;
    }

    cursor = hexToNumber(cached.number) + 1;
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

    const synced = await params.historicalSync.sync(interval);

    // Update cursor to record progress
    cursor = interval[1] + 1;

    // `synced` will be undefined if a cache hit occur in `historicalSync.sync()`.

    if (synced === undefined) {
      // If the all known blocks are synced, then update `syncProgress.current`, else
      // progress to the next iteration.
      if (interval[1] === hexToNumber(last.number)) {
        params.syncProgress.current = last;
      } else {
        continue;
      }
    } else {
      if (interval[1] === hexToNumber(last.number)) {
        params.syncProgress.current = last;
      } else {
        params.syncProgress.current = synced;
      }

      const duration = endClock();

      params.common.metrics.ponder_sync_block.set(
        label,
        hexToNumber(params.syncProgress.current.number),
      );
      params.common.metrics.ponder_historical_duration.observe(label, duration);
      params.common.metrics.ponder_historical_completed_blocks.inc(
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
    }

    yield encodeCheckpoint(
      blockToCheckpoint(
        params.syncProgress.current!,
        params.network.chainId,
        "up",
      ),
    );

    if (
      isSyncEnd(params.syncProgress) ||
      isSyncFinalized(params.syncProgress)
    ) {
      return;
    }
  }
}

export async function* getLocalEventGenerator(params: {
  syncStore: SyncStore;
  filters: Filter[];
  localSyncGenerator: AsyncGenerator<string>;
  from: string;
  to: string;
  batch: number;
}): AsyncGenerator<{
  events: RawEvent[];
  checkpoint: string;
}> {
  let cursor = params.from;
  // Estimate optimal range (seconds) to query at a time, eventually
  // used to determine `to` passed to `getEvents`.
  let estimateSeconds = 1_000;

  for await (const syncCheckpoint of getNonBlockingAsyncGenerator(
    params.localSyncGenerator,
  )) {
    while (cursor < min(syncCheckpoint, params.to)) {
      const to = min(
        syncCheckpoint,
        params.to,
        encodeCheckpoint({
          ...zeroCheckpoint,
          blockTimestamp: Math.min(
            decodeCheckpoint(cursor).blockTimestamp + estimateSeconds,
            maxCheckpoint.blockTimestamp,
          ),
        }),
      );
      // TODO(kyle) fix
      let consecutiveErrors = 0;
      try {
        const { events, cursor: queryCursor } =
          await params.syncStore.getEvents({
            filters: params.filters,
            from: cursor,
            to,
            limit: params.batch,
          });
        estimateSeconds = estimate({
          from: decodeCheckpoint(cursor).blockTimestamp,
          to: decodeCheckpoint(queryCursor).blockTimestamp,
          target: params.batch,
          result: events.length,
          min: 10,
          max: 86_400,
          prev: estimateSeconds,
          maxIncrease: 1.08,
        });
        cursor = queryCursor;
        yield { events, checkpoint: cursor };
      } catch (error) {
        // Handle errors by reducing the requested range by 10x
        estimateSeconds = Math.max(10, Math.round(estimateSeconds / 10));
        if (++consecutiveErrors > 4) throw error;
      }
    }
  }
}

export const getLocalSyncProgress = async ({
  common,
  sources,
  network,
  requestQueue,
}: {
  common: Common;
  sources: Source[];
  network: Network;
  requestQueue: RequestQueue;
}): Promise<SyncProgress> => {
  const syncProgress = {} as SyncProgress;

  const filters = sources.map(({ filter }) => filter);

  // Earliest `fromBlock` among all `filters`
  const start = Math.min(...filters.map((filter) => filter.fromBlock ?? 0));

  const diagnostics = await Promise.all([
    requestQueue.request({ method: "eth_chainId" }),
    _eth_getBlockByNumber(requestQueue, { blockNumber: start }),
    _eth_getBlockByNumber(requestQueue, { blockTag: "latest" }),
  ]);

  syncProgress.start = diagnostics[1];
  syncProgress.finalized = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: Math.max(
      0,
      hexToNumber(diagnostics[2].number) - network.finalityBlockCount,
    ),
  });

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

  if (end > hexToNumber(diagnostics[2].number)) {
    syncProgress.end = {
      number: toHex(end),
      hash: "0x",
      parentHash: "0x",
      timestamp: toHex(maxCheckpoint.blockTimestamp),
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
  sources,
  requestQueue,
  historicalSync,
}: {
  sources: Source[];
  requestQueue: RequestQueue;
  historicalSync: HistoricalSync;
}): Promise<SyncBlock | LightBlock> | undefined => {
  const latestCompletedBlocks = sources.map(({ filter }) => {
    const requiredInterval = [
      filter.fromBlock ?? 0,
      filter.toBlock ?? Number.POSITIVE_INFINITY,
    ] satisfies Interval;
    const fragmentIntervals = historicalSync.intervalsCache.get(filter)!;

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
  // `_latestCompletedBlocks[i]` is undefined but `sources[i].filter.fromBlock`
  // is > `_minCompletedBlock`.
  //
  if (
    latestCompletedBlocks.every(
      (block, i) =>
        block !== undefined ||
        (sources[i]!.filter.fromBlock ?? 0) > minCompletedBlock,
    )
  ) {
    return _eth_getBlockByNumber(requestQueue, {
      blockNumber: minCompletedBlock,
    });
  }

  return undefined;
};
