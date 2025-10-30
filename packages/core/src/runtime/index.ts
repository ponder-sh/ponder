import type { Common } from "@/internal/common.js";
import type {
  Chain,
  FactoryId,
  Filter,
  Fragment,
  LightBlock,
  Source,
} from "@/internal/types.js";
import type { SyncBlock } from "@/internal/types.js";
import { _eth_getBlockByNumber } from "@/rpc/actions.js";
import type { Rpc } from "@/rpc/index.js";
import {
  getFilterFromBlock,
  getFilterIntervals,
  getFilterToBlock,
  isAddressFactory,
} from "@/runtime/filter.js";
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
  sources: Source[];
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
  const filters = params.sources.map(({ filter }) => filter);

  // Earliest `fromBlock` among all `filters`
  const start = Math.min(...filters.map(getFilterFromBlock));

  const cached = getCachedBlock({
    filters,
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
    syncProgress.end = await _eth_getBlockByNumber(
      params.rpc,
      { blockNumber: end },
      { retryNullBlockRequest: true },
    );
  }

  return syncProgress;
}

export async function getChildAddresses(params: {
  sources: Source[];
  syncStore: SyncStore;
}): Promise<ChildAddresses> {
  const childAddresses: ChildAddresses = new Map();
  for (const source of params.sources) {
    switch (source.filter.type) {
      case "log":
        if (isAddressFactory(source.filter.address)) {
          const _childAddresses = await params.syncStore.getChildAddresses({
            factory: source.filter.address,
          });
          childAddresses.set(source.filter.address.id, _childAddresses);
        }
        break;
      case "transaction":
      case "transfer":
      case "trace":
        if (isAddressFactory(source.filter.fromAddress)) {
          const _childAddresses = await params.syncStore.getChildAddresses({
            factory: source.filter.fromAddress,
          });
          childAddresses.set(source.filter.fromAddress.id, _childAddresses);
        }

        if (isAddressFactory(source.filter.toAddress)) {
          const _childAddresses = await params.syncStore.getChildAddresses({
            factory: source.filter.toAddress,
          });
          childAddresses.set(source.filter.toAddress.id, _childAddresses);
        }

        break;
    }
  }
  return childAddresses;
}

export async function getCachedIntervals(params: {
  chain: Chain;
  syncStore: SyncStore;
  sources: Source[];
}): Promise<CachedIntervals> {
  /**
   * Intervals that have been completed for all filters in `args.sources`.
   *
   * Note: `intervalsCache` is not updated after a new interval is synced.
   */
  let cachedIntervals: CachedIntervals;
  if (params.chain.disableCache) {
    cachedIntervals = new Map();
    for (const { filter } of params.sources) {
      cachedIntervals.set(filter, []);
      for (const { fragment } of getFragments(filter)) {
        cachedIntervals.get(filter)!.push({ fragment, intervals: [] });
      }
    }
  } else {
    cachedIntervals = await params.syncStore.getIntervals({
      filters: params.sources.map(({ filter }) => filter),
    });
  }

  return cachedIntervals;
}

/**
 * Returns the intervals that need to be synced to complete the `interval`
 * for all `sources`.
 *
 *
 * @param params.sources - The sources to sync.
 * @param params.interval - The interval to sync.
 * @param params.cachedIntervals - The cached intervals for the sources.
 * @returns The intervals that need to be synced.
 */
export const getRequiredIntervals = (params: {
  interval: Interval;
  cachedIntervals: CachedIntervals;
}): Interval[] => {
  return Array.from(params.cachedIntervals.entries()).flatMap(
    ([filter, fragmentIntervals]) => {
      const filterIntervals = getFilterIntervals(filter);

      let hasFactory = false;
      switch (filter.type) {
        case "log":
          if (isAddressFactory(filter.address)) {
            hasFactory = true;
          }
          break;
        case "trace":
        case "transaction":
        case "transfer":
          if (isAddressFactory(filter.fromAddress)) {
            hasFactory = true;
          }
          if (isAddressFactory(filter.toAddress)) {
            hasFactory = true;
          }
          break;
      }

      if (hasFactory) {
        const missingIntervals = intervalDifference(
          intervalIntersection(
            [params.interval],
            intervalUnion(filterIntervals),
          ),
          intervalIntersectionMany(
            fragmentIntervals.map(({ intervals }) => intervals),
          ),
        );

        if (missingIntervals.length === 0) {
          return missingIntervals;
        }

        const firstMissingBlock = missingIntervals[0]![0];
        return [
          [
            firstMissingBlock,
            Math.min(params.interval[1], getFilterToBlock(filter)),
          ],
        ] satisfies Interval[];
      }

      return intervalDifference(
        intervalIntersection([params.interval], intervalUnion(filterIntervals)),
        intervalIntersectionMany(
          fragmentIntervals.map(({ intervals }) => intervals),
        ),
      );
    },
  );
};

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
export const getRequiredIntervalsWithFilters = (params: {
  filters: Filter[];
  interval: Interval;
  cachedIntervals: CachedIntervals;
}): IntervalWithFilter[] => {
  const requiredIntervals: IntervalWithFilter[] = [];

  // Determine the requests that need to be made, and which intervals need to be inserted.
  // Fragments are used to create a minimal filter, to avoid refetching data even if a filter
  // is only partially synced.

  for (const filter of params.filters) {
    const filterInterval = [
      Math.max(getFilterFromBlock(filter), params.interval[0]),
      Math.min(getFilterToBlock(filter), params.interval[1]),
    ] satisfies Interval;

    if (filterInterval[0] >= filterInterval[1]) {
      continue;
    }

    let hasFactory = false;
    switch (filter.type) {
      case "log":
        if (isAddressFactory(filter.address)) {
          hasFactory = true;
        }
        break;
      case "trace":
      case "transaction":
      case "transfer":
        if (isAddressFactory(filter.fromAddress)) {
          hasFactory = true;
        }
        if (isAddressFactory(filter.toAddress)) {
          hasFactory = true;
        }
        break;
    }

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
        [filterInterval],
        fragmentIntervals,
      );
      if (hasFactory) {
        if (requiredFragmentIntervals.length > 0) {
          const firstMissingBlock = requiredFragmentIntervals[0]![0];
          _requiredIntervals.push({
            fragment,
            intervals: [
              [
                firstMissingBlock,
                Math.min(params.interval[1], getFilterToBlock(filter)),
              ],
            ],
          });
        }
      } else {
        if (requiredFragmentIntervals.length > 0) {
          _requiredIntervals.push({
            fragment,
            intervals: requiredFragmentIntervals,
          });
        }
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
    const filterIntervals = getFilterIntervals(filter);
    const fragmentIntervals = cachedIntervals.get(filter)!;

    const completedIntervals = sortIntervals(
      intervalIntersection(
        filterIntervals,
        intervalIntersectionMany(
          fragmentIntervals.map(({ intervals }) => intervals),
        ),
      ),
    );

    const missingIntervals = intervalDifference(
      filterIntervals,
      intervalIntersectionMany(
        fragmentIntervals.map(({ intervals }) => intervals),
      ),
    );

    if (missingIntervals.length === 0) {
      return intervalBounds(completedIntervals)[1];
    }

    if (missingIntervals[0]![0] === 0) return undefined;

    return missingIntervals[0]![0] - 1;
  });

  if (latestCompletedBlocks.every((block) => block !== undefined)) {
    return Math.min(...(latestCompletedBlocks as number[]));
  }

  return undefined;
};
