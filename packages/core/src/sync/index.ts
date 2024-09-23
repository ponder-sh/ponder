import type { Common } from "@/common/common.js";
import { getAppProgress } from "@/common/metrics.js";
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
import type { LightBlock, SyncBlock } from "@/types/sync.js";
import {
  type Checkpoint,
  checkpointMin,
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { estimate } from "@/utils/estimate.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import { mergeAsyncGenerators } from "@/utils/generators.js";
import {
  type Interval,
  intervalDifference,
  intervalIntersection,
  intervalSum,
  sortIntervals,
} from "@/utils/interval.js";
import { intervalUnion } from "@/utils/interval.js";
import { never } from "@/utils/never.js";
import { type RequestQueue, createRequestQueue } from "@/utils/requestQueue.js";
import { startClock } from "@/utils/timer.js";
import { createQueue } from "@ponder/common";
import { type Transport, hexToBigInt, hexToNumber } from "viem";
import { _eth_getBlockByNumber } from "../utils/rpc.js";
import type { RawEvent } from "./events.js";
import type { Source } from "./source.js";
import { cachedTransport } from "./transport.js";

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

export type SyncProgress = {
  start: SyncBlock | LightBlock;
  end: SyncBlock | LightBlock | undefined;
  cached: SyncBlock | undefined;
  current: SyncBlock | LightBlock | undefined;
  finalized: SyncBlock | LightBlock;
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

/**
 * Returns true if all filters have a defined end block and the current
 * sync progress has reached the final end block.
 */
export const isSyncComplete = (syncProgress: SyncProgress) => {
  if (syncProgress.end === undefined || syncProgress.current === undefined) {
    return false;
  }

  return (
    hexToNumber(syncProgress.current.number) >=
    hexToNumber(syncProgress.end.number)
  );
};

/** Returns the closest-to-tip block that is part of the historical sync. */
export const getHistoricalLast = (syncProgress: SyncProgress) => {
  return syncProgress.end === undefined
    ? syncProgress.finalized
    : hexToNumber(syncProgress.end.number) >
        hexToNumber(syncProgress.finalized.number)
      ? syncProgress.finalized
      : syncProgress.end;
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

  if (tag === "current" && isSyncComplete(syncProgress)) {
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

type CreateSyncParameters = {
  common: Common;
  syncStore: SyncStore;
  sources: Source[];
  networks: Network[];
  onRealtimeEvent(event: RealtimeEvent): Promise<void>;
  onFatalError(error: Error): void;
  initialCheckpoint: string;
};

export const createSync = async (args: CreateSyncParameters): Promise<Sync> => {
  const localSyncContext = new Map<
    Network,
    {
      requestQueue: RequestQueue;
      syncProgress: SyncProgress;
      historicalSync: HistoricalSync;
      realtimeSync: RealtimeSync;
    }
  >();
  const status: Status = {};
  let isKilled = false;

  // Instantiate `localSyncData` and `status`
  await Promise.all(
    args.networks.map(async (network) => {
      const requestQueue = createRequestQueue({
        network,
        common: args.common,
      });
      const sources = args.sources.filter(
        ({ filter }) => filter.chainId === network.chainId,
      );

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
      const cached = await getCachedBlock({
        sources,
        requestQueue,
        historicalSync,
      });

      // Update "ponder_sync_block" metric
      if (cached !== undefined) {
        args.common.metrics.ponder_sync_block.set(
          { network: network.name },
          hexToNumber(cached.number),
        );
      }

      const syncProgress: SyncProgress = {
        ...(await syncDiagnostic({
          common: args.common,
          sources,
          requestQueue,
          network,
        })),
        cached,
        current: cached,
      };

      args.common.metrics.ponder_sync_is_realtime.set(
        { network: network.name },
        0,
      );
      args.common.metrics.ponder_sync_is_complete.set(
        { network: network.name },
        0,
      );

      localSyncContext.set(network, {
        requestQueue,
        syncProgress,
        historicalSync,
        realtimeSync,
      });
      status[network.name] = { block: null, ready: false };
    }),
  );

  // Invalidate sync cache for devnet sources
  for (const network of args.networks) {
    if (network.disableCache) {
      const startBlock = hexToNumber(
        localSyncContext.get(network)!.syncProgress.start.number,
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
  const getOmnichainCheckpoint = (
    tag: "start" | "end" | "current" | "finalized",
  ): string | undefined => {
    const checkpoints = Array.from(localSyncContext.entries()).map(
      ([network, { syncProgress }]) =>
        getChainCheckpoint({ syncProgress, network, tag }),
    );

    if (tag === "end" && checkpoints.some((c) => c === undefined)) {
      return undefined;
    }

    if (tag === "current" && checkpoints.every((c) => c === undefined)) {
      return undefined;
    }

    return encodeCheckpoint(
      checkpointMin(
        ...checkpoints.map((c) => (c ? decodeCheckpoint(c) : maxCheckpoint)),
      ),
    );
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
    } else {
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
    }
  };

  const updateRealtimeStatus = ({
    checkpoint,
    network,
  }: {
    checkpoint: string;
    network: Network;
  }) => {
    const localBlock = localSyncContext
      .get(network)!
      .realtimeSync.localChain.findLast(
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

  /**
   * Estimate optimal range (seconds) to query at a time, eventually
   * used to determine `to` passed to `getEvents`
   */
  let estimateSeconds = 1_000;
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
    let latestFinalizedFetch = Date.now();

    /**
     * Calculate start checkpoint, if `initialCheckpoint` is non-zero,
     * use that. Otherwise, use `startBlock`
     */
    const start =
      args.initialCheckpoint !== encodeCheckpoint(zeroCheckpoint)
        ? args.initialCheckpoint
        : getOmnichainCheckpoint("start")!;

    // Cursor used to track progress.
    let from = start;

    let showLogs = true;
    while (true) {
      const syncGenerator = mergeAsyncGenerators(
        Array.from(localSyncContext.entries()).map(
          ([network, { syncProgress, historicalSync }]) =>
            localHistoricalSyncGenerator({
              common: args.common,
              network,
              syncProgress,
              historicalSync,
              showLogs,
            }),
        ),
      );

      // Only show logs on the first iteration
      showLogs = false;

      for await (const _ of syncGenerator) {
        /**
         * `current` is used to calculate the `to` checkpoint, if any
         * network hasn't yet ingested a block, run another iteration of this loop.
         * It is an invariant that `latestBlock` will eventually be defined.
         */
        if (
          Array.from(localSyncContext.values()).some(
            ({ syncProgress }) => syncProgress.current === undefined,
          )
        ) {
          continue;
        }

        /**
         * Calculate the mininum "current" checkpoint, falling back to `end` if
         * all networks have completed.
         *
         * `end`: If every network has an `endBlock` and it's less than
         * `finalized`, use that. Otherwise, use `finalized`
         */
        const end =
          getOmnichainCheckpoint("end") !== undefined &&
          getOmnichainCheckpoint("end")! < getOmnichainCheckpoint("finalized")!
            ? getOmnichainCheckpoint("end")!
            : getOmnichainCheckpoint("finalized")!;
        const to = getOmnichainCheckpoint("current") ?? end;

        /*
         * Extract events with `syncStore.getEvents()`, paginating to
         * avoid loading too many events into memory.
         */
        while (true) {
          if (isKilled) return;
          if (from >= to) break;
          const getEventsMaxBatchSize = args.common.options.syncEventsQuerySize;
          let consecutiveErrors = 0;

          // convert `estimateSeconds` to checkpoint
          const estimatedTo = encodeCheckpoint({
            ...zeroCheckpoint,
            blockTimestamp: Math.min(
              decodeCheckpoint(from).blockTimestamp + estimateSeconds,
              maxCheckpoint.blockTimestamp,
            ),
          });

          try {
            const { events, cursor } = await args.syncStore.getEvents({
              filters: args.sources.map(({ filter }) => filter),
              from,
              to: to < estimatedTo ? to : estimatedTo,
              limit: getEventsMaxBatchSize,
            });
            consecutiveErrors = 0;

            for (const network of args.networks) {
              updateHistoricalStatus({ events, checkpoint: cursor, network });
            }

            estimateSeconds = estimate({
              from: decodeCheckpoint(from).blockTimestamp,
              to: decodeCheckpoint(cursor).blockTimestamp,
              target: getEventsMaxBatchSize,
              result: events.length,
              min: 10,
              max: 86_400,
              prev: estimateSeconds,
              maxIncrease: 1.08,
            });

            yield { events, checkpoint: to };
            from = cursor;

            // underlying metrics collection is actually synchronous
            // https://github.com/siimon/prom-client/blob/master/lib/histogram.js#L102-L125
            const { eta, progress } = await getAppProgress(args.common.metrics);

            if (events.length > 0) {
              if (eta === undefined || progress === undefined) {
                args.common.logger.info({
                  service: "app",
                  msg: `Indexed ${events.length} events`,
                });
              } else {
                args.common.logger.info({
                  service: "app",
                  msg: `Indexed ${events.length} events with ${formatPercentage(progress)} complete and ${formatEta(eta)} remaining`,
                });
              }
            }
          } catch (error) {
            // Handle errors by reducing the requested range by 10x
            estimateSeconds = Math.max(10, Math.round(estimateSeconds / 10));
            if (++consecutiveErrors > 4) throw error;
          }
        }
      }

      /** `true` if all networks have synced all known finalized blocks.  */
      const allHistoricalSyncExhaustive = Array.from(
        localSyncContext.values(),
      ).every(({ syncProgress }) => {
        if (isSyncComplete(syncProgress)) return true;

        // Determine if `finalized` block is considered "stale"
        const staleSeconds = (Date.now() - latestFinalizedFetch) / 1_000;
        if (staleSeconds <= args.common.options.syncHandoffStaleSeconds) {
          return true;
        }

        return false;
      });

      if (allHistoricalSyncExhaustive) break;

      /** At least one network has a `finalized` block that is considered "stale". */

      latestFinalizedFetch = Date.now();

      await Promise.all(
        Array.from(localSyncContext.entries()).map(
          async ([network, { requestQueue, syncProgress }]) => {
            args.common.logger.debug({
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

            syncProgress.finalized = await _eth_getBlockByNumber(requestQueue, {
              blockNumber: finalizedBlockNumber,
            });

            const historicalLast = getHistoricalLast(syncProgress);

            // Set metric "ponder_historical_total_blocks"
            args.common.metrics.ponder_historical_total_blocks.set(
              { network: network.name },
              hexToNumber(historicalLast.number) -
                hexToNumber(syncProgress.start.number) +
                1,
            );
          },
        ),
      );
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
      const { syncProgress, realtimeSync } = localSyncContext.get(network)!;

      switch (event.type) {
        /**
         * Handle a new block being ingested.
         */
        case "block": {
          // Update local sync, record checkpoint before and after
          let from = getOmnichainCheckpoint("current")!;
          syncProgress.current = event.block;
          const to = getOmnichainCheckpoint("current")!;

          // Update "ponder_sync_block" metric
          args.common.metrics.ponder_sync_block.set(
            { network: network.name },
            hexToNumber(syncProgress.current.number),
          );

          // Add block, logs, transactions, receipts, and traces to the sync-store.

          const chainId = network.chainId;

          await Promise.all([
            args.syncStore.insertBlocks({
              blocks: event.filters.size === 0 ? [] : [event.block],
              chainId,
            }),
            args.syncStore.insertLogs({
              logs: event.logs.map((log) => ({ log, block: event.block })),
              shouldUpdateCheckpoint: true,
              chainId,
            }),
            args.syncStore.insertTransactions({
              transactions: event.transactions,
              chainId,
            }),
            args.syncStore.insertTransactionReceipts({
              transactionReceipts: event.transactionReceipts,
              chainId,
            }),
            args.syncStore.insertCallTraces({
              callTraces: event.callTraces.map((callTrace) => ({
                callTrace,
                block: event.block,
              })),
              chainId,
            }),
          ]);

          /*
           * Extract events with `syncStore.getEvents()`, paginating to
           * avoid loading too many events into memory.
           */
          while (true) {
            if (isKilled) return;
            if (from === to) break;
            const { events, cursor } = await args.syncStore.getEvents({
              filters: args.sources.map(({ filter }) => filter),
              from,
              to,
              limit: args.common.options.syncEventsQuerySize,
            });

            for (const network of args.networks) {
              updateRealtimeStatus({ checkpoint: cursor, network });
            }
            args
              .onRealtimeEvent({ type: "block", checkpoint: to, events })
              .then(() => {
                if (events.length > 0 && isKilled === false) {
                  args.common.logger.info({
                    service: "app",
                    msg: `Indexed ${events.length} events`,
                  });
                }
              });

            from = cursor;
          }

          break;
        }
        /**
         * Handle a new block being finalized.
         */
        case "finalize": {
          // Newly finalized range
          const interval = [
            hexToNumber(syncProgress.finalized.number),
            hexToNumber(event.block.number),
          ] satisfies Interval;

          // Update local sync, record checkpoint before and after
          const prev = getOmnichainCheckpoint("finalized")!;
          syncProgress.finalized = event.block;
          const checkpoint = getOmnichainCheckpoint("finalized")!;

          syncProgress.finalized = event.block;

          // Insert an interval for the newly finalized range.
          await Promise.all(
            args.sources
              .filter(({ filter }) => filter.chainId === network.chainId)
              .map(({ filter }) =>
                args.syncStore.insertInterval({ filter, interval }),
              ),
          );

          // Raise event to parent function (runtime)
          if (checkpoint > prev) {
            args.onRealtimeEvent({ type: "finalize", checkpoint });
          }

          /**
           * The realtime service can be killed if `endBlock` is
           * defined has become finalized.
           */
          if (isSyncComplete(syncProgress)) {
            args.common.metrics.ponder_sync_is_realtime.set(
              { network: network.name },
              0,
            );
            args.common.metrics.ponder_sync_is_complete.set(
              { network: network.name },
              1,
            );
            args.common.logger.info({
              service: "sync",
              msg: `Synced final end block for '${network.name}' (${hexToNumber(syncProgress.end!.number)}), killing realtime sync service`,
            });
            await realtimeSync.kill();
          }
          break;
        }
        /**
         * Handle a reorg with a new common ancestor block being found.
         */
        case "reorg": {
          syncProgress.current = event.block;
          const checkpoint = getOmnichainCheckpoint("current")!;

          // Update "ponder_sync_block" metric
          args.common.metrics.ponder_sync_block.set(
            { network: network.name },
            hexToNumber(syncProgress.current.number),
          );

          await args.syncStore.pruneByBlock({
            blocks: event.reorgedBlocks,
            chainId: network.chainId,
          });

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
        const { syncProgress, realtimeSync } = localSyncContext.get(network)!;

        status[network.name]!.block = {
          number: hexToNumber(syncProgress.current!.number),
          timestamp: hexToNumber(syncProgress.current!.timestamp),
        };
        status[network.name]!.ready = true;

        if (isSyncComplete(syncProgress)) {
          args.common.metrics.ponder_sync_is_complete.set(
            { network: network.name },
            1,
          );
        } else {
          args.common.metrics.ponder_sync_is_realtime.set(
            { network: network.name },
            1,
          );
          realtimeSync.start(syncProgress.finalized);
        }
      }
    },
    getStartCheckpoint() {
      return getOmnichainCheckpoint("start")!;
    },
    getFinalizedCheckpoint() {
      return getOmnichainCheckpoint("finalized")!;
    },
    getStatus() {
      return status;
    },
    getCachedTransport(network) {
      const { requestQueue } = localSyncContext.get(network)!;
      return cachedTransport({ requestQueue, syncStore: args.syncStore });
    },
    async kill() {
      isKilled = true;
      const promises: Promise<void>[] = [];
      for (const network of args.networks) {
        const { historicalSync, realtimeSync } = localSyncContext.get(network)!;
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
    : Math.max(...sources.map(({ filter }) => filter.toBlock!));

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

/** Returns the closest-to-tip block that has been synced for all `sources`. */
export const getCachedBlock = ({
  sources,
  requestQueue,
  historicalSync,
}: {
  sources: Source[];
  requestQueue: RequestQueue;
  historicalSync: HistoricalSync;
}): Promise<SyncBlock> | undefined => {
  const latestCompletedBlocks = sources.map(({ filter }) => {
    const requiredInterval = [
      filter.fromBlock,
      filter.toBlock ?? Number.POSITIVE_INFINITY,
    ] satisfies Interval;
    const cachedIntervals = historicalSync.intervalsCache.get(filter)!;

    const completedIntervals = sortIntervals(
      intervalIntersection([requiredInterval], cachedIntervals),
    );

    if (completedIntervals.length === 0) return undefined;

    const earliestCompletedInterval = completedIntervals[0]!;
    if (earliestCompletedInterval[0] !== filter.fromBlock) return undefined;
    return earliestCompletedInterval[1];
  });

  const minCompletedBlock = Math.min(
    ...(latestCompletedBlocks.filter(
      (block) => block !== undefined,
    ) as number[]),
  );

  /**  Filter i has known progress if a completed interval is found or if
   * `_latestCompletedBlocks[i]` is undefined but `sources[i].filter.fromBlock`
   * is > `_minCompletedBlock`.
   */
  if (
    latestCompletedBlocks.every(
      (block, i) =>
        block !== undefined || sources[i]!.filter.fromBlock > minCompletedBlock,
    )
  ) {
    return _eth_getBlockByNumber(requestQueue, {
      blockNumber: minCompletedBlock,
    });
  }

  return undefined;
};

/** Predictive pagination and metrics for `historicalSync.sync()` */
export async function* localHistoricalSyncGenerator({
  common,
  network,
  syncProgress,
  historicalSync,
  showLogs,
}: {
  common: Common;
  network: Network;
  syncProgress: SyncProgress;
  historicalSync: HistoricalSync;
  showLogs: boolean;
}): AsyncGenerator {
  // Return immediately if the `syncProgress.start` is unfinalized
  if (
    hexToNumber(syncProgress.start.number) >
    hexToNumber(syncProgress.finalized.number)
  ) {
    syncProgress.current = syncProgress.finalized;

    // Update "ponder_sync_block" metric
    common.metrics.ponder_sync_block.set(
      { network: network.name },
      hexToNumber(syncProgress.current.number),
    );

    if (showLogs) {
      common.logger.warn({
        service: "historical",
        msg: `Skipped historical sync for '${network.name}' because the start block is not finalized`,
      });
    }

    const label = { network: network.name };
    // Set "ponder_historical_total_blocks"
    common.metrics.ponder_historical_total_blocks.set(label, 0);
    // Set "ponder_historical_sync_cached_blocks"
    common.metrics.ponder_historical_cached_blocks.set(label, 0);

    return;
  }

  const historicalLast = getHistoricalLast(syncProgress);

  // Intialize metrics

  const totalInterval = [
    hexToNumber(syncProgress.start.number),
    hexToNumber(historicalLast.number),
  ] satisfies Interval;

  const requiredIntervals = Array.from(
    historicalSync.intervalsCache.entries(),
  ).flatMap(([filter, interval]) =>
    intervalDifference(
      [
        [
          filter.fromBlock,
          Math.min(
            filter.toBlock ?? Number.POSITIVE_INFINITY,
            totalInterval[1],
          ),
        ],
      ],
      interval,
    ),
  );

  const required = intervalSum(intervalUnion(requiredIntervals));

  const total = totalInterval[1] - totalInterval[0] + 1;

  const label = { network: network.name };
  // Set "ponder_historical_total_blocks"
  common.metrics.ponder_historical_total_blocks.set(label, total);
  // Set "ponder_historical_sync_cached_blocks"
  common.metrics.ponder_historical_cached_blocks.set(label, total - required);

  if (showLogs) {
    common.logger.info({
      service: "historical",
      msg: `Started syncing '${network.name}' with ${formatPercentage(
        (total - required) / total,
      )} cached`,
    });
  }

  /**
   * Estimate optimal range (blocks) to sync at a time, eventually to be used to
   * determine `interval` passed to `historicalSync.sync()`.
   */
  let estimateRange = 25;
  // Cursor to track progress.
  let fromBlock = hexToNumber(syncProgress.start.number);

  // Handle a cache hit by fast forwarding and potentially exiting
  if (syncProgress.cached !== undefined) {
    // `getEvents` can make progress without calling `sync`, so immediately "yield"
    yield;

    if (
      hexToNumber(syncProgress.cached.number) ===
      hexToNumber(historicalLast.number)
    ) {
      if (showLogs) {
        common.logger.info({
          service: "historical",
          msg: `Skipped historical sync for '${network.name}' because all blocks are cached.`,
        });
      }
      return;
    }

    fromBlock = hexToNumber(syncProgress.cached.number) + 1;
  }

  while (true) {
    /**
     * Select a range of blocks to sync bounded by `finalizedBlock`.
     *
     * It is important for devEx that the interval is not too large, because
     * time spent syncing ≈ time before indexing function feedback.
     */
    const interval: Interval = [
      fromBlock,
      Math.min(fromBlock + estimateRange, hexToNumber(historicalLast.number)),
    ];

    const endClock = startClock();

    const syncBlock = await historicalSync.sync(interval);

    // Update cursor to record progress
    fromBlock = interval[1] + 1;

    if (syncBlock === undefined) {
      /**
       * `syncBlock` will be undefined if a cache hit occur in `historicalSync.sync()`.
       * If the all known blocks are synced, then update `syncProgress.current`, else
       * progress to the next iteration.
       */
      if (interval[1] === hexToNumber(historicalLast.number)) {
        syncProgress.current = historicalLast;
      } else {
        continue;
      }
    } else {
      if (interval[1] === hexToNumber(historicalLast.number)) {
        syncProgress.current = historicalLast;
      } else {
        syncProgress.current = syncBlock;
      }

      const duration = endClock();

      // Update "ponder_sync_block" metric
      common.metrics.ponder_sync_block.set(
        { network: network.name },
        hexToNumber(syncProgress.current.number),
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

    yield;

    if (
      isSyncComplete(syncProgress) ||
      hexToNumber(syncProgress.finalized.number) ===
        hexToNumber(syncProgress.current.number)
    ) {
      return;
    }
  }
}
