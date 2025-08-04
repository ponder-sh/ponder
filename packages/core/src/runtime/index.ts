import type {
  Chain,
  FactoryId,
  Filter,
  Fragment,
  LightBlock,
  PerChainPonderApp,
  PonderApp,
} from "@/internal/types.js";
import type { SyncBlock } from "@/internal/types.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  type Checkpoint,
  MAX_CHECKPOINT,
  blockToCheckpoint,
  decodeCheckpoint,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import {
  type Interval,
  intervalIntersection,
  intervalIntersectionMany,
  sortIntervals,
} from "@/utils/interval.js";
import { _eth_getBlockByNumber } from "@/utils/rpc.js";
import { type Address, hexToNumber, toHex } from "viem";
import { isAddressFactory } from "./filter.js";
import { getFragments } from "./fragments.js";

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

export async function getLocalSyncProgress(
  app: PerChainPonderApp,
  { cachedIntervals }: { cachedIntervals: CachedIntervals },
): Promise<SyncProgress> {
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
          app.indexingBuild.chain.id,
          // The checkpoint returned by this function is meant to be used in
          // a closed interval (includes endpoints), so "start" should be inclusive.
          tag === "start" ? "down" : "up",
        ),
      );
    },
  } as SyncProgress;

  const filters = getFilters(app);

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

  const cached = getCachedBlock({ filters, cachedIntervals });

  const diagnostics = await Promise.all(
    cached === undefined
      ? [
          app.indexingBuild.rpc.request({ method: "eth_chainId" }),
          _eth_getBlockByNumber(app.indexingBuild.rpc, { blockNumber: start }),
        ]
      : [
          app.indexingBuild.rpc.request({ method: "eth_chainId" }),
          _eth_getBlockByNumber(app.indexingBuild.rpc, { blockNumber: start }),
          _eth_getBlockByNumber(app.indexingBuild.rpc, { blockNumber: cached }),
        ],
  );

  syncProgress.finalized = app.indexingBuild.finalizedBlock;
  syncProgress.start = diagnostics[1];
  if (diagnostics.length === 3) {
    syncProgress.current = diagnostics[2];
  }

  // Warn if the config has a different chainId than the remote.
  if (hexToNumber(diagnostics[0]) !== app.indexingBuild.chain.id) {
    app.common.logger.warn({
      service: "sync",
      msg: `Remote chain ID (${diagnostics[0]}) does not match configured chain ID (${app.indexingBuild.chain.id}) for chain "${app.indexingBuild.chain.name}"`,
    });
  }

  if (filters.some((filter) => filter.toBlock === undefined)) {
    return syncProgress;
  }

  // Latest `toBlock` among all `filters`
  const end = Math.max(...filters.map((filter) => filter.toBlock!));

  if (end > hexToNumber(app.indexingBuild.finalizedBlock.number)) {
    syncProgress.end = {
      number: toHex(end),
      hash: "0x",
      parentHash: "0x",
      timestamp: toHex(MAX_CHECKPOINT.blockTimestamp),
    } satisfies LightBlock;
  } else {
    syncProgress.end = await _eth_getBlockByNumber(app.indexingBuild.rpc, {
      blockNumber: end,
    });
  }

  return syncProgress;
}

export async function getChildAddresses(
  app: PerChainPonderApp,
  { syncStore }: { syncStore: SyncStore },
): Promise<ChildAddresses> {
  const childAddresses: ChildAddresses = new Map();
  for (const filter of getFilters(app)) {
    switch (filter.type) {
      case "log":
        if (isAddressFactory(filter.address)) {
          const _childAddresses = await syncStore.getChildAddresses({
            factory: filter.address,
          });
          childAddresses.set(filter.address.id, _childAddresses);
        }
        break;
      case "transaction":
      case "transfer":
      case "trace":
        if (isAddressFactory(filter.fromAddress)) {
          const _childAddresses = await syncStore.getChildAddresses({
            factory: filter.fromAddress,
          });
          childAddresses.set(filter.fromAddress.id, _childAddresses);
        }

        if (isAddressFactory(filter.toAddress)) {
          const _childAddresses = await syncStore.getChildAddresses({
            factory: filter.toAddress,
          });
          childAddresses.set(filter.toAddress.id, _childAddresses);
        }

        break;
    }
  }
  return childAddresses;
}

export async function getCachedIntervals(
  app: PerChainPonderApp,
  { syncStore }: { syncStore: SyncStore },
): Promise<CachedIntervals> {
  /**
   * Intervals that have been completed for all filters in `args.sources`.
   *
   * Note: `intervalsCache` is not updated after a new interval is synced.
   */
  let cachedIntervals: CachedIntervals;
  if (app.indexingBuild.chain.disableCache) {
    cachedIntervals = new Map();
    for (const filter of getFilters(app)) {
      cachedIntervals.set(filter, []);
      for (const { fragment } of getFragments(filter)) {
        cachedIntervals.get(filter)!.push({ fragment, intervals: [] });
      }
    }
  } else {
    cachedIntervals = await syncStore.getIntervals({
      filters: getFilters(app),
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

export const getPerChainPonderApp = (app: PonderApp): PerChainPonderApp[] => {
  const perChainApps: PerChainPonderApp[] = [];
  for (const indexingBuild of app.indexingBuild) {
    perChainApps.push({ ...app, indexingBuild });
  }
  return perChainApps;
};

export const getFilters = (app: PerChainPonderApp): Filter[] => {
  const filters = new Set<Filter>();
  for (const eventCallback of app.indexingBuild.eventCallbacks) {
    filters.add(eventCallback.filter);
  }
  return Array.from(filters);
};

export const findChain = (
  app: PonderApp,
  idOrCheckpoint: number | string | Checkpoint,
): Chain => {
  let id: number;
  if (typeof idOrCheckpoint === "number") {
    id = idOrCheckpoint;
  } else if (typeof idOrCheckpoint === "string") {
    const checkpoint = decodeCheckpoint(idOrCheckpoint);
    id = Number(checkpoint.chainId);
  } else {
    id = Number(idOrCheckpoint.chainId);
  }
  return app.indexingBuild.find((ib) => ib.chain.id === id)!.chain;
};
