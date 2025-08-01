import type { Common } from "@/internal/common.js";
import type {
  Chain,
  CrashRecoveryCheckpoint,
  FactoryId,
  IndexingBuild,
  Source,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import { createHistoricalSync } from "@/sync-historical/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import { buildEvents, decodeEvents } from "@/sync/events.js";
import { isAddressFactory } from "@/sync/filter.js";
import { mergeAsyncGeneratorsWithEventOrder } from "@/sync/index.js";
import {
  MAX_CHECKPOINT,
  ZERO_CHECKPOINT,
  decodeCheckpoint,
  encodeCheckpoint,
  min,
} from "@/utils/checkpoint.js";
import { formatPercentage } from "@/utils/format.js";
import { bufferAsyncGenerator } from "@/utils/generators.js";
import {
  type Interval,
  intervalDifference,
  intervalIntersectionMany,
  intervalSum,
  intervalUnion,
} from "@/utils/interval.js";
import { partition } from "@/utils/partition.js";
import { startClock } from "@/utils/timer.js";
import { type Address, hexToNumber } from "viem";
import type { CachedIntervals, ChildAddresses, SyncProgress } from "./index.js";

export async function* getHistoricalEventsOmnichain(params: {
  common: Common;
  indexingBuild: Pick<
    IndexingBuild,
    "sources" | "chains" | "rpcs" | "finalizedBlocks"
  >;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  perChainSync: Map<
    Chain,
    {
      syncProgress: SyncProgress;
      childAddresses: ChildAddresses;
      cachedIntervals: CachedIntervals;
    }
  >;
  syncStore: SyncStore;
}) {
  const eventGenerators = await Promise.all(
    Array.from(params.perChainSync.entries()).map(async function* ([
      chain,
      { syncProgress, childAddresses, cachedIntervals },
    ]) {
      const rpc =
        params.indexingBuild.rpcs[
          params.indexingBuild.chains.findIndex((c) => c.id === chain.id)
        ]!;

      const sources = params.indexingBuild.sources.filter(
        ({ filter }) => filter.chainId === chain.id,
      );

      const crashRecoveryCheckpoint = params.crashRecoveryCheckpoint?.find(
        ({ chainId }) => chainId === chain.id,
      )?.checkpoint;

      // In order to speed up the "extract" phase when there is a crash recovery,
      // the beginning cursor is moved forwards. This only works when `crashRecoveryCheckpoint`
      // is defined.

      let from: string;
      if (crashRecoveryCheckpoint === undefined) {
        from = syncProgress.getCheckpoint({ tag: "start" });
      } else if (
        Number(decodeCheckpoint(crashRecoveryCheckpoint).chainId) === chain.id
      ) {
        from = crashRecoveryCheckpoint;
      } else {
        const fromBlock = await params.syncStore.getSafeCrashRecoveryBlock({
          chainId: chain.id,
          timestamp: Number(
            decodeCheckpoint(crashRecoveryCheckpoint).blockTimestamp,
          ),
        });

        if (fromBlock === undefined) {
          from = syncProgress.getCheckpoint({ tag: "start" });
        } else {
          from = encodeCheckpoint({
            ...ZERO_CHECKPOINT,
            blockNumber: fromBlock.number,
            blockTimestamp: fromBlock.timestamp,
            chainId: BigInt(chain.id),
          });
        }
      }

      const eventGenerator = getLocalEventGenerator({
        common: params.common,
        chain,
        rpc,
        sources,
        childAddresses,
        syncProgress,
        cachedIntervals,
        from,
        to: min(
          syncProgress.getCheckpoint({ tag: "finalized" }),
          syncProgress.getCheckpoint({ tag: "end" }),
        ),
        limit:
          Math.round(
            params.common.options.syncEventsQuerySize /
              (params.indexingBuild.chains.length + 1),
          ) + 6,
        syncStore: params.syncStore,
      });

      for await (const { events: rawEvents, checkpoint } of eventGenerator) {
        const endClock = startClock();
        let events = decodeEvents(params.common, sources, rawEvents);
        params.common.logger.debug({
          service: "app",
          msg: `Decoded ${events.length} '${chain.name}' events`,
        });
        params.common.metrics.ponder_historical_extract_duration.inc(
          { step: "decode" },
          endClock(),
        );

        // Removes events that have a checkpoint earlier than (or equal to)
        // the crash recovery checkpoint.

        if (
          crashRecoveryCheckpoint &&
          events.length > 0 &&
          events[0]!.checkpoint <= crashRecoveryCheckpoint
        ) {
          const [, right] = partition(
            events,
            (event) => event.checkpoint <= crashRecoveryCheckpoint,
          );
          events = right;
        }

        yield { events, checkpoint };
      }
    }),
  );

  const eventGenerator = mergeAsyncGeneratorsWithEventOrder(eventGenerators);

  for await (const { events, checkpoints } of eventGenerator) {
    params.common.logger.debug({
      service: "sync",
      msg: `Sequenced ${events.length} events`,
    });

    yield { events, checkpoints };
  }
}

export async function* getHistoricalEventsMultichain() {}

export async function* getHistoricalEventsIsolated() {}

export async function* getLocalEventGenerator(params: {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  sources: Source[];
  childAddresses: Map<FactoryId, Map<Address, number>>;
  syncProgress: SyncProgress;
  cachedIntervals: CachedIntervals;
  from: string;
  to: string;
  limit: number;
  syncStore: SyncStore;
}) {
  const fromBlock = Number(decodeCheckpoint(params.from).blockNumber);
  const toBlock = Number(decodeCheckpoint(params.to).blockNumber);
  let cursor = fromBlock;

  const localSyncGenerator = getLocalSyncGenerator(params);

  params.common.logger.debug({
    service: "sync",
    msg: `Initialized '${params.chain.name}' extract query for block range [${fromBlock}, ${toBlock}]`,
  });

  for await (const syncCursor of bufferAsyncGenerator(
    localSyncGenerator,
    Number.POSITIVE_INFINITY,
  )) {
    while (cursor <= Math.min(syncCursor, toBlock)) {
      const { blockData, cursor: queryCursor } =
        await params.syncStore.getEventBlockData({
          filters: params.sources.map(({ filter }) => filter),
          fromBlock: cursor,
          toBlock: Math.min(syncCursor, toBlock),
          chainId: params.chain.id,
          limit: params.limit,
        });

      const endClock = startClock();
      const events = blockData.flatMap((bd) =>
        buildEvents({
          sources: params.sources,
          blockData: bd,
          childAddresses: params.childAddresses,
          chainId: params.chain.id,
        }),
      );
      params.common.metrics.ponder_historical_extract_duration.inc(
        { step: "build" },
        endClock(),
      );

      params.common.logger.debug({
        service: "sync",
        msg: `Extracted ${events.length} '${params.chain.name}' events for block range [${cursor}, ${queryCursor}]`,
      });

      await new Promise(setImmediate);

      cursor = queryCursor + 1;
      if (cursor === toBlock) {
        yield { events, checkpoint: params.to };
      } else if (blockData.length > 0) {
        const checkpoint = encodeCheckpoint({
          ...MAX_CHECKPOINT,
          blockTimestamp: blockData[blockData.length - 1]!.block.timestamp,
          chainId: BigInt(params.chain.id),
          blockNumber: blockData[blockData.length - 1]!.block.number,
        });
        yield { events, checkpoint };
      }
    }
  }
}

export async function* getLocalSyncGenerator(params: {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  sources: Source[];
  syncProgress: SyncProgress;
  childAddresses: Map<FactoryId, Map<Address, number>>;
  cachedIntervals: CachedIntervals;
  syncStore: SyncStore;
}) {
  const label = { chain: params.chain.name };

  let cursor = hexToNumber(params.syncProgress.start.number);
  const last =
    params.syncProgress.end === undefined
      ? params.syncProgress.finalized
      : hexToNumber(params.syncProgress.end.number) >
          hexToNumber(params.syncProgress.finalized.number)
        ? params.syncProgress.finalized
        : params.syncProgress.end;

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
      service: "sync",
      msg: `Skipped '${params.chain.name}' historical sync because the start block is unfinalized`,
    });

    params.common.metrics.ponder_sync_block.set(
      label,
      hexToNumber(params.syncProgress.current.number),
    );
    params.common.metrics.ponder_sync_block_timestamp.set(
      label,
      hexToNumber(params.syncProgress.current.timestamp),
    );
    params.common.metrics.ponder_historical_total_blocks.set(label, 0);
    params.common.metrics.ponder_historical_cached_blocks.set(label, 0);

    return;
  }

  const totalInterval = [
    hexToNumber(params.syncProgress.start.number),
    hexToNumber(last!.number),
  ] satisfies Interval;

  params.common.logger.debug({
    service: "sync",
    msg: `Initialized '${params.chain.name}' historical sync for block range [${totalInterval[0]}, ${totalInterval[1]}]`,
  });

  const requiredIntervals = Array.from(
    params.cachedIntervals.entries(),
  ).flatMap(([filter, fragmentIntervals]) => {
    const filterIntervals: Interval[] = [
      [
        filter.fromBlock ?? 0,
        Math.min(filter.toBlock ?? Number.POSITIVE_INFINITY, totalInterval[1]),
      ],
    ];

    switch (filter.type) {
      case "log":
        if (isAddressFactory(filter.address)) {
          filterIntervals.push([
            filter.address.fromBlock ?? 0,
            Math.min(
              filter.address.toBlock ?? Number.POSITIVE_INFINITY,
              totalInterval[1],
            ),
          ]);
        }
        break;
      case "trace":
      case "transaction":
      case "transfer":
        if (isAddressFactory(filter.fromAddress)) {
          filterIntervals.push([
            filter.fromAddress.fromBlock ?? 0,
            Math.min(
              filter.fromAddress.toBlock ?? Number.POSITIVE_INFINITY,
              totalInterval[1],
            ),
          ]);
        }

        if (isAddressFactory(filter.toAddress)) {
          filterIntervals.push([
            filter.toAddress.fromBlock ?? 0,
            Math.min(
              filter.toAddress.toBlock ?? Number.POSITIVE_INFINITY,
              totalInterval[1],
            ),
          ]);
        }
    }

    return intervalDifference(
      intervalUnion(filterIntervals),
      intervalIntersectionMany(
        fragmentIntervals.map(({ intervals }) => intervals),
      ),
    );
  });

  const required = intervalSum(intervalUnion(requiredIntervals));
  const total = totalInterval[1] - totalInterval[0] + 1;

  params.common.metrics.ponder_historical_total_blocks.set(label, total);
  params.common.metrics.ponder_historical_cached_blocks.set(
    label,
    total - required,
  );

  // Handle cache hit
  if (params.syncProgress.current !== undefined) {
    params.common.metrics.ponder_sync_block.set(
      label,
      hexToNumber(params.syncProgress.current.number),
    );
    params.common.metrics.ponder_sync_block_timestamp.set(
      label,
      hexToNumber(params.syncProgress.current.timestamp),
    );

    // `getEvents` can make progress without calling `sync`, so immediately "yield"
    yield hexToNumber(params.syncProgress.current.number);

    if (
      hexToNumber(params.syncProgress.current.number) ===
      hexToNumber(last!.number)
    ) {
      params.common.logger.info({
        service: "sync",
        msg: `Skipped '${params.chain.name}' historical sync because all blocks are cached`,
      });
      return;
    } else {
      params.common.logger.info({
        service: "sync",
        msg: `Started '${params.chain.name}' historical sync with ${formatPercentage(
          (total - required) / total,
        )} cached`,
      });
    }

    cursor = hexToNumber(params.syncProgress.current.number) + 1;
  } else {
    params.common.logger.info({
      service: "historical",
      msg: `Started '${params.chain.name}' historical sync with 0% cached`,
    });
  }

  const historicalSync = createHistoricalSync(params);

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

    params.common.logger.debug({
      service: "sync",
      msg: `Synced ${interval[1] - interval[0] + 1} '${params.chain.name}' blocks in range [${interval[0]}, ${interval[1]}]`,
    });

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
        hexToNumber(params.syncProgress.current!.number),
      );
      params.common.metrics.ponder_sync_block_timestamp.set(
        label,
        hexToNumber(params.syncProgress.current!.timestamp),
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

      params.common.logger.trace({
        service: "sync",
        msg: `Updated '${params.chain.name}' historical sync estimate to ${estimateRange} blocks`,
      });
    }

    yield hexToNumber(params.syncProgress.current!.number);

    if (params.syncProgress.isEnd() || params.syncProgress.isFinalized()) {
      params.common.logger.info({
        service: "sync",
        msg: `Completed '${params.chain.name}' historical sync`,
      });
      return;
    }
  }
}
