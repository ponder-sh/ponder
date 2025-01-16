import type { Common } from "@/internal/common.js";
import type {
  Filter,
  Network,
  RawEvent,
  Source,
  Status,
} from "@/internal/types.js";
import type { HistoricalSync } from "@/sync-historical/index.js";
import type { RealtimeSync, RealtimeSyncEvent } from "@/sync-realtime/index.js";
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
import { bufferAsyncGenerator } from "@/utils/generators.js";
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
  getFinalizedCheckpoint(): string;
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

export const getRealtimeSyncEventHandler = ({
  common,
  network,
  sources,
  syncStore,
  syncProgress,
  realtimeSync,
}: {
  common: Common;
  network: Network;
  sources: Source[];
  syncStore: SyncStore;
  syncProgress: SyncProgress;
  realtimeSync: RealtimeSync;
}) => {
  let unfinalizedBlocks: Omit<
    Extract<RealtimeSyncEvent, { type: "block" }>,
    "type"
  >[] = [];

  return async (event: RealtimeSyncEvent): Promise<RealtimeSyncEvent> => {
    switch (event.type) {
      case "block": {
        syncProgress.current = event.block;

        common.metrics.ponder_sync_block.set(
          { network: network.name },
          hexToNumber(syncProgress.current.number),
        );

        unfinalizedBlocks.push(event);

        return event;
      }

      case "finalize": {
        // Newly finalized range
        const finalizedInterval = [
          hexToNumber(syncProgress.finalized.number),
          hexToNumber(event.block.number),
        ] satisfies Interval;

        syncProgress.finalized = event.block;

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

        // The realtime service can be killed if `endBlock` is
        // defined has become finalized.

        if (isSyncFinalized(syncProgress) && isSyncEnd(syncProgress)) {
          common.metrics.ponder_sync_is_realtime.set(
            { network: network.name },
            0,
          );
          common.metrics.ponder_sync_is_complete.set(
            { network: network.name },
            1,
          );
          common.logger.info({
            service: "sync",
            msg: `Synced final end block for '${network.name}' (${hexToNumber(syncProgress.end!.number)}), killing realtime sync service`,
          });
          realtimeSync.kill();
        }

        return event;
      }

      case "reorg": {
        syncProgress.current = event.block;

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

  for await (const syncCheckpoint of bufferAsyncGenerator(
    params.localSyncGenerator,
    Number.POSITIVE_INFINITY,
  )) {
    let consecutiveErrors = 0;
    while (cursor < min(syncCheckpoint, params.to)) {
      const estimateCheckpoint = encodeCheckpoint({
        ...zeroCheckpoint,
        blockTimestamp: Math.min(
          decodeCheckpoint(cursor).blockTimestamp + estimateSeconds,
          maxCheckpoint.blockTimestamp,
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
        consecutiveErrors = 0;
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
      service: "historical",
      msg: `Skipped historical sync for '${network.name}' because the start block is not finalized`,
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

  common.logger.info({
    service: "historical",
    msg: `Started syncing '${network.name}' with ${formatPercentage(
      (total - required) / total,
    )} cached`,
  });

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
        service: "historical",
        msg: `Skipped historical sync for '${network.name}' because all blocks are cached.`,
      });
      return;
    }

    cursor = hexToNumber(syncProgress.current.number) + 1;
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
    }

    yield encodeCheckpoint(
      blockToCheckpoint(syncProgress.current!, network.chainId, "up"),
    );

    if (isSyncEnd(syncProgress) || isSyncFinalized(syncProgress)) {
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
