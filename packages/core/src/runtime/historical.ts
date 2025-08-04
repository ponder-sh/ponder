import type {
  Chain,
  CrashRecoveryCheckpoint,
  Event,
  FactoryId,
  PerChainPonderApp,
  PonderApp,
} from "@/internal/types.js";
import { createHistoricalSync } from "@/sync-historical/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  MAX_CHECKPOINT,
  ZERO_CHECKPOINT,
  decodeCheckpoint,
  encodeCheckpoint,
  min,
} from "@/utils/checkpoint.js";
import { formatPercentage } from "@/utils/format.js";
import {
  bufferAsyncGenerator,
  mergeAsyncGenerators,
} from "@/utils/generators.js";
import {
  type Interval,
  intervalDifference,
  intervalIntersectionMany,
  intervalSum,
  intervalUnion,
} from "@/utils/interval.js";
import { partition } from "@/utils/partition.js";
import { startClock } from "@/utils/timer.js";
import { zipperMany } from "@/utils/zipper.js";
import { type Address, hexToNumber } from "viem";
import { buildEvents, decodeEvents } from "./events.js";
import { isAddressFactory } from "./filter.js";
import {
  type CachedIntervals,
  type ChildAddresses,
  type SyncProgress,
  getFilters,
  getPerChainPonderApp,
} from "./index.js";
import { getOmnichainCheckpoint } from "./omnichain.js";

export async function* getHistoricalEventsOmnichain(
  app: PonderApp,
  {
    crashRecoveryCheckpoint,
    perChainSync,
    syncStore,
  }: {
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
  },
): AsyncGenerator<
  | {
      type: "events";
      events: Event[];
      checkpoints: { chainId: number; checkpoint: string }[];
    }
  | {
      type: "pending";
      pendingEvents: Event[];
    }
> {
  let pendingEvents: Event[] = [];
  const to = min(
    getOmnichainCheckpoint({ perChainSync, tag: "finalized" }),
    getOmnichainCheckpoint({ perChainSync, tag: "end" }),
  );

  const eventGenerators = await Promise.all(
    getPerChainPonderApp(app).map(async function* (perChainApp) {
      const { syncProgress, childAddresses, cachedIntervals } =
        perChainSync.get(perChainApp.indexingBuild.chain)!;

      const _crashRecoveryCheckpoint = crashRecoveryCheckpoint?.find(
        ({ chainId }) => chainId === perChainApp.indexingBuild.chain.id,
      )?.checkpoint;

      // In order to speed up the "extract" phase when there is a crash recovery,
      // the beginning cursor is moved forwards. This only works when `crashRecoveryCheckpoint`
      // is defined.

      let from: string;
      if (_crashRecoveryCheckpoint === undefined) {
        from = syncProgress.getCheckpoint({ tag: "start" });
      } else if (
        Number(decodeCheckpoint(_crashRecoveryCheckpoint).chainId) ===
        perChainApp.indexingBuild.chain.id
      ) {
        from = _crashRecoveryCheckpoint;
      } else {
        const fromBlock = await syncStore.getSafeCrashRecoveryBlock({
          chainId: perChainApp.indexingBuild.chain.id,
          timestamp: Number(
            decodeCheckpoint(_crashRecoveryCheckpoint).blockTimestamp,
          ),
        });

        if (fromBlock === undefined) {
          from = syncProgress.getCheckpoint({ tag: "start" });
        } else {
          from = encodeCheckpoint({
            ...ZERO_CHECKPOINT,
            blockNumber: fromBlock.number,
            blockTimestamp: fromBlock.timestamp,
            chainId: BigInt(perChainApp.indexingBuild.chain.id),
          });
        }
      }

      const eventGenerator = getLocalEventGenerator(perChainApp, {
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
            perChainApp.common.options.syncEventsQuerySize /
              (app.indexingBuild.length + 1),
          ) + 6,
        syncStore,
      });

      for await (let { events: rawEvents, checkpoint } of eventGenerator) {
        const endClock = startClock();
        let events = decodeEvents(perChainApp, { rawEvents });
        perChainApp.common.logger.debug({
          service: "app",
          msg: `Decoded ${events.length} '${perChainApp.indexingBuild.chain.name}' events`,
        });
        perChainApp.common.metrics.ponder_historical_extract_duration.inc(
          { step: "decode" },
          endClock(),
        );

        // Removes events that have a checkpoint earlier than (or equal to)
        // the crash recovery checkpoint.

        if (
          _crashRecoveryCheckpoint &&
          events.length > 0 &&
          events[0]!.checkpoint <= _crashRecoveryCheckpoint
        ) {
          const [, right] = partition(
            events,
            (event) => event.checkpoint <= _crashRecoveryCheckpoint,
          );
          events = right;
        }

        // Sort out any events between the omnichain finalized checkpoint and the single-chain
        // finalized checkpoint and add them to pendingEvents. These events are synced during
        // the historical phase, but must be indexed in the realtime phase because events
        // synced in realtime on other chains might be ordered before them.

        if (checkpoint > to) {
          const [left, right] = partition(
            events,
            (event) => event.checkpoint <= to,
          );
          pendingEvents = pendingEvents.concat(right);
          events = left;
          checkpoint = to;
        }

        yield { events, checkpoint };
      }
    }),
  );

  const eventGenerator = mergeAsyncGeneratorsWithEventOrder(eventGenerators);

  for await (const { events, checkpoints } of eventGenerator) {
    app.common.logger.debug({
      service: "sync",
      msg: `Sequenced ${events.length} events`,
    });

    yield { type: "events", events, checkpoints };
  }
  yield { type: "pending", pendingEvents };
}

export async function* getHistoricalEventsMultichain(
  app: PonderApp,
  {
    crashRecoveryCheckpoint,
    perChainSync,
    syncStore,
  }: {
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
  },
) {
  const eventGenerators = await Promise.all(
    getPerChainPonderApp(app).map(async function* (perChainApp) {
      const { syncProgress, childAddresses, cachedIntervals } =
        perChainSync.get(perChainApp.indexingBuild.chain)!;

      const _crashRecoveryCheckpoint = crashRecoveryCheckpoint?.find(
        ({ chainId }) => chainId === perChainApp.indexingBuild.chain.id,
      )?.checkpoint;

      // In order to speed up the "extract" phase when there is a crash recovery,
      // the beginning cursor is moved forwards. This only works when `crashRecoveryCheckpoint`
      // is defined.

      let from: string;
      if (_crashRecoveryCheckpoint === undefined) {
        from = syncProgress.getCheckpoint({ tag: "start" });
      } else if (
        Number(decodeCheckpoint(_crashRecoveryCheckpoint).chainId) ===
        perChainApp.indexingBuild.chain.id
      ) {
        from = _crashRecoveryCheckpoint;
      } else {
        const fromBlock = await syncStore.getSafeCrashRecoveryBlock({
          chainId: perChainApp.indexingBuild.chain.id,
          timestamp: Number(
            decodeCheckpoint(_crashRecoveryCheckpoint).blockTimestamp,
          ),
        });

        if (fromBlock === undefined) {
          from = syncProgress.getCheckpoint({ tag: "start" });
        } else {
          from = encodeCheckpoint({
            ...ZERO_CHECKPOINT,
            blockNumber: fromBlock.number,
            blockTimestamp: fromBlock.timestamp,
            chainId: BigInt(perChainApp.indexingBuild.chain.id),
          });
        }
      }

      const eventGenerator = getLocalEventGenerator(perChainApp, {
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
            perChainApp.common.options.syncEventsQuerySize /
              (app.indexingBuild.length + 1),
          ) + 6,
        syncStore,
      });

      for await (const { events: rawEvents, checkpoint } of eventGenerator) {
        const endClock = startClock();
        let events = decodeEvents(perChainApp, { rawEvents });
        perChainApp.common.logger.debug({
          service: "app",
          msg: `Decoded ${events.length} '${perChainApp.indexingBuild.chain.name}' events`,
        });
        perChainApp.common.metrics.ponder_historical_extract_duration.inc(
          { step: "decode" },
          endClock(),
        );

        // Removes events that have a checkpoint earlier than (or equal to)
        // the crash recovery checkpoint.

        if (
          _crashRecoveryCheckpoint &&
          events.length > 0 &&
          events[0]!.checkpoint <= _crashRecoveryCheckpoint
        ) {
          const [, right] = partition(
            events,
            (event) => event.checkpoint <= _crashRecoveryCheckpoint,
          );
          events = right;
        }

        yield { events, checkpoint };
      }
    }),
  );

  for await (const { events, checkpoint } of mergeAsyncGenerators(
    eventGenerators,
  )) {
    app.common.logger.debug({
      service: "sync",
      msg: `Sequenced ${events.length} events`,
    });

    yield {
      events,
      checkpoints: [
        {
          chainId: Number(decodeCheckpoint(checkpoint).chainId),
          checkpoint,
        },
      ],
    };
  }
}

export async function* getLocalEventGenerator(
  app: PerChainPonderApp,
  {
    childAddresses,
    syncProgress,
    cachedIntervals,
    from,
    to,
    limit,
    syncStore,
  }: {
    childAddresses: Map<FactoryId, Map<Address, number>>;
    syncProgress: SyncProgress;
    cachedIntervals: CachedIntervals;
    from: string;
    to: string;
    limit: number;
    syncStore: SyncStore;
  },
) {
  const fromBlock = Number(decodeCheckpoint(from).blockNumber);
  const toBlock = Number(decodeCheckpoint(to).blockNumber);
  let cursor = fromBlock;

  const localSyncGenerator = getLocalSyncGenerator(app, {
    syncProgress,
    childAddresses,
    cachedIntervals,
  });

  app.common.logger.debug({
    service: "sync",
    msg: `Initialized '${app.indexingBuild.chain.name}' extract query for block range [${fromBlock}, ${toBlock}]`,
  });

  for await (const syncCursor of bufferAsyncGenerator(
    localSyncGenerator,
    Number.POSITIVE_INFINITY,
  )) {
    while (cursor <= Math.min(syncCursor, toBlock)) {
      const { blockData, cursor: queryCursor } =
        await syncStore.getEventBlockData({
          filters: getFilters(app),
          fromBlock: cursor,
          toBlock: Math.min(syncCursor, toBlock),
          chainId: app.indexingBuild.chain.id,
          limit,
        });

      const endClock = startClock();
      const events = blockData.flatMap((bd) =>
        buildEvents(app, {
          blockData: bd,
          childAddresses,
        }),
      );
      app.common.metrics.ponder_historical_extract_duration.inc(
        { step: "build" },
        endClock(),
      );

      app.common.logger.debug({
        service: "sync",
        msg: `Extracted ${events.length} '${app.indexingBuild.chain.name}' events for block range [${cursor}, ${queryCursor}]`,
      });

      await new Promise(setImmediate);

      cursor = queryCursor + 1;
      if (cursor === toBlock) {
        yield { events, checkpoint: to };
      } else if (blockData.length > 0) {
        const checkpoint = encodeCheckpoint({
          ...MAX_CHECKPOINT,
          blockTimestamp: blockData[blockData.length - 1]!.block.timestamp,
          chainId: BigInt(app.indexingBuild.chain.id),
          blockNumber: blockData[blockData.length - 1]!.block.number,
        });
        yield { events, checkpoint };
      }
    }
  }
}

export async function* getLocalSyncGenerator(
  app: PerChainPonderApp,
  {
    syncProgress,
    childAddresses,
    cachedIntervals,
  }: {
    syncProgress: SyncProgress;
    childAddresses: Map<FactoryId, Map<Address, number>>;
    cachedIntervals: CachedIntervals;
  },
) {
  const label = { chain: app.indexingBuild.chain.name };

  let cursor = hexToNumber(syncProgress.start.number);
  const last =
    syncProgress.end === undefined
      ? syncProgress.finalized
      : hexToNumber(syncProgress.end.number) >
          hexToNumber(syncProgress.finalized.number)
        ? syncProgress.finalized
        : syncProgress.end;

  // Estimate optimal range (blocks) to sync at a time, eventually to be used to
  // determine `interval` passed to `historicalSync.sync()`.
  let estimateRange = 25;

  // Handle two special cases:
  // 1. `syncProgress.start` > `syncProgress.finalized`
  // 2. `cached` is defined

  if (
    hexToNumber(syncProgress.start.number) >
    hexToNumber(syncProgress.finalized.number)
  ) {
    syncProgress.current = syncProgress.finalized;

    app.common.logger.warn({
      service: "sync",
      msg: `Skipped '${app.indexingBuild.chain.name}' historical sync because the start block is unfinalized`,
    });

    app.common.metrics.ponder_sync_block.set(
      label,
      hexToNumber(syncProgress.current.number),
    );
    app.common.metrics.ponder_sync_block_timestamp.set(
      label,
      hexToNumber(syncProgress.current.timestamp),
    );
    app.common.metrics.ponder_historical_total_blocks.set(label, 0);
    app.common.metrics.ponder_historical_cached_blocks.set(label, 0);

    return;
  }

  const totalInterval = [
    hexToNumber(syncProgress.start.number),
    hexToNumber(last!.number),
  ] satisfies Interval;

  app.common.logger.debug({
    service: "sync",
    msg: `Initialized '${app.indexingBuild.chain.name}' historical sync for block range [${totalInterval[0]}, ${totalInterval[1]}]`,
  });

  const requiredIntervals = Array.from(cachedIntervals.entries()).flatMap(
    ([filter, fragmentIntervals]) => {
      const filterIntervals: Interval[] = [
        [
          filter.fromBlock ?? 0,
          Math.min(
            filter.toBlock ?? Number.POSITIVE_INFINITY,
            totalInterval[1],
          ),
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
    },
  );

  const required = intervalSum(intervalUnion(requiredIntervals));
  const total = totalInterval[1] - totalInterval[0] + 1;

  app.common.metrics.ponder_historical_total_blocks.set(label, total);
  app.common.metrics.ponder_historical_cached_blocks.set(
    label,
    total - required,
  );

  // Handle cache hit
  if (syncProgress.current !== undefined) {
    app.common.metrics.ponder_sync_block.set(
      label,
      hexToNumber(syncProgress.current.number),
    );
    app.common.metrics.ponder_sync_block_timestamp.set(
      label,
      hexToNumber(syncProgress.current.timestamp),
    );

    // `getEvents` can make progress without calling `sync`, so immediately "yield"
    yield hexToNumber(syncProgress.current.number);

    if (
      hexToNumber(syncProgress.current.number) === hexToNumber(last!.number)
    ) {
      app.common.logger.info({
        service: "sync",
        msg: `Skipped '${app.indexingBuild.chain.name}' historical sync because all blocks are cached`,
      });
      return;
    } else {
      app.common.logger.info({
        service: "sync",
        msg: `Started '${app.indexingBuild.chain.name}' historical sync with ${formatPercentage(
          (total - required) / total,
        )} cached`,
      });
    }

    cursor = hexToNumber(syncProgress.current.number) + 1;
  } else {
    app.common.logger.info({
      service: "historical",
      msg: `Started '${app.indexingBuild.chain.name}' historical sync with 0% cached`,
    });
  }

  const historicalSync = createHistoricalSync(app, {
    childAddresses,
    cachedIntervals,
  });

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

    app.common.logger.debug({
      service: "sync",
      msg: `Synced ${interval[1] - interval[0] + 1} '${app.indexingBuild.chain.name}' blocks in range [${interval[0]}, ${interval[1]}]`,
    });

    // Update cursor to record progress
    cursor = interval[1] + 1;

    // `synced` will be undefined if a cache hit occur in `historicalSync.sync()`.

    if (synced === undefined) {
      // If the all known blocks are synced, then update `syncProgress.current`, else
      // progress to the next iteration.
      if (interval[1] === hexToNumber(last.number)) {
        syncProgress.current = last;
      } else {
        continue;
      }
    } else {
      if (interval[1] === hexToNumber(last.number)) {
        syncProgress.current = last;
      } else {
        syncProgress.current = synced;
      }

      const duration = endClock();

      app.common.metrics.ponder_sync_block.set(
        label,
        hexToNumber(syncProgress.current!.number),
      );
      app.common.metrics.ponder_sync_block_timestamp.set(
        label,
        hexToNumber(syncProgress.current!.timestamp),
      );
      app.common.metrics.ponder_historical_duration.observe(label, duration);
      app.common.metrics.ponder_historical_completed_blocks.inc(
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

      app.common.logger.trace({
        service: "sync",
        msg: `Updated '${app.indexingBuild.chain.name}' historical sync estimate to ${estimateRange} blocks`,
      });
    }

    yield hexToNumber(syncProgress.current!.number);

    if (syncProgress.isEnd() || syncProgress.isFinalized()) {
      app.common.logger.info({
        service: "sync",
        msg: `Completed '${app.indexingBuild.chain.name}' historical sync`,
      });
      return;
    }
  }
}

/**
 * Merges multiple event generators into a single generator while preserving
 * the order of events.
 *
 * @param generators - Generators to merge.
 * @returns A single generator that yields events from all generators.
 */
export async function* mergeAsyncGeneratorsWithEventOrder(
  generators: AsyncGenerator<{ events: Event[]; checkpoint: string }>[],
): AsyncGenerator<{
  events: Event[];
  /**
   * Closest-to-tip checkpoint for each chain,
   * excluding chains that were not updated with this batch of events.
   */
  checkpoints: { chainId: number; checkpoint: string }[];
}> {
  const results = await Promise.all(generators.map((gen) => gen.next()));

  while (results.some((res) => res.done !== true)) {
    const supremum = min(
      ...results.map((res) => (res.done ? undefined : res.value.checkpoint)),
    );

    const eventArrays: {
      events: Event[];
      chainId: number;
      checkpoint: string;
    }[] = [];

    for (const result of results) {
      if (result.done === false) {
        const [left, right] = partition(
          result.value.events,
          (event) => event.checkpoint <= supremum,
        );

        const event = left[left.length - 1];

        if (event) {
          eventArrays.push({
            events: left,
            chainId: event.chain.id,
            checkpoint: event.checkpoint,
          });
        }

        result.value.events = right;
      }
    }

    const events = zipperMany(eventArrays.map(({ events }) => events)).sort(
      (a, b) => (a.checkpoint < b.checkpoint ? -1 : 1),
    );

    const index = results.findIndex(
      (res) => res.done === false && res.value.checkpoint === supremum,
    );

    const resultPromise = generators[index]!.next();
    if (events.length > 0) {
      const checkpoints = eventArrays.map(({ chainId, checkpoint }) => ({
        chainId,
        checkpoint,
      }));

      yield { events, checkpoints };
    }
    results[index] = await resultPromise;
  }
}
