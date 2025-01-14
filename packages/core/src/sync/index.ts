import type { Common } from "@/internal/common.js";
import type {
  Factory,
  Filter,
  IndexingBuild,
  Network,
  RawEvent,
  Source,
  Status,
} from "@/internal/types.js";
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
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { estimate } from "@/utils/estimate.js";
import { formatPercentage } from "@/utils/format.js";
import {
  bufferAsyncGenerator,
  getNonBlockingAsyncGenerator,
} from "@/utils/generators.js";
import {
  type Interval,
  intervalDifference,
  intervalIntersection,
  intervalIntersectionMany,
  intervalSum,
  sortIntervals,
} from "@/utils/interval.js";
import { intervalUnion } from "@/utils/interval.js";
import { never } from "@/utils/never.js";
import { type RequestQueue, createRequestQueue } from "@/utils/requestQueue.js";
import { startClock } from "@/utils/timer.js";
import {
  type Address,
  type Hash,
  type Transport,
  hexToBigInt,
  hexToNumber,
  toHex,
} from "viem";
import { _eth_getBlockByNumber } from "../utils/rpc.js";
import { buildEvents } from "./events.js";
import { isAddressFactory } from "./filter.js";
import { cachedTransport } from "./transport.js";

export type Sync = {
  getEvents(): AsyncGenerator<{ events: RawEvent[]; checkpoint: string }>;
  startRealtime(): Promise<void>;
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
const isSyncEnd = (syncProgress: SyncProgress) => {
  if (syncProgress.end === undefined || syncProgress.current === undefined) {
    return false;
  }

  return (
    hexToNumber(syncProgress.current.number) >=
    hexToNumber(syncProgress.end.number)
  );
};

/** Returns true if sync progress has reached the finalized block. */
const isSyncFinalized = (syncProgress: SyncProgress) => {
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

/** Compute the minimum checkpoint, filtering out undefined */
const min = (...checkpoints: (string | undefined)[]) => {
  return checkpoints.reduce((acc, cur) => {
    if (cur === undefined) return acc;
    if (acc === undefined) return cur;
    if (acc < cur) return acc;
    return cur;
  })!;
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

type CreateSyncParameters = {
  common: Common;
  indexingBuild: Pick<IndexingBuild, "sources" | "networks">;
  syncStore: SyncStore;
  onRealtimeEvent(event: RealtimeEvent): Promise<void>;
  onFatalError(error: Error): void;
  initialCheckpoint: string;
};

export const createSync = async (args: CreateSyncParameters): Promise<Sync> => {
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
  /** Events that have been executed but not finalized. */
  let executedEvents: RawEvent[] = [];
  /** Events that have not been executed yet. */
  let pendingEvents: RawEvent[] = [];
  const status: Status = {};
  let isKilled = false;
  // Realtime events across all chains that can't be passed to the parent function
  // because the overall checkpoint hasn't caught up to the events yet.

  // Instantiate `perNetworkSync` and `status`
  await Promise.all(
    args.indexingBuild.networks.map(async (network) => {
      const requestQueue = createRequestQueue({ network, common: args.common });
      const sources = args.indexingBuild.sources.filter(
        ({ filter }) => filter.chainId === network.chainId,
      );

      const syncProgress = await getLocalSyncProgress({
        common: args.common,
        network,
        sources,
        requestQueue,
      });
      const historicalSync = await createHistoricalSync({
        common: args.common,
        sources,
        syncStore: args.syncStore,
        requestQueue,
        network,
        onFatalError: args.onFatalError,
      });
      const realtimeSync = createRealtimeSync({
        common: args.common,
        sources,
        requestQueue,
        network,
        onEvent: (event) =>
          onRealtimeSyncEvent({ event, network }).catch((error) => {
            args.common.logger.error({
              service: "sync",
              msg: `Fatal error: Unable to process ${event.type} event`,
              error,
            });
            args.onFatalError(error);
          }),
        onFatalError: args.onFatalError,
      });

      args.common.metrics.ponder_sync_is_realtime.set(
        { network: network.name },
        0,
      );
      args.common.metrics.ponder_sync_is_complete.set(
        { network: network.name },
        0,
      );

      status[network.chainId] = { block: null, ready: false };

      perNetworkSync.set(network, {
        requestQueue,
        syncProgress,
        historicalSync,
        realtimeSync,
        unfinalizedBlocks: [],
      });
    }),
  );

  /**
   * Returns the minimum checkpoint across all chains.
   */
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
    let cursor: string;
    const to = min(
      getOmnichainCheckpoint("end"),
      getOmnichainCheckpoint("finalized"),
    );

    const eventGenerators = Array.from(perNetworkSync.entries()).map(
      ([network, { requestQueue, syncProgress, historicalSync }]) => {
        const sources = args.indexingBuild.sources.filter(
          ({ filter }) => filter.chainId === network.chainId,
        );
        const filters = sources.map(({ filter }) => filter);

        const localSyncGenerator = getLocalSyncGenerator({
          common: args.common,
          syncStore: args.syncStore,
          network,
          requestQueue,
          sources,
          filters,
          syncProgress,
          historicalSync,
          onFatalError: args.onFatalError,
        });

        const localEventGenerator = getLocalEventGenerator({
          syncStore: args.syncStore,
          filters,
          localSyncGenerator,
          from:
            args.initialCheckpoint !== encodeCheckpoint(zeroCheckpoint)
              ? args.initialCheckpoint
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

      let events: RawEvent[] = [];

      for (const res of eventResults) {
        if (res.done === false) {
          events.push(
            // TODO(kyle) use binary search to find index of supremum
            ...res.value.events.filter(
              (event) =>
                (cursor === undefined ? true : event.checkpoint > cursor) &&
                event.checkpoint <= supremum,
            ),
          );
        }
      }

      // TODO(kyle) use zipper merge function
      events = events.sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));

      const index = eventResults.findIndex(
        (res) => res.done === false && res.value.checkpoint === supremum,
      );
      eventResults[index] = await eventGenerators[index]!.next();

      for (const network of args.indexingBuild.networks) {
        updateHistoricalStatus({ events, checkpoint: supremum, network });
      }

      cursor = supremum;
      // NOTE: `checkpoint` is only used for metrics, and therefore should reflect the furthest
      // known checkpoint.
      yield { events, checkpoint: to };
    }
  }

  /**
   * Omnichain `onRealtimeSyncEvent`
   *
   * Handle callback events across all `args.networks`, and raising these
   * events to `args.onRealtimeEvent` while maintaining checkpoint ordering.
   */
  const onRealtimeSyncEvent = async ({
    network,
    event,
  }: { network: Network; event: RealtimeSyncEvent }) => {
    const { syncProgress, realtimeSync, unfinalizedBlocks } =
      perNetworkSync.get(network)!;

    switch (event.type) {
      /**
       * Handle a new block being ingested.
       */
      case "block": {
        // Update local sync, record checkpoint before and after
        const from = getOmnichainCheckpoint("current")!;
        syncProgress.current = event.block;
        const to = getOmnichainCheckpoint("current")!;

        // Update "ponder_sync_block" metric
        args.common.metrics.ponder_sync_block.set(
          { network: network.name },
          hexToNumber(syncProgress.current.number),
        );

        const newEvents = buildEvents({
          sources: args.indexingBuild.sources,
          chainId: network.chainId,
          blockWithEventData: event,
          finalizedChildAddresses: realtimeSync.finalizedChildAddresses,
          unfinalizedChildAddresses: realtimeSync.unfinalizedChildAddresses,
        });

        unfinalizedBlocks.push(event);
        pendingEvents.push(...newEvents);

        if (to > from) {
          for (const network of args.indexingBuild.networks) {
            updateRealtimeStatus({ checkpoint: to, network });
          }

          // Move events from pending to executed

          const events = pendingEvents
            .filter((event) => event.checkpoint < to)
            .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));

          pendingEvents = pendingEvents.filter(
            ({ checkpoint }) => checkpoint > to,
          );
          executedEvents.push(...events);

          args
            .onRealtimeEvent({
              type: "block",
              checkpoint: to,
              status: structuredClone(status),
              events,
            })
            .then(() => {
              if (events.length > 0 && isKilled === false) {
                args.common.logger.info({
                  service: "app",
                  msg: `Indexed ${events.length} events`,
                });
              }
            });
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

        // Raise event to parent function (runtime)
        if (checkpoint > prev) {
          args.onRealtimeEvent({ type: "finalize", checkpoint });
        }

        if (
          getChainCheckpoint({ syncProgress, network, tag: "finalized" })! >
          getOmnichainCheckpoint("current")!
        ) {
          args.common.logger.warn({
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
          args.syncStore.insertBlocks({
            blocks: finalizedBlocks
              .filter(({ hasMatchedFilter }) => hasMatchedFilter)
              .map(({ block }) => block),
            chainId: network.chainId,
          }),
          args.syncStore.insertLogs({
            logs: finalizedBlocks.flatMap(({ logs, block }) =>
              logs.map((log) => ({ log, block })),
            ),
            shouldUpdateCheckpoint: true,
            chainId: network.chainId,
          }),
          args.syncStore.insertLogs({
            logs: finalizedBlocks.flatMap(({ factoryLogs }) =>
              factoryLogs.map((log) => ({ log })),
            ),
            shouldUpdateCheckpoint: false,
            chainId: network.chainId,
          }),
          args.syncStore.insertTransactions({
            transactions: finalizedBlocks.flatMap(({ transactions, block }) =>
              transactions.map((transaction) => ({
                transaction,
                block,
              })),
            ),
            chainId: network.chainId,
          }),
          args.syncStore.insertTransactionReceipts({
            transactionReceipts: finalizedBlocks.flatMap(
              ({ transactionReceipts }) => transactionReceipts,
            ),
            chainId: network.chainId,
          }),
          args.syncStore.insertTraces({
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
          await args.syncStore.insertIntervals({
            intervals: args.indexingBuild.sources
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
          realtimeSync.kill();
        }
        break;
      }
      /**
       * Handle a reorg with a new common ancestor block being found.
       */
      case "reorg": {
        syncProgress.current = event.block;
        // Note: this checkpoint is <= the previous checkpoint
        const checkpoint = getOmnichainCheckpoint("current")!;

        // Update "ponder_sync_block" metric
        args.common.metrics.ponder_sync_block.set(
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

        await args.syncStore.pruneRpcRequestResult({
          chainId: network.chainId,
          blocks: event.reorgedBlocks,
        });

        // Raise event to parent function (runtime)
        args.onRealtimeEvent({ type: "reorg", checkpoint });

        break;
      }

      default:
        never(event);
    }
  };

  return {
    getEvents,
    async startRealtime() {
      for (const network of args.indexingBuild.networks) {
        const { syncProgress, realtimeSync } = perNetworkSync.get(network)!;

        const filters = args.indexingBuild.sources
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
          const events = await args.syncStore.getEvents({ filters, from, to });
          pendingEvents.push(...events.events);
        }

        if (isSyncEnd(syncProgress)) {
          args.common.metrics.ponder_sync_is_complete.set(
            { network: network.name },
            1,
          );
        } else {
          args.common.metrics.ponder_sync_is_realtime.set(
            { network: network.name },
            1,
          );

          const initialChildAddresses = new Map<Factory, Set<Address>>();

          for (const filter of filters) {
            if ("address" in filter && isAddressFactory(filter.address)) {
              const addresses = await args.syncStore.getChildAddresses({
                filter: filter.address,
              });

              initialChildAddresses.set(filter.address, new Set(addresses));
            }
          }

          realtimeSync.start({ syncProgress, initialChildAddresses });
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
      const { requestQueue } = perNetworkSync.get(network)!;
      return cachedTransport({ requestQueue, syncStore: args.syncStore });
    },
    async kill() {
      isKilled = true;
      const promises: Promise<void>[] = [];
      for (const network of args.indexingBuild.networks) {
        const { historicalSync, realtimeSync } = perNetworkSync.get(network)!;
        historicalSync.kill();
        promises.push(realtimeSync.kill());
      }
      await Promise.all(promises);
    },
  };
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
