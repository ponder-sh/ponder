import type { Common } from "@/internal/common.js";
import type {
  Chain,
  FactoryId,
  Filter,
  Fragment,
  LightBlock,
} from "@/internal/types.js";
import type { SyncBlock } from "@/internal/types.js";
import { _eth_getBlockByNumber } from "@/rpc/actions.js";
import type { Rpc } from "@/rpc/index.js";
import { isAddressFactory } from "@/runtime/filter.js";
import { getFragments, recoverFilter } from "@/runtime/fragments.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  MAX_CHECKPOINT,
  blockToCheckpoint,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import {
  type Interval,
  intervalBounds,
  intervalDifference,
  intervalIntersection,
  intervalIntersectionMany,
  intervalUnion,
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

export type IntervalWithFilter = {
  interval: Interval;
  filter: Filter;
};

export async function getLocalSyncProgress(params: {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  filters: Filter[];
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

  // Earliest `fromBlock` among all `filters`
  const start = Math.min(
    ...params.filters.flatMap((filter) => {
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
    filters: params.filters,
    cachedIntervals: params.cachedIntervals,
  });

  const diagnostics = await Promise.all(
    cached === undefined
      ? [
          _eth_getBlockByNumber(
            params.rpc,
            { blockNumber: start },
            { retryNullBlockRequest: true },
          ),
        ]
      : [
          _eth_getBlockByNumber(
            params.rpc,
            { blockNumber: start },
            { retryNullBlockRequest: true },
          ),
          _eth_getBlockByNumber(
            params.rpc,
            { blockNumber: cached },
            { retryNullBlockRequest: true },
          ),
        ],
  );

  syncProgress.finalized = params.finalizedBlock;
  syncProgress.start = diagnostics[0];
  if (diagnostics.length === 2) {
    syncProgress.current = diagnostics[1];
  }

  if (params.filters.some((filter) => filter.toBlock === undefined)) {
    return syncProgress;
  }

  // Latest `toBlock` among all `filters`
  const end = Math.max(...params.filters.map((filter) => filter.toBlock!));

  if (end > hexToNumber(params.finalizedBlock.number)) {
    syncProgress.end = {
      number: toHex(end),
      hash: "0x",
      parentHash: "0x",
      timestamp: toHex(MAX_CHECKPOINT.blockTimestamp),
    } satisfies LightBlock;
  } else {
    syncProgress.end = await _eth_getBlockByNumber(
      params.rpc,
      { blockNumber: end },
      { retryNullBlockRequest: true },
    );
  }

  return syncProgress;
}

export async function getChildAddresses(params: {
  filters: Filter[];
  syncStore: SyncStore;
}): Promise<ChildAddresses> {
  const childAddresses: ChildAddresses = new Map();
  for (const filter of params.filters) {
    switch (filter.type) {
      case "log":
        if (isAddressFactory(filter.address)) {
          const _childAddresses = await params.syncStore.getChildAddresses({
            factory: filter.address,
          });
          childAddresses.set(filter.address.id, _childAddresses);
        }
        break;
      case "transaction":
      case "transfer":
      case "trace":
        if (isAddressFactory(filter.fromAddress)) {
          const _childAddresses = await params.syncStore.getChildAddresses({
            factory: filter.fromAddress,
          });
          childAddresses.set(filter.fromAddress.id, _childAddresses);
        }

        if (isAddressFactory(filter.toAddress)) {
          const _childAddresses = await params.syncStore.getChildAddresses({
            factory: filter.toAddress,
          });
          childAddresses.set(filter.toAddress.id, _childAddresses);
        }

        break;
    }
  }
  return childAddresses;
}

export async function getCachedIntervals(params: {
  chain: Chain;
  filters: Filter[];
  syncStore: SyncStore;
}): Promise<CachedIntervals> {
  /**
   * Intervals that have been completed for all filters in `args.sources`.
   *
   * Note: `intervalsCache` is not updated after a new interval is synced.
   */
  let cachedIntervals: CachedIntervals;
  if (params.chain.disableCache) {
    cachedIntervals = new Map();
    for (const filter of params.filters) {
      cachedIntervals.set(filter, []);
      for (const { fragment } of getFragments(filter)) {
        cachedIntervals.get(filter)!.push({ fragment, intervals: [] });
      }
    }
  } else {
    cachedIntervals = await params.syncStore.getIntervals({
      filters: params.filters,
    });
  }

  return cachedIntervals;
}

/**
 * Returns the intervals that need to be synced to complete the `interval`
 * for all `sources`.
 *
 * Note: This function dynamically builds filters using `recoverFilter`.
 * Fragments are used to create a minimal filter, to avoid refetching data
 * even if a filter is only partially synced.
 *
 * @param params.sources - The sources to sync.
 * @param params.interval - The interval to sync.
 * @param params.cachedIntervals - The cached intervals for the sources.
 * @returns The intervals that need to be synced.
 */
export const getRequiredIntervals = (params: {
  filters: Filter[];
  interval: Interval;
  cachedIntervals: CachedIntervals;
}): IntervalWithFilter[] => {
  const requiredIntervals: IntervalWithFilter[] = [];

  // Determine the requests that need to be made, and which intervals need to be inserted.
  // Fragments are used to create a minimal filter, to avoid refetching data even if a filter
  // is only partially synced.

  for (const filter of params.filters) {
    let filterIntervals: Interval[] = [
      [
        Math.max(filter.fromBlock ?? 0, params.interval[0]),
        Math.min(
          filter.toBlock ?? Number.POSITIVE_INFINITY,
          params.interval[1],
        ),
      ],
    ];

    switch (filter.type) {
      case "log":
        if (isAddressFactory(filter.address)) {
          filterIntervals.push([
            Math.max(filter.address.fromBlock ?? 0, params.interval[0]),
            Math.min(
              filter.address.toBlock ?? Number.POSITIVE_INFINITY,
              params.interval[1],
            ),
          ]);
        }
        break;
      case "trace":
      case "transaction":
      case "transfer":
        if (isAddressFactory(filter.fromAddress)) {
          filterIntervals.push([
            Math.max(filter.fromAddress.fromBlock ?? 0, params.interval[0]),
            Math.min(
              filter.fromAddress.toBlock ?? Number.POSITIVE_INFINITY,
              params.interval[1],
            ),
          ]);
        }

        if (isAddressFactory(filter.toAddress)) {
          filterIntervals.push([
            Math.max(filter.toAddress.fromBlock ?? 0, params.interval[0]),
            Math.min(
              filter.toAddress.toBlock ?? Number.POSITIVE_INFINITY,
              params.interval[1],
            ),
          ]);
        }
    }

    filterIntervals = filterIntervals.filter(([start, end]) => start <= end);

    if (filterIntervals.length === 0) {
      continue;
    }

    filterIntervals = intervalUnion(filterIntervals);

    const completedIntervals = params.cachedIntervals.get(filter)!;
    const _requiredIntervals: {
      fragment: Fragment;
      intervals: Interval[];
    }[] = [];

    for (const {
      fragment,
      intervals: fragmentIntervals,
    } of completedIntervals) {
      const requiredFragmentIntervals = intervalDifference(
        filterIntervals,
        fragmentIntervals,
      );

      if (requiredFragmentIntervals.length > 0) {
        _requiredIntervals.push({
          fragment,
          intervals: requiredFragmentIntervals,
        });
      }
    }

    if (_requiredIntervals.length > 0) {
      const requiredInterval = intervalBounds(
        _requiredIntervals.flatMap(({ intervals }) => intervals),
      );

      const requiredFilter = recoverFilter(
        filter,
        _requiredIntervals.map(({ fragment }) => fragment),
      );

      requiredIntervals.push({
        filter: requiredFilter,
        interval: requiredInterval,
      });
    }
  }

  return requiredIntervals;
};

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
