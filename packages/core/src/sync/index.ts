import type { Common } from "@/common/common.js";
import { getAppProgress } from "@/common/metrics.js";
import type { Network } from "@/config/networks.js";
import {
  type HistoricalSync,
  createHistoricalSync,
} from "@/sync-historical/index.js";
import {
  type BlockWithEventData,
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
import { formatEta, formatPercentage } from "@/utils/format.js";
import {
  bufferAsyncGenerator,
  getNonBlockingAsyncGenerator,
} from "@/utils/generators.js";
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
import {
  type Address,
  type Hash,
  type Transport,
  hexToBigInt,
  hexToNumber,
} from "viem";
import { _eth_getBlockByNumber } from "../utils/rpc.js";
import { type RawEvent, buildEvents } from "./events.js";
import {
  type Factory,
  type Filter,
  type Source,
  isAddressFactory,
} from "./source.js";
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

export type Status = {
  [networkName: string]: {
    block: { number: number; timestamp: number } | null;
    ready: boolean;
  };
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

export const splitEvents = (events: RawEvent[]): RawEvent[][] => {
  let prevHash: Hash | undefined;
  const result: RawEvent[][] = [];

  for (const event of events) {
    if (prevHash === undefined || prevHash !== event.block.hash) {
      result.push([]);
      prevHash = event.block.hash;
    }

    result[result.length - 1]!.push(event);
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
      unfinalizedEventData: BlockWithEventData[];
    }
  >();
  const status: Status = {};
  let isKilled = false;
  // Realtime events across all chains that can't be passed to the parent function
  // because the overall checkpoint hasn't caught up to the events yet.
  let pendingEvents: RawEvent[] = [];

  await Promise.all(
    args.networks.map(async (network) => {
      const requestQueue = createRequestQueue({ network, common: args.common });
      const sources = args.sources.filter(
        ({ filter }) => filter.chainId === network.chainId,
      );

      const syncProgress = await getLocalSyncProgress({
        common: args.common,
        network,
        requestQueue,
        sources,
      });

      const historicalSync = await createHistoricalSync({
        common: args.common,
        sources,
        syncStore: args.syncStore,
        requestQueue: requestQueue,
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

      status[network.name] = { block: null, ready: false };

      localSyncContext.set(network, {
        requestQueue,
        syncProgress,
        historicalSync,
        realtimeSync,
        unfinalizedEventData: [],
      });
    }),
  );

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

    return min(...checkpoints);
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
      .realtimeSync.unfinalizedBlocks.findLast(
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
   * Omnichain `getEvents`
   *
   * Extract all events across `args.networks` ordered by checkpoint.
   * The generator is "completed" when all event have been extracted
   * before the minimum finalized checkpoint (supremum).
   */
  async function* getEvents() {
    let cursor: string;

    const to = min(
      getOmnichainCheckpoint("end"),
      getOmnichainCheckpoint("finalized"),
    );

    const eventGenerators = Array.from(localSyncContext.entries()).map(
      ([network, { requestQueue, syncProgress, historicalSync }]) => {
        const sources = args.sources.filter(
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
            ...res.value.events.filter(
              (event) =>
                (cursor === undefined ? true : event.checkpoint > cursor) &&
                event.checkpoint <= supremum,
            ),
          );
        }
      }

      events = events.sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));

      const index = eventResults.findIndex(
        (res) => res.done === false && res.value.checkpoint === supremum,
      );
      eventResults[index] = await eventGenerators[index]!.next();

      for (const network of args.networks) {
        updateHistoricalStatus({ events, checkpoint: supremum, network });
      }

      cursor = supremum;
      // NOTE: `checkpoint` is only used for metrics, and therefore should reflect the furthest
      // know checkpoint.
      yield { events, checkpoint: to };

      // Underlying metrics collection is actually synchronous.
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
    const { syncProgress, realtimeSync, unfinalizedEventData } =
      localSyncContext.get(network)!;

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

        const blockWithEventData = {
          block: event.block,
          filters: event.filters,
          logs: event.logs,
          factoryLogs: event.factoryLogs,
          callTraces: event.callTraces,
          transactions: event.transactions,
          transactionReceipts: event.transactionReceipts,
        };

        unfinalizedEventData.push(blockWithEventData);

        const events = buildEvents({
          sources: args.sources,
          chainId: network.chainId,
          blockWithEventData,
          finalizedChildAddresses: realtimeSync.finalizedChildAddresses,
          unfinalizedChildAddresses: realtimeSync.unfinalizedChildAddresses,
        });

        pendingEvents.push(...events);

        if (to > from) {
          for (const network of args.networks) {
            updateRealtimeStatus({ checkpoint: to, network });
          }

          const events = pendingEvents
            .filter(({ checkpoint }) => checkpoint <= to)
            .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));

          pendingEvents = pendingEvents.filter(
            ({ checkpoint }) => checkpoint > to,
          );

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

        const finalizedEventData = unfinalizedEventData.filter(
          (ued) =>
            hexToNumber(ued.block.number) <= hexToNumber(event.block.number),
        );

        localSyncContext.get(network)!.unfinalizedEventData =
          unfinalizedEventData.filter(
            (ued) =>
              hexToNumber(ued.block.number) > hexToNumber(event.block.number),
          );

        if (
          getChainCheckpoint({ syncProgress, network, tag: "finalized" })! >
          getOmnichainCheckpoint("current")!
        ) {
          args.common.logger.warn({
            service: "sync",
            msg: `Finalized block for '${network.name}' has surpassed overall indexing checkpoint`,
          });
        }

        // Add finalized blocks, logs, transactions, receipts, and traces to the sync-store.

        await Promise.all([
          args.syncStore.insertBlocks({
            blocks: finalizedEventData
              .filter(({ filters }) => filters.size > 0)
              .map(({ block }) => block),
            chainId: network.chainId,
          }),
          args.syncStore.insertLogs({
            logs: finalizedEventData.flatMap(({ logs, block }) =>
              logs.map((log) => ({ log, block })),
            ),
            shouldUpdateCheckpoint: true,
            chainId: network.chainId,
          }),
          args.syncStore.insertLogs({
            logs: finalizedEventData.flatMap(({ factoryLogs }) =>
              factoryLogs.map((log) => ({ log })),
            ),
            shouldUpdateCheckpoint: false,
            chainId: network.chainId,
          }),
          args.syncStore.insertTransactions({
            transactions: finalizedEventData.flatMap(
              ({ transactions }) => transactions,
            ),
            chainId: network.chainId,
          }),
          args.syncStore.insertTransactionReceipts({
            transactionReceipts: finalizedEventData.flatMap(
              ({ transactionReceipts }) => transactionReceipts,
            ),
            chainId: network.chainId,
          }),
          args.syncStore.insertCallTraces({
            callTraces: finalizedEventData.flatMap(({ callTraces, block }) =>
              callTraces.map((callTrace) => ({ callTrace, block })),
            ),
            chainId: network.chainId,
          }),
        ]);

        // Add corresponding intervals to the sync-store
        // Note: this should happen after so the database doesn't become corrupted
        await Promise.all(
          args.sources
            .filter(({ filter }) => filter.chainId === network.chainId)
            .map(({ filter }) =>
              args.syncStore.insertInterval({ filter, interval }),
            ),
        );

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
        const checkpoint = getOmnichainCheckpoint("current")!;

        // Update "ponder_sync_block" metric
        args.common.metrics.ponder_sync_block.set(
          { network: network.name },
          hexToNumber(syncProgress.current.number),
        );

        localSyncContext.get(network)!.unfinalizedEventData =
          unfinalizedEventData.filter(
            (led) =>
              hexToNumber(led.block.number) <= hexToNumber(event.block.number),
          );

        const reorgedHashes = new Set<Hash>();
        for (const b of event.reorgedBlocks) {
          reorgedHashes.add(b.hash);
        }

        pendingEvents = pendingEvents.filter(
          (e) => reorgedHashes.has(e.block.hash) === false,
        );

        await args.syncStore.pruneRpcRequestResult({
          blocks: event.reorgedBlocks,
          chainId: network.chainId,
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
      for (const network of args.networks) {
        const { syncProgress, realtimeSync } = localSyncContext.get(network)!;
        status[network.name]!.block = {
          number: hexToNumber(syncProgress.current!.number),
          timestamp: hexToNumber(syncProgress.current!.timestamp),
        };
        status[network.name]!.ready = true;
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
          for (const { filter } of args.sources) {
            if (
              filter.chainId === network.chainId &&
              "address" in filter &&
              isAddressFactory(filter.address)
            ) {
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
    requestQueue: params.requestQueue,
    filters: params.filters,
    historicalSync: params.historicalSync,
  });

  params.syncProgress.current = cached;

  const last = getHistoricalLast(params.syncProgress);
  let cursor = hexToNumber(params.syncProgress.start.number);
  // Estimate optimal range (blocks) to sync at a time, eventually to be used to
  // determine `interval` passed to `historicalSync.sync()`.
  let estimateRange = 25;

  // Handle two special cases:
  // 1. `syncProgress.start` > `syncProgress.finalized`
  // 2. `cached` is defined

  // Handle unfinalized start block
  if (
    hexToNumber(params.syncProgress.start.number) >
    hexToNumber(params.syncProgress.finalized.number)
  ) {
    params.syncProgress.current = params.syncProgress.finalized;

    const label = { network: params.network.name };

    params.common.logger.warn({
      service: "historical",
      msg: `Skipped historical sync for '${params.network.name}' because the start block is not finalized`,
    });

    params.common.metrics.ponder_sync_block.set(
      label,
      hexToNumber(params.syncProgress.finalized.number),
    );
    params.common.metrics.ponder_historical_total_blocks.set(label, 0);
    params.common.metrics.ponder_historical_cached_blocks.set(label, 0);

    return;
  }

  // Intialize metrics

  const totalInterval = [
    hexToNumber(params.syncProgress.start.number),
    hexToNumber(last.number),
  ] satisfies Interval;

  const requiredIntervals = Array.from(
    params.historicalSync.intervalsCache.entries(),
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

  const label = { network: params.network.name };
  // Set "ponder_historical_total_blocks"
  params.common.metrics.ponder_historical_total_blocks.set(label, total);
  // Set "ponder_historical_sync_cached_blocks"
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

      // Update "ponder_sync_block" metric
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

const getLocalSyncProgress = async (params: {
  common: Common;
  network: Network;
  requestQueue: RequestQueue;
  sources: Source[];
}): Promise<SyncProgress> => {
  const syncProgress = {} as SyncProgress;

  const filters = params.sources.map(({ filter }) => filter);

  // Earliest `fromBlock` among all `filters`
  const start = Math.min(...filters.map((filter) => filter.fromBlock ?? 0));

  if (filters.some((filter) => filter.toBlock === undefined)) {
    const diagnostics = await Promise.all([
      params.requestQueue.request({ method: "eth_chainId" }),
      _eth_getBlockByNumber(params.requestQueue, { blockNumber: start }),
      _eth_getBlockByNumber(params.requestQueue, { blockTag: "latest" }).then(
        (latest) =>
          _eth_getBlockByNumber(params.requestQueue, {
            blockNumber: Math.max(
              0,
              hexToNumber(latest.number) - params.network.finalityBlockCount,
            ),
          }),
      ),
    ]);

    // Warn if the config has a different chainId than the remote.
    if (hexToNumber(diagnostics[0]) !== params.network.chainId) {
      params.common.logger.warn({
        service: "sync",
        msg: `Remote chain ID (${hexToNumber(diagnostics[0])}) does not match configured chain ID (${params.network.chainId}) for network "${params.network.name}"`,
      });
    }

    syncProgress.start = diagnostics[1];
    syncProgress.finalized = diagnostics[2];
  } else {
    // Latest `toBlock` among all `filters`
    const end = Math.max(...filters.map((filter) => filter.toBlock!));

    const diagnostics = await Promise.all([
      params.requestQueue.request({ method: "eth_chainId" }),
      _eth_getBlockByNumber(params.requestQueue, { blockNumber: start }),
      _eth_getBlockByNumber(params.requestQueue, { blockNumber: end }),
      _eth_getBlockByNumber(params.requestQueue, { blockTag: "latest" }).then(
        (latest) =>
          _eth_getBlockByNumber(params.requestQueue, {
            blockNumber: Math.max(
              0,
              hexToNumber(latest.number) - params.network.finalityBlockCount,
            ),
          }),
      ),
    ]);

    // Warn if the config has a different chainId than the remote.
    if (hexToNumber(diagnostics[0]) !== params.network.chainId) {
      params.common.logger.warn({
        service: "sync",
        msg: `Remote chain ID (${hexToNumber(diagnostics[0])}) does not match configured chain ID (${params.network.chainId}) for network "${params.network.name}"`,
      });
    }

    syncProgress.start = diagnostics[1];
    syncProgress.end = diagnostics[2];
    syncProgress.finalized = diagnostics[3];
  }

  return syncProgress;
};

/** Returns the closest-to-tip block that has been synced for all `sources`. */
const getCachedBlock = ({
  filters,
  requestQueue,
  historicalSync,
}: {
  filters: Filter[];
  requestQueue: RequestQueue;
  historicalSync: HistoricalSync;
}): Promise<SyncBlock | LightBlock> | undefined => {
  const latestCompletedBlocks = filters.map((filter) => {
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
        block !== undefined || filters[i]!.fromBlock > minCompletedBlock,
    )
  ) {
    return _eth_getBlockByNumber(requestQueue, {
      blockNumber: minCompletedBlock,
    });
  }

  return undefined;
};
