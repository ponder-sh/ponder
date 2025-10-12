import type { Common } from "@/internal/common.js";
import type {
  Chain,
  EventCallback,
  FactoryId,
  Filter,
  Fragment,
  IndexingFunctions,
  LightBlock,
} from "@/internal/types.js";
import type { SyncBlock } from "@/internal/types.js";
import { _eth_getBlockByNumber } from "@/rpc/actions.js";
import type { Rpc } from "@/rpc/index.js";
import { isAddressFactory } from "@/runtime/filter.js";
import { getFragments } from "@/runtime/fragments.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  MAX_CHECKPOINT,
  blockToCheckpoint,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import {
  type Interval,
  intervalIntersection,
  intervalIntersectionMany,
  sortIntervals,
} from "@/utils/interval.js";
import { type Address, hexToNumber, toHex } from "viem";

export type SyncProgress = {
  start: SyncBlock | LightBlock;
  end: SyncBlock | LightBlock | undefined;
  current: SyncBlock | LightBlock | undefined;
  finalized: SyncBlock | LightBlock;
  isEnd: () => boolean;
  isFinalized: () => boolean;
  getCheckpoint: <tag extends "start" | "end" | "current" | "finalized">({
    tag,
  }: { tag: tag }) => tag extends "end" ? string | undefined : string;
};

export type ChildAddresses = Map<FactoryId, Map<Address, number>>;

export type CachedIntervals = Map<
  Filter,
  { fragment: Fragment; intervals: Interval[] }[]
>;

export async function getLocalSyncProgress(params: {
  common: Common;
  eventCallbacks: EventCallback[];
  chain: Chain;
  rpc: Rpc;
  finalizedBlock: LightBlock;
  cachedIntervals: CachedIntervals;
}): Promise<SyncProgress> {
  const syncProgress = {
    isEnd: () => {
      if (
        syncProgress.end === undefined ||
        syncProgress.current === undefined
      ) {
        return false;
      }

      return (
        hexToNumber(syncProgress.current.number) >=
        hexToNumber(syncProgress.end.number)
      );
    },
    isFinalized: () => {
      if (syncProgress.current === undefined) {
        return false;
      }

      return (
        hexToNumber(syncProgress.current.number) >=
        hexToNumber(syncProgress.finalized.number)
      );
    },
    getCheckpoint: ({ tag }) => {
      if (tag === "end" && syncProgress.end === undefined) {
        return undefined;
      }

      // Note: `current` is guaranteed to be defined because it is only used once the historical
      // backfill is complete.
      const block = syncProgress[tag]!;
      return encodeCheckpoint(
        blockToCheckpoint(
          block,
          params.chain.id,
          // The checkpoint returned by this function is meant to be used in
          // a closed interval (includes endpoints), so "start" should be inclusive.
          tag === "start" ? "down" : "up",
        ),
      );
    },
  } as SyncProgress;
  const filters = params.eventCallbacks.map(({ filter }) => filter);

  // Earliest `fromBlock` among all `filters`
  const start = Math.min(
    ...filters.flatMap((filter) => {
      const fromBlocks: number[] = [filter.fromBlock ?? 0];
      switch (filter.type) {
        case "log":
          if (isAddressFactory(filter.address)) {
            fromBlocks.push(filter.address.fromBlock ?? 0);
          }
          break;
        case "transaction":
        case "trace":
        case "transfer":
          if (isAddressFactory(filter.fromAddress)) {
            fromBlocks.push(filter.fromAddress.fromBlock ?? 0);
          }

          if (isAddressFactory(filter.toAddress)) {
            fromBlocks.push(filter.toAddress.fromBlock ?? 0);
          }
      }

      return fromBlocks;
    }),
  );

  const cached = getCachedBlock({
    filters,
    cachedIntervals: params.cachedIntervals,
  });

  const diagnostics = await Promise.all(
    cached === undefined
      ? [_eth_getBlockByNumber(params.rpc, { blockNumber: start })]
      : [
          _eth_getBlockByNumber(params.rpc, { blockNumber: start }),
          _eth_getBlockByNumber(params.rpc, { blockNumber: cached }),
        ],
  );

  syncProgress.finalized = params.finalizedBlock;
  syncProgress.start = diagnostics[0];
  if (diagnostics.length === 2) {
    syncProgress.current = diagnostics[1];
  }

  if (filters.some((filter) => filter.toBlock === undefined)) {
    return syncProgress;
  }

  // Latest `toBlock` among all `filters`
  const end = Math.max(...filters.map((filter) => filter.toBlock!));

  if (end > hexToNumber(params.finalizedBlock.number)) {
    syncProgress.end = {
      number: toHex(end),
      hash: "0x",
      parentHash: "0x",
      timestamp: toHex(MAX_CHECKPOINT.blockTimestamp),
    } satisfies LightBlock;
  } else {
    syncProgress.end = await _eth_getBlockByNumber(params.rpc, {
      blockNumber: end,
    });
  }

  return syncProgress;
}

export async function getChildAddresses(params: {
  eventCallbacks: EventCallback[];
  syncStore: SyncStore;
}): Promise<ChildAddresses> {
  const childAddresses: ChildAddresses = new Map();
  for (const eventCallback of params.eventCallbacks) {
    switch (eventCallback.filter.type) {
      case "log":
        if (isAddressFactory(eventCallback.filter.address)) {
          const _childAddresses = await params.syncStore.getChildAddresses({
            factory: eventCallback.filter.address,
          });
          childAddresses.set(eventCallback.filter.address.id, _childAddresses);
        }
        break;
      case "transaction":
      case "transfer":
      case "trace":
        if (isAddressFactory(eventCallback.filter.fromAddress)) {
          const _childAddresses = await params.syncStore.getChildAddresses({
            factory: eventCallback.filter.fromAddress,
          });
          childAddresses.set(
            eventCallback.filter.fromAddress.id,
            _childAddresses,
          );
        }

        if (isAddressFactory(eventCallback.filter.toAddress)) {
          const _childAddresses = await params.syncStore.getChildAddresses({
            factory: eventCallback.filter.toAddress,
          });
          childAddresses.set(
            eventCallback.filter.toAddress.id,
            _childAddresses,
          );
        }

        break;
    }
  }
  return childAddresses;
}

export async function getCachedIntervals(params: {
  chain: Chain;
  syncStore: SyncStore;
  eventCallbacks: EventCallback[];
}): Promise<CachedIntervals> {
  /**
   * Intervals that have been completed for all filters in `args.sources`.
   *
   * Note: `intervalsCache` is not updated after a new interval is synced.
   */
  let cachedIntervals: CachedIntervals;
  if (params.chain.disableCache) {
    cachedIntervals = new Map();
    for (const { filter } of params.eventCallbacks) {
      cachedIntervals.set(filter, []);
      for (const { fragment } of getFragments(filter)) {
        cachedIntervals.get(filter)!.push({ fragment, intervals: [] });
      }
    }
  } else {
    cachedIntervals = await params.syncStore.getIntervals({
      filters: params.eventCallbacks.map(({ filter }) => filter),
    });
  }

  return cachedIntervals;
}

/** Returns the closest-to-tip block that has been synced for all `sources`. */
export const getCachedBlock = ({
  filters,
  cachedIntervals,
}: {
  filters: Filter[];
  cachedIntervals: CachedIntervals;
}): number | undefined => {
  const latestCompletedBlocks = filters.map((filter) => {
    const requiredInterval = [
      filter.fromBlock ?? 0,
      filter.toBlock ?? Number.POSITIVE_INFINITY,
    ] satisfies Interval;
    const fragmentIntervals = cachedIntervals.get(filter)!;

    const completedIntervals = sortIntervals(
      intervalIntersection(
        [requiredInterval],
        intervalIntersectionMany(
          fragmentIntervals.map(({ intervals }) => intervals),
        ),
      ),
    );

    if (completedIntervals.length === 0) {
      // Use `fromBlock` - 1 as completed block if no intervals are complete.
      if ((filter.fromBlock ?? 0) === 0) return undefined;
      return filter.fromBlock! - 1;
    }

    const earliestCompletedInterval = completedIntervals[0]!;
    if (earliestCompletedInterval[0] !== (filter.fromBlock ?? 0)) {
      // Use `fromBlock` - 1 as completed block if the earliest
      // completed interval does not start at `fromBlock`.
      if ((filter.fromBlock ?? 0) === 0) return undefined;
      return filter.fromBlock! - 1;
    }
    return earliestCompletedInterval[1];
  });

  if (latestCompletedBlocks.every((block) => block !== undefined)) {
    return Math.min(...(latestCompletedBlocks as number[]));
  }

  return undefined;
};

export const getEventCount = (params: {
  indexingFunctions: IndexingFunctions;
}) => {
  const eventCount: { [eventName: string]: number } = {};
  for (const { name: eventName } of params.indexingFunctions) {
    eventCount[eventName] = 0;
  }
  return eventCount;
};
