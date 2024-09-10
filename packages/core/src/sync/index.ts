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
import type { LightBlock, SyncBlock } from "@/types/sync.js";
import {
  type Checkpoint,
  checkpointMin,
  decodeCheckpoint,
  encodeCheckpoint,
  isCheckpointEqual,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { estimate } from "@/utils/estimate.js";
import { mergeAsyncGenerators } from "@/utils/generators.js";
import type { Interval } from "@/utils/interval.js";
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

// type RawBlockEvent = Omit<
//   Extract<RealtimeSyncEvent, { type: "block" }>,
//   "type"
// >;

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
  if (blockProgress.end === undefined || blockProgress.latest === undefined) {
    return false;
  }

  return (
    hexToNumber(blockProgress.latest.number) >=
    hexToNumber(blockProgress.end.number)
  );
};

/** Returns the checkpoint for a given block tag. */
export const getChainCheckpoint = ({
  blockProgress,
  network,
  tag,
}: {
  blockProgress: BlockProgress;
  network: Network;
  tag: "start" | "latest" | "finalized" | "end";
}): string | undefined => {
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

type CreateSyncParameters = {
  common: Common;
  syncStore: SyncStore;
  sources: Source[];
  networks: Network[];
  onRealtimeEvent(event: RealtimeEvent): void;
  onFatalError(error: Error): void;
  initialCheckpoint: Checkpoint;
};

export const createSync = async (args: CreateSyncParameters): Promise<Sync> => {
  const localSyncData = new Map<
    Network,
    {
      requestQueue: RequestQueue;
      blockProgress: BlockProgress;
      historicalSync: HistoricalSync;
      realtimeSync: RealtimeSync;
      /**
       * Unfinalized raw events.
       *
       * It is an invariant that all blocks are linked to each other,
       * `block.parentHash` => `block.hash`.
       */
      // rawEvents: RawBlockEvent[];
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

      historicalSync.initializeMetrics(
        blockProgress.finalized as SyncBlock,
        true,
      );

      localSyncData.set(network, {
        requestQueue,
        blockProgress,
        historicalSync,
        realtimeSync,
        // rawEvents: [],
      });
      status[network.name] = { block: null, ready: false };
    }),
  );

  // Invalidate sync cache for devnet sources
  for (const network of args.networks) {
    if (network.disableCache) {
      const startBlock = hexToNumber(
        localSyncData.get(network)!.blockProgress.start.number,
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
    const checkpoints = Array.from(localSyncData.entries()).map(
      ([network, { blockProgress }]) =>
        getChainCheckpoint({ blockProgress, network, tag }),
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
    // rawEvents,
    network,
  }: {
    checkpoint: string;
    // rawEvents: RawBlockEvent[];
    network: Network;
  }) => {
    const localBlock = localSyncData
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
      isCheckpointEqual(args.initialCheckpoint, zeroCheckpoint) === false
        ? encodeCheckpoint(args.initialCheckpoint)
        : getChainsCheckpoint("start")!;

    // Cursor used to track progress.
    let from = start;

    while (true) {
      const syncGenerator = mergeAsyncGenerators(
        Array.from(localSyncData.values()).map(
          ({ blockProgress, historicalSync }) =>
            localHistoricalSyncHelper({
              blockProgress,
              historicalSync,
            }),
        ),
      );

      for await (const _ of syncGenerator) {
        /**
         * `latest` is used to calculate the `to` checkpoint, if any
         * network hasn't yet ingested a block, run another iteration of this loop.
         * It is an invariant that `latestBlock` will eventually be defined. See the
         * implementation of `LocalSync.latestBlock` for more detail.
         */
        if (
          Array.from(localSyncData.values()).some(
            ({ blockProgress }) => blockProgress.latest === undefined,
          )
        ) {
          continue;
        }

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
          if (from === to) break;
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
              updateStatus({ events, checkpoint: cursor, network });
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
          } catch (error) {
            // Handle errors by reducing the requested range by 10x
            estimateSeconds = Math.max(10, Math.round(estimateSeconds / 10));
            if (++consecutiveErrors > 4) throw error;
          }
        }
      }

      /** `true` if all networks have synced all known finalized blocks.  */
      const allHistoricalSyncExhaustive = Array.from(
        localSyncData.values(),
      ).every(({ blockProgress }) => {
        if (isSyncExhaustive(blockProgress)) return true;

        // Determine if `finalized` block is considered "stale"
        const staleSeconds = (Date.now() - latestFinalizedFetch) / 1_000;
        if (staleSeconds <= args.common.options.syncHandoffStaleSeconds) {
          return true;
        }

        return false;
      });

      if (allHistoricalSyncExhaustive) break;

      /**
       * At least one network has a `finalized` block that is considered "stale".
       */

      latestFinalizedFetch = Date.now();

      await Promise.all(
        Array.from(localSyncData.entries()).map(
          async ([
            network,
            { requestQueue, blockProgress, historicalSync },
          ]) => {
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

            blockProgress.finalized = await _eth_getBlockByNumber(
              requestQueue,
              {
                blockNumber: finalizedBlockNumber,
              },
            );

            historicalSync.initializeMetrics(
              blockProgress.finalized as SyncBlock,
              false,
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
      const { blockProgress, realtimeSync } = localSyncData.get(network)!;

      switch (event.type) {
        /**
         * Handle a new block being ingested.
         */
        case "block": {
          // Update local sync, record checkpoint before and after
          let from = getChainsCheckpoint("latest")!;
          blockProgress.latest = event.block;
          const to = getChainsCheckpoint("latest")!;

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
            args.onRealtimeEvent({ type: "block", checkpoint: to, events });

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
            hexToNumber(blockProgress.finalized.number),
            hexToNumber(event.block.number),
          ] satisfies Interval;

          // Update local sync, record checkpoint before and after
          const prev = getChainsCheckpoint("finalized")!;
          blockProgress.finalized = event.block;
          const checkpoint = getChainsCheckpoint("finalized")!;

          blockProgress.finalized = event.block;

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
          if (isSyncExhaustive(blockProgress)) {
            args.common.metrics.ponder_realtime_is_connected.set(
              { network: network.name },
              0,
            );
            args.common.logger.info({
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
          blockProgress.latest = event.block;
          const checkpoint = getChainsCheckpoint("latest")!;

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
        const { blockProgress, realtimeSync } = localSyncData.get(network)!;

        status[network.name]!.block = {
          number: hexToNumber(blockProgress.latest!.number),
          timestamp: hexToNumber(blockProgress.latest!.timestamp),
        };
        status[network.name]!.ready = true;

        if (isSyncExhaustive(blockProgress) === false) {
          args.common.metrics.ponder_realtime_is_connected.set(
            { network: network.name },
            1,
          );
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
      const { requestQueue } = localSyncData.get(network)!;
      return cachedTransport({ requestQueue, syncStore: args.syncStore });
    },
    async kill() {
      isKilled = true;
      const promises: Promise<void>[] = [];
      for (const network of args.networks) {
        const { historicalSync, realtimeSync } = localSyncData.get(network)!;
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
  blockProgress,
  historicalSync,
}: {
  blockProgress: BlockProgress;
  historicalSync: HistoricalSync;
}): AsyncGenerator {
  /**
   * Estimate optimal range (blocks) to sync at a time, eventually to be used to
   * determine `interval` passed to `historicalSync.sync()`.
   */
  let estimateRange = 25;
  // Cursor to track progress.
  let fromBlock = hexToNumber(blockProgress.start.number);
  // Attempt move the `fromBlock` forward if `historicalSync.latestBlock`
  // is defined (a cache hit has occurred)
  if (historicalSync.latestBlock !== undefined) {
    fromBlock = Math.min(
      hexToNumber(historicalSync.latestBlock.number) + 1,
      hexToNumber(blockProgress.finalized.number),
      blockProgress.end
        ? hexToNumber(blockProgress.end.number)
        : Number.POSITIVE_INFINITY,
    );
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

    blockProgress.latest = historicalSync.latestBlock;
    if (blockProgress.latest === undefined) continue;

    yield;

    if (
      isSyncExhaustive(blockProgress) ||
      hexToNumber(blockProgress.finalized.number) ===
        hexToNumber(blockProgress.latest.number)
    ) {
      return;
    }
  }
}
