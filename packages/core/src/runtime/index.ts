import { Effect, Stream } from "effect";
import { type Address, hexToNumber, numberToHex, toHex } from "viem";
import { createCachedViemClient } from "@/indexing/client.js";
import {
  createColumnAccessPattern,
  createIndexing,
  getEventCount,
} from "@/indexing/index.js";
import { createIndexingCache } from "@/indexing-store/cache.js";
import { createIndexingStore } from "@/indexing-store/index.js";
import type { RetryableError } from "@/internal/errors.js";
import { getAppProgress, Metrics } from "@/internal/metrics.js";
import type {
  Chain,
  CrashRecoveryCheckpoint,
  Factory,
  FactoryId,
  Filter,
  Fragment,
  IndexingBuild,
  IndexingErrorHandler,
  LightBlock,
  SchemaBuild,
  SyncBlock,
} from "@/internal/types.js";
import { eth_getBlockByNumber } from "@/rpc/actions.js";
import type { Rpc } from "@/rpc/index.js";
import {
  getFilterFactories,
  getFilterFromBlock,
  getFilterToBlock,
} from "@/runtime/filter.js";
import {
  getFactoryFragments,
  getFragments,
  recoverFactory,
  recoverFilter,
} from "@/runtime/fragments.js";
import type { UnfinalizedBlock } from "@/runtime/realtime.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  blockToCheckpoint,
  encodeCheckpoint,
  MAX_CHECKPOINT,
} from "@/utils/checkpoint.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import {
  type Interval,
  intervalBounds,
  intervalDifference,
  intervalIntersection,
  intervalIntersectionMany,
  intervalUnion,
  sortIntervals,
} from "@/utils/interval.js";
import { startClockEffect } from "@/utils/timer.js";

export type SyncProgress = {
  start: SyncBlock | LightBlock;
  end: SyncBlock | LightBlock | undefined;
  current: SyncBlock | LightBlock | undefined;
  finalized: SyncBlock | LightBlock;
  isEnd: () => boolean;
  isFinalized: () => boolean;
  getCheckpoint: <tag extends "start" | "end" | "current" | "finalized">({
    tag,
  }: {
    tag: tag;
  }) => tag extends "end" ? string | undefined : string;
};

export type ChildAddresses = Map<FactoryId, Map<Address, number>>;

export type CachedIntervals = Map<
  Filter | Factory,
  { fragment: Fragment; intervals: Interval[] }[]
>;

export type IntervalWithFilter = {
  interval: Interval;
  filter: Filter;
};

export type IntervalWithFactory = {
  interval: Interval;
  factory: Factory;
};

/**
 * Create the sync progress of a chain, with the start, cached, and end blocks
 * of `filters`.
 */
export const getLocalSyncProgress = (params: {
  chain: Chain;
  rpc: Rpc;
  filters: Filter[];
  finalizedBlock: LightBlock;
  cachedIntervals: CachedIntervals;
}): Effect.Effect<SyncProgress, Error> =>
  Effect.gen(function* () {
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
    const start = Math.min(...params.filters.map(getFilterFromBlock));

    const cached = getCachedBlock({
      filters: params.filters,
      cachedIntervals: params.cachedIntervals,
    });

    const getBlock = (blockNumber: number) =>
      eth_getBlockByNumber(params.rpc, [numberToHex(blockNumber), false], {
        retryNullBlockRequest: true,
      });

    const [startBlock, cachedBlock] = yield* Effect.all(
      [
        getBlock(start),
        cached === undefined ? Effect.succeed(undefined) : getBlock(cached),
      ],
      { concurrency: "unbounded" },
    );

    syncProgress.finalized = params.finalizedBlock;
    syncProgress.start = startBlock;
    if (cachedBlock !== undefined) {
      syncProgress.current = cachedBlock;
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
      syncProgress.end = yield* getBlock(end);
    }

    return syncProgress;
  });

/**
 * Returns the child addresses of the factories of `filters`.
 */
export const getChildAddresses = (params: {
  chain: Chain;
  filters: Filter[];
  syncStore: SyncStore;
}): Effect.Effect<ChildAddresses, Error> =>
  Effect.gen(function* () {
    const childAddresses: ChildAddresses = new Map();

    // Note: When the rpc cache is disabled, child addresses in the sync-store can be
    // stale (e.g. from before an Anvil reset). Start empty and fetch them from the rpc.
    const getFactoryChildAddresses = (factory: Factory) =>
      params.chain.cacheRpcRequests
        ? params.syncStore.getChildAddresses({ factory })
        : Effect.succeed(new Map<Address, number>());

    for (const filter of params.filters) {
      for (const factory of getFilterFactories(filter)) {
        childAddresses.set(
          factory.id,
          yield* getFactoryChildAddresses(factory),
        );
      }
    }

    return childAddresses;
  });

/**
 * Returns the intervals that have been completed for each filter and factory
 * of `filters`.
 *
 * Note: The intervals are not updated after a new interval is synced.
 */
export const getCachedIntervals = (params: {
  chain: Chain;
  filters: Filter[];
  syncStore: SyncStore;
}): Effect.Effect<CachedIntervals, Error> => {
  if (params.chain.cacheRpcRequests) {
    return params.syncStore.getIntervals({ filters: params.filters });
  }

  const cachedIntervals: CachedIntervals = new Map();
  for (const filter of params.filters) {
    cachedIntervals.set(filter, []);
    for (const { fragment } of getFragments(filter)) {
      cachedIntervals.get(filter)!.push({ fragment, intervals: [] });
    }
    for (const factory of getFilterFactories(filter)) {
      cachedIntervals.set(factory, []);
      for (const fragment of getFactoryFragments(factory)) {
        cachedIntervals.get(factory)!.push({ fragment, intervals: [] });
      }
    }
  }
  return Effect.succeed(cachedIntervals);
};

/**
 * Returns the intervals that need to be synced to complete the `interval`
 * for all `filters`.
 *
 * @param params.filters - The filters to sync.
 * @param params.interval - The interval to sync.
 * @param params.cachedIntervals - The cached intervals for the filters.
 * @returns The intervals that need to be synced.
 */
export const getRequiredIntervals = (params: {
  filters: Filter[];
  interval: Interval;
  cachedIntervals: CachedIntervals;
}): Interval[] => {
  const requiredIntervals: Interval[] = [];
  for (const filter of params.filters) {
    const filterTotalIntervals = intervalIntersection(
      [params.interval],
      [[filter.fromBlock ?? 0, filter.toBlock ?? Number.POSITIVE_INFINITY]],
    );
    let filterCachedIntervals = params.cachedIntervals.get(filter)!;

    const factories = getFilterFactories(filter);

    const missingFactoryIntervals: Interval[] = [];
    for (const factory of factories) {
      const factoryTotalIntervals = intervalIntersection(
        [params.interval],
        [[factory.fromBlock ?? 0, factory.toBlock ?? Number.POSITIVE_INFINITY]],
      );

      missingFactoryIntervals.push(
        ...intervalDifference(
          factoryTotalIntervals,
          intervalIntersectionMany(
            params.cachedIntervals
              .get(factory)!
              .map(({ intervals }) => intervals),
          ),
        ),
      );
    }

    if (missingFactoryIntervals.length > 0) {
      const firstMissingFactoryBlock = sortIntervals(
        missingFactoryIntervals,
      )[0]![0];

      // Note: When a filter with a factory is missing blocks,
      // all blocks after the first missing block are also missing.

      filterCachedIntervals = filterCachedIntervals.map(
        ({ fragment, intervals }) => {
          return {
            fragment,
            intervals: intervalDifference(intervals, [
              [firstMissingFactoryBlock, params.interval[1]],
            ]),
          };
        },
      );
    }

    const missingIntervals = intervalDifference(
      filterTotalIntervals,
      intervalIntersectionMany(
        filterCachedIntervals.map(({ intervals }) => intervals),
      ),
    );

    requiredIntervals.push(...missingIntervals, ...missingFactoryIntervals);
  }

  return intervalUnion(requiredIntervals);
};

/**
 * Returns the intervals that need to be synced to complete the `interval`
 * for all `filters`.
 *
 * Note: This function dynamically builds filters using `recoverFilter`.
 * Fragments are used to create a minimal filter, to avoid refetching data
 * even if a filter is only partially synced.
 *
 * @param params.filters - The filters to sync.
 * @param params.interval - The interval to sync.
 * @param params.cachedIntervals - The cached intervals for the filters.
 * @returns The intervals that need to be synced.
 */
export const getRequiredIntervalsWithFilters = (params: {
  filters: Filter[];
  interval: Interval;
  cachedIntervals: CachedIntervals;
}): {
  intervals: IntervalWithFilter[];
  factoryIntervals: IntervalWithFactory[];
} => {
  const requiredIntervals: IntervalWithFilter[] = [];
  const requiredFactoryIntervals: IntervalWithFactory[] = [];

  // Determine the requests that need to be made, and which intervals need to be inserted.
  // Fragments are used to create a minimal filter, to avoid refetching data even if a filter
  // is only partially synced.

  for (const filter of params.filters) {
    const filterTotalIntervals = intervalIntersection(
      [params.interval],
      [[filter.fromBlock ?? 0, filter.toBlock ?? Number.POSITIVE_INFINITY]],
    );
    let filterCachedIntervals = params.cachedIntervals.get(filter)!;

    const factories = getFilterFactories(filter);

    const missingFactoryIntervals: Interval[] = [];
    for (const factory of factories) {
      const factoryTotalIntervals = intervalIntersection(
        [params.interval],
        [[factory.fromBlock ?? 0, factory.toBlock ?? Number.POSITIVE_INFINITY]],
      );

      missingFactoryIntervals.push(
        ...intervalDifference(
          factoryTotalIntervals,
          intervalIntersectionMany(
            params.cachedIntervals
              .get(factory)!
              .map(({ intervals }) => intervals),
          ),
        ),
      );
    }

    if (missingFactoryIntervals.length > 0) {
      const firstMissingFactoryBlock = sortIntervals(
        missingFactoryIntervals,
      )[0]![0];

      // Note: When a filter with a factory is missing blocks,
      // all blocks after the first missing block are also missing.

      filterCachedIntervals = filterCachedIntervals.map(
        ({ fragment, intervals }) => {
          return {
            fragment,
            intervals: intervalDifference(intervals, [
              [firstMissingFactoryBlock, params.interval[1]],
            ]),
          };
        },
      );
    }

    const requiredFragmentIntervals: {
      fragment: Fragment;
      intervals: Interval[];
    }[] = [];

    for (const {
      fragment,
      intervals: fragmentIntervals,
    } of filterCachedIntervals) {
      const missingFragmentIntervals = intervalDifference(
        filterTotalIntervals,
        fragmentIntervals,
      );

      if (missingFragmentIntervals.length > 0) {
        requiredFragmentIntervals.push({
          fragment,
          intervals: missingFragmentIntervals,
        });
      }
    }

    if (requiredFragmentIntervals.length > 0) {
      const requiredInterval = intervalBounds(
        requiredFragmentIntervals.flatMap(({ intervals }) => intervals),
      );

      const requiredFilter = recoverFilter(
        filter,
        requiredFragmentIntervals.map(({ fragment }) => fragment),
      );

      requiredIntervals.push({
        filter: requiredFilter,
        interval: requiredInterval,
      });
    }

    for (const factory of factories) {
      const factoryTotalIntervals = intervalIntersection(
        [params.interval],
        [[factory.fromBlock ?? 0, factory.toBlock ?? Number.POSITIVE_INFINITY]],
      );

      const requiredFactoryFragmentIntervals: {
        fragment: Fragment;
        intervals: Interval[];
      }[] = [];

      for (const {
        fragment,
        intervals: fragmentIntervals,
      } of params.cachedIntervals.get(factory)!) {
        const missingFragmentIntervals = intervalDifference(
          factoryTotalIntervals,
          fragmentIntervals,
        );

        if (missingFragmentIntervals.length > 0) {
          requiredFactoryFragmentIntervals.push({
            fragment,
            intervals: missingFragmentIntervals,
          });
        }
      }

      if (requiredFactoryFragmentIntervals.length > 0) {
        const requiredInterval = intervalBounds(
          requiredFactoryFragmentIntervals.flatMap(
            ({ intervals }) => intervals,
          ),
        );

        requiredFactoryIntervals.push({
          factory: recoverFactory(
            factory,
            requiredFactoryFragmentIntervals.map(({ fragment }) => fragment),
          ),
          interval: requiredInterval,
        });
      }
    }
  }

  return {
    intervals: requiredIntervals,
    factoryIntervals: requiredFactoryIntervals,
  };
};

/** Key of a filter for comparing required filters, which can contain bigints. */
const getFilterKey = (filter: Filter) =>
  JSON.stringify(filter, (_, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );

/**
 * Split `interval` at the edges of the cached intervals of the filters and their
 * factories, and return the required intervals of each piece that isn't cached.
 *
 * Note: {@link getRequiredIntervalsWithFilters} requires one interval per filter, from
 * its first to its last missing block, which includes the cached blocks in between.
 * Each fragment is either cached or missing within a piece, so the required intervals
 * of a piece don't include cached blocks. Adjacent pieces with the same required
 * filters and factories are merged.
 */
export const getRequiredIntervalsPerPiece = (params: {
  filters: Filter[];
  interval: Interval;
  cachedIntervals: CachedIntervals;
}): {
  interval: Interval;
  intervals: IntervalWithFilter[];
  factoryIntervals: IntervalWithFactory[];
}[] => {
  const edges = new Set<number>();
  const addEdges = (cached: { intervals: Interval[] }[]) => {
    for (const { intervals } of cached) {
      for (const [start, end] of intervals) {
        edges.add(start);
        edges.add(end + 1);
      }
    }
  };
  for (const filter of params.filters) {
    addEdges(params.cachedIntervals.get(filter)!);
    for (const factory of getFilterFactories(filter)) {
      addEdges(params.cachedIntervals.get(factory)!);
    }
  }

  const starts = [
    params.interval[0],
    ...Array.from(edges)
      .filter((edge) => edge > params.interval[0] && edge <= params.interval[1])
      .sort((a, b) => a - b),
  ];

  const pieces: ReturnType<typeof getRequiredIntervalsPerPiece> = [];

  for (let i = 0; i < starts.length; i++) {
    const interval: Interval = [
      starts[i]!,
      i === starts.length - 1 ? params.interval[1] : starts[i + 1]! - 1,
    ];
    const required = getRequiredIntervalsWithFilters({ ...params, interval });

    if (
      required.intervals.length === 0 &&
      required.factoryIntervals.length === 0
    ) {
      continue;
    }

    const previous = pieces[pieces.length - 1];

    // Note: Merging is exact when each required interval of the previous piece
    // continues in this piece, with the same filter or factory.
    if (
      previous !== undefined &&
      previous.interval[1] + 1 === interval[0] &&
      previous.intervals.length === required.intervals.length &&
      previous.factoryIntervals.length === required.factoryIntervals.length &&
      previous.intervals.every(
        (p, j) =>
          p.interval[1] + 1 === required.intervals[j]!.interval[0] &&
          getFilterKey(p.filter) ===
            getFilterKey(required.intervals[j]!.filter),
      ) &&
      previous.factoryIntervals.every(
        (p, j) =>
          p.interval[1] + 1 === required.factoryIntervals[j]!.interval[0] &&
          p.factory.id === required.factoryIntervals[j]!.factory.id,
      )
    ) {
      previous.interval[1] = interval[1];
      for (let j = 0; j < previous.intervals.length; j++) {
        previous.intervals[j]!.interval[1] = required.intervals[j]!.interval[1];
      }
      for (let j = 0; j < previous.factoryIntervals.length; j++) {
        previous.factoryIntervals[j]!.interval[1] =
          required.factoryIntervals[j]!.interval[1];
      }
      continue;
    }

    pieces.push({ interval, ...required });
  }

  return pieces;
};

/** Returns the closest-to-tip block that has been synced for all `filters`. */
export const getCachedBlock = ({
  filters,
  cachedIntervals,
}: {
  filters: Filter[];
  cachedIntervals: CachedIntervals;
}): number | undefined => {
  const latestCompletedBlocks = filters.map((filter) => {
    const filterTotalInterval = [
      filter.fromBlock ?? 0,
      filter.toBlock ?? Number.POSITIVE_INFINITY,
    ] satisfies Interval;
    let filterCachedIntervals = cachedIntervals.get(filter)!;

    const factories = getFilterFactories(filter);

    const missingFactoryIntervals: Interval[] = [];
    for (const factory of factories) {
      const factoryTotalInterval = [
        factory.fromBlock ?? 0,
        factory.toBlock ?? Number.POSITIVE_INFINITY,
      ] satisfies Interval;

      missingFactoryIntervals.push(
        ...intervalDifference(
          [factoryTotalInterval],
          intervalIntersectionMany(
            cachedIntervals.get(factory)!.map(({ intervals }) => intervals),
          ),
        ),
      );
    }

    if (missingFactoryIntervals.length > 0) {
      const firstMissingFactoryBlock = sortIntervals(
        missingFactoryIntervals,
      )[0]![0];

      // Note: When a filter with a factory is missing blocks,
      // all blocks after the first missing block are also missing.

      filterCachedIntervals = filterCachedIntervals.map(
        ({ fragment, intervals }) => {
          return {
            fragment,
            intervals: intervalDifference(intervals, [
              [firstMissingFactoryBlock, filterTotalInterval[1]],
            ]),
          };
        },
      );
    }

    let missingIntervals = intervalDifference(
      [filterTotalInterval],
      intervalIntersectionMany(
        filterCachedIntervals.map(({ intervals }) => intervals),
      ),
    );

    if (missingIntervals.length === 0 && missingFactoryIntervals.length === 0) {
      return getFilterToBlock(filter);
    }

    missingIntervals = sortIntervals([
      ...missingIntervals,
      ...missingFactoryIntervals,
    ]);

    if (missingIntervals[0]![0] === 0) return undefined;
    // First missing block - 1 is the last completed block
    return missingIntervals[0]![0] - 1;
  });

  if (latestCompletedBlocks.every((block) => block !== undefined)) {
    return Math.min(...(latestCompletedBlocks as number[]));
  }

  return undefined;
};

/**
 * Create the runner of indexing functions, with its indexing store, indexing
 * cache, and `context.client`.
 *
 * @param params.chainId - The chain of the indexing store, for isolated ordering.
 */
export const createIndexingRuntime = ({
  indexingBuild,
  schemaBuild,
  crashRecoveryCheckpoint,
  syncStore,
  chainId,
}: {
  indexingBuild: IndexingBuild;
  schemaBuild: Pick<SchemaBuild, "schema">;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  syncStore: SyncStore;
  chainId?: number;
}) =>
  Effect.gen(function* () {
    const columnAccessPattern = createColumnAccessPattern({ indexingBuild });
    const eventCount = getEventCount(indexingBuild.indexingFunctions);

    const cachedViemClient = yield* createCachedViemClient({
      indexingBuild,
      syncStore,
      eventCount,
    });

    const indexingErrorHandler: IndexingErrorHandler = {
      getRetryableError: () => {
        return indexingErrorHandler.error;
      },
      setRetryableError: (error: RetryableError) => {
        indexingErrorHandler.error = error;
      },
      clearRetryableError: () => {
        indexingErrorHandler.error = undefined;
      },
      error: undefined as RetryableError | undefined,
    };

    const indexingCache = yield* createIndexingCache({
      schemaBuild,
      crashRecoveryCheckpoint,
      eventCount,
      chainId,
    });

    const indexingStore = yield* createIndexingStore({
      schemaBuild,
      indexingCache,
      indexingErrorHandler,
      chainId,
    });

    const indexing = yield* createIndexing({
      indexingBuild,
      indexingStore,
      indexingCache,
      client: cachedViemClient,
      indexingErrorHandler,
      columnAccessPattern,
      eventCount,
    });

    return { cachedViemClient, indexingCache, indexingStore, indexing };
  });

/**
 * Returns the sync progress, the cached intervals, and the child addresses of
 * `chain`.
 */
export const getChainSync = ({
  chain,
  indexingBuild,
  syncStore,
}: {
  chain: Chain;
  indexingBuild: Pick<
    IndexingBuild,
    "chains" | "rpcs" | "eventCallbacks" | "finalizedBlocks"
  >;
  syncStore: SyncStore;
}) =>
  Effect.gen(function* () {
    const chainIndex = indexingBuild.chains.indexOf(chain);
    const filters = indexingBuild.eventCallbacks[chainIndex]!.map(
      ({ filter }) => filter,
    );

    const cachedIntervals = yield* getCachedIntervals({
      chain,
      filters,
      syncStore,
    });
    const syncProgress = yield* getLocalSyncProgress({
      filters,
      chain,
      rpc: indexingBuild.rpcs[chainIndex]!,
      finalizedBlock: indexingBuild.finalizedBlocks[chainIndex]!,
      cachedIntervals,
    });
    const childAddresses = yield* getChildAddresses({
      chain,
      filters,
      syncStore,
    });
    const unfinalizedBlocks: UnfinalizedBlock[] = [];

    return { syncProgress, childAddresses, cachedIntervals, unfinalizedBlocks };
  });

/**
 * Log the progress and the estimated time of the backfill every 5 seconds,
 * until interrupted.
 */
export const logBackfillProgress: Effect.Effect<never, never, Metrics> =
  Effect.gen(function* () {
    const metrics = yield* Metrics;

    // underlying metrics collection is actually synchronous
    // https://github.com/siimon/prom-client/blob/master/lib/histogram.js#L102-L125
    const { eta, progress } = yield* Effect.promise(() =>
      getAppProgress(metrics),
    );
    if (eta === undefined && progress === undefined) {
      return;
    }

    yield* Effect.logInfo({
      msg: "Updated backfill indexing progress",
      progress: progress === undefined ? undefined : formatPercentage(progress),
      estimate: eta === undefined ? undefined : formatEta(eta * 1_000),
    });
  }).pipe(Effect.delay(5_000), Effect.forever);

/**
 * Run `f` for each backfill batch of `stream`, and record the time that the
 * backfill spends fetching the batches ("extract") and indexing them
 * ("transform").
 */
export const runBackfill = <A, E, R, E2, R2>(
  stream: Stream.Stream<A, E, R>,
  f: (value: A) => Effect.Effect<void, E2, R2>,
): Effect.Effect<void, E | E2, R | R2 | Metrics> =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;
    let extractEndClock = yield* startClockEffect;

    yield* Stream.runForEach(stream, (value) =>
      Effect.gen(function* () {
        const extractDuration = yield* extractEndClock;
        const transformEndClock = yield* startClockEffect;

        yield* f(value);

        metrics.ponder_historical_concurrency_group_duration.inc(
          { group: "extract" },
          extractDuration,
        );
        metrics.ponder_historical_concurrency_group_duration.inc(
          { group: "transform" },
          yield* transformEndClock,
        );

        extractEndClock = yield* startClockEffect;
      }),
    );
  });
