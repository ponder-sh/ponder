import type { Common } from "@/internal/common.js";
import { ShutdownError } from "@/internal/errors.js";
import type {
  Chain,
  CrashRecoveryCheckpoint,
  Event,
  IndexingBuild,
  RawEvent,
  Source,
  SyncBlock,
} from "@/internal/types.js";
import { _eth_getBlockByNumber } from "@/rpc/actions.js";
import type { Rpc } from "@/rpc/index.js";
import { buildEvents, decodeEvents } from "@/runtime/events.js";
import { isAddressFactory } from "@/runtime/filter.js";
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
import { hexToNumber } from "viem";
import type { CachedIntervals, ChildAddresses, SyncProgress } from "./index.js";
import { initEventGenerator, initRefetchEvents } from "./init.js";
import { getOmnichainCheckpoint } from "./omnichain.js";

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
}): AsyncGenerator<
  | {
      type: "events";
      result: {
        chainId: number;
        events: Event[];
        checkpoint: string;
        blockRange: [number, number];
      }[];
    }
  | { type: "pending"; result: Event[] }
> {
  let pendingEvents: Event[] = [];
  let isCatchup = false;
  const perChainCursor = new Map<Chain, string>();

  while (true) {
    const eventGenerators = Array.from(params.perChainSync.entries()).map(
      async function* ([
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

        const to = min(
          syncProgress.getCheckpoint({ tag: "finalized" }),
          syncProgress.getCheckpoint({ tag: "end" }),
        );
        const omnichainTo = min(
          getOmnichainCheckpoint({
            perChainSync: params.perChainSync,
            tag: "finalized",
          }),
          getOmnichainCheckpoint({
            perChainSync: params.perChainSync,
            tag: "end",
          }),
        );
        let from: string;

        if (isCatchup === false) {
          // In order to speed up the "extract" phase when there is a crash recovery,
          // the beginning cursor is moved forwards. This only works when `crashRecoveryCheckpoint`
          // is defined.

          if (crashRecoveryCheckpoint === undefined) {
            from = syncProgress.getCheckpoint({ tag: "start" });
          } else if (
            Number(decodeCheckpoint(crashRecoveryCheckpoint).chainId) ===
            chain.id
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
        } else {
          const cursor = perChainCursor.get(chain)!;

          // Yield pending events from previous iterations. Note that it is possible to
          // previous pending events to still be pending after the catchup.

          const events = pendingEvents.filter(
            (event) =>
              event.chainId === chain.id && event.checkpoint <= omnichainTo,
          );

          pendingEvents = pendingEvents.filter(
            (event) =>
              (event.chainId === chain.id &&
                event.checkpoint <= omnichainTo) === false,
          );

          const blockRange = [
            Number(decodeCheckpoint(cursor).blockNumber),
            events.length > 0
              ? Number(
                  decodeCheckpoint(events[events.length - 1]!.checkpoint)
                    .blockNumber,
                )
              : Number(decodeCheckpoint(cursor).blockNumber),
          ] satisfies [number, number];

          yield { events, checkpoint: min(cursor, omnichainTo), blockRange };

          from = encodeCheckpoint({
            ...ZERO_CHECKPOINT,
            blockTimestamp: decodeCheckpoint(cursor).blockTimestamp,
            chainId: decodeCheckpoint(cursor).chainId,
            blockNumber: decodeCheckpoint(cursor).blockNumber + 1n,
          });

          if (from > to) return;
        }

        params.common.logger.info({
          msg: "Started backfill indexing",
          chain: chain.name,
          chain_id: chain.id,
          block_range: JSON.stringify([
            Number(decodeCheckpoint(from).blockNumber),
            Number(decodeCheckpoint(to).blockNumber),
          ]),
        });

        const eventGenerator = await initEventGenerator({
          common: params.common,
          indexingBuild: params.indexingBuild,
          chain,
          rpc,
          sources,
          childAddresses,
          syncProgress,
          cachedIntervals,
          from,
          to,
          limit:
            Math.round(
              params.common.options.syncEventsQuerySize /
                (params.indexingBuild.chains.length + 1),
            ) + 6,
          syncStore: params.syncStore,
          isCatchup,
        });

        for await (let {
          events: rawEvents,
          checkpoint,
          blockRange,
        } of eventGenerator) {
          const endClock = startClock();

          let events = decodeEvents(params.common, sources, rawEvents);

          params.common.logger.trace({
            msg: "Decoded events",
            chain: chain.name,
            chain_id: chain.id,
            event_count: events.length,
            duration: endClock(),
          });

          params.common.metrics.ponder_historical_extract_duration.inc(
            { step: "decode" },
            endClock(),
          );

          // Removes events that have a checkpoint earlier than (or equal to)
          // the crash recovery checkpoint.

          if (crashRecoveryCheckpoint) {
            const [left, right] = partition(
              events,
              (event) => event.checkpoint <= crashRecoveryCheckpoint,
            );
            events = right;

            if (left.length > 0) {
              params.common.logger.trace({
                msg: "Filtered events before crash recovery checkpoint",
                chain: chain.name,
                chain_id: chain.id,
                event_count: left.length,
                checkpoint: crashRecoveryCheckpoint,
              });
            }
          }

          // Sort out any events between the omnichain finalized checkpoint and the single-chain
          // finalized checkpoint and add them to pendingEvents. These events are synced during
          // the historical phase, but must be indexed in the realtime phase because events
          // synced in realtime on other chains might be ordered before them.

          if (checkpoint > omnichainTo) {
            const [left, right] = partition(
              events,
              (event) => event.checkpoint <= omnichainTo,
            );
            pendingEvents = pendingEvents.concat(right);
            events = left;
            checkpoint = omnichainTo;

            if (left.length > 0) {
              blockRange[1] = Number(
                decodeCheckpoint(left[left.length - 1]!.checkpoint).blockNumber,
              );
            } else {
              blockRange[1] = blockRange[0];
            }

            params.common.logger.trace({
              msg: "Filtered pending events",
              chain: chain.name,
              chain_id: chain.id,
              event_count: right.length,
              checkpoint: omnichainTo,
            });
          }

          yield { events, checkpoint, blockRange };
        }

        perChainCursor.set(chain, to);
      },
    );

    const eventGenerator = mergeAsyncGeneratorsWithEventOrder(eventGenerators);

    for await (const mergeResults of eventGenerator) {
      yield { type: "events", result: mergeResults };
    }

    const context = {
      logger: params.common.logger.child({ action: "refetch_finalized_block" }),
      retryNullBlockRequest: true,
    };

    const endClock = startClock();

    const finalizedBlocks = await Promise.all(
      params.indexingBuild.chains.map((chain, i) => {
        const rpc = params.indexingBuild.rpcs[i]!;

        return _eth_getBlockByNumber(rpc, { blockTag: "latest" }, context)
          .then((latest) =>
            _eth_getBlockByNumber(
              rpc,
              {
                blockNumber: Math.max(
                  hexToNumber(latest.number) - chain.finalityBlockCount,
                  0,
                ),
              },
              context,
            ),
          )
          .then((finalizedBlock) => {
            const finalizedBlockNumber = hexToNumber(finalizedBlock.number);
            params.common.logger.debug({
              msg: "Refetched finalized block for backfill cutover",
              chain: chain.name,
              chain_id: chain.id,
              finalized_block: finalizedBlockNumber,
              duration: endClock(),
            });

            return finalizedBlock;
          });
      }),
    );

    let shouldCatchup = false;

    for (let i = 0; i < params.indexingBuild.chains.length; i++) {
      const chain = params.indexingBuild.chains[i]!;
      const oldFinalizedBlock =
        params.perChainSync.get(chain)!.syncProgress.finalized;
      const newFinalizedBlock = finalizedBlocks[i]!;

      if (
        hexToNumber(newFinalizedBlock.number) -
          hexToNumber(oldFinalizedBlock.number) >
        chain.finalityBlockCount
      ) {
        shouldCatchup = true;
        break;
      }
    }

    if (shouldCatchup === false) break;

    for (let i = 0; i < params.indexingBuild.chains.length; i++) {
      const chain = params.indexingBuild.chains[i]!;
      const finalizedBlock = finalizedBlocks[i]!;

      params.perChainSync.get(chain)!.syncProgress.finalized = finalizedBlock;
    }

    isCatchup = true;
  }

  yield { type: "pending", result: pendingEvents };
}

export async function* getHistoricalEventsMultichain(params: {
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
  let isCatchup = false;
  let lastUnfinalizedRefetch = Date.now();
  const perChainCursor = new Map<Chain, string>();

  while (true) {
    const eventGenerators = Array.from(params.perChainSync.entries()).map(
      async function* ([
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

        const to = min(
          syncProgress.getCheckpoint({ tag: "finalized" }),
          syncProgress.getCheckpoint({ tag: "end" }),
        );
        let from: string;

        if (isCatchup === false) {
          // In order to speed up the "extract" phase when there is a crash recovery,
          // the beginning cursor is moved forwards. This only works when `crashRecoveryCheckpoint`
          // is defined.

          if (crashRecoveryCheckpoint === undefined) {
            from = syncProgress.getCheckpoint({ tag: "start" });
          } else if (
            Number(decodeCheckpoint(crashRecoveryCheckpoint).chainId) ===
            chain.id
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
        } else {
          const cursor = perChainCursor.get(chain)!;

          from = encodeCheckpoint({
            ...ZERO_CHECKPOINT,
            blockTimestamp: decodeCheckpoint(cursor).blockTimestamp,
            chainId: decodeCheckpoint(cursor).chainId,
            blockNumber: decodeCheckpoint(cursor).blockNumber + 1n,
          });

          if (from > to) return;
        }

        params.common.logger.info({
          msg: "Started backfill indexing",
          chain: chain.name,
          chain_id: chain.id,
          block_range: JSON.stringify([
            Number(decodeCheckpoint(from).blockNumber),
            Number(decodeCheckpoint(to).blockNumber),
          ]),
        });

        const eventGenerator = await initEventGenerator({
          common: params.common,
          indexingBuild: params.indexingBuild,
          chain,
          rpc,
          sources,
          childAddresses,
          syncProgress,
          cachedIntervals,
          from,
          to,
          limit:
            Math.round(
              params.common.options.syncEventsQuerySize /
                (params.indexingBuild.chains.length + 1),
            ) + 6,
          syncStore: params.syncStore,
          isCatchup,
        });

        for await (const {
          events: rawEvents,
          checkpoint,
          blockRange,
        } of eventGenerator) {
          const endClock = startClock();

          let events = decodeEvents(params.common, sources, rawEvents);

          params.common.logger.trace({
            msg: "Decoded events",
            chain: chain.name,
            chain_id: chain.id,
            event_count: events.length,
            duration: endClock(),
          });

          params.common.metrics.ponder_historical_extract_duration.inc(
            { step: "decode" },
            endClock(),
          );

          // Removes events that have a checkpoint earlier than (or equal to)
          // the crash recovery checkpoint.

          if (crashRecoveryCheckpoint) {
            const [left, right] = partition(
              events,
              (event) => event.checkpoint <= crashRecoveryCheckpoint,
            );
            events = right;

            if (left.length > 0) {
              params.common.logger.trace({
                msg: "Filtered events before crash recovery checkpoint",
                chain: chain.name,
                chain_id: chain.id,
                event_count: left.length,
                checkpoint: crashRecoveryCheckpoint,
              });
            }
          }

          yield { chainId: chain.id, events, checkpoint, blockRange };
        }

        perChainCursor.set(chain, to);
      },
    );

    yield* mergeAsyncGenerators(eventGenerators);

    if (Date.now() - lastUnfinalizedRefetch < 30_000) {
      break;
    }
    lastUnfinalizedRefetch = Date.now();

    const context = {
      logger: params.common.logger.child({ action: "refetch_finalized_block" }),
      retryNullBlockRequest: true,
    };

    const endClock = startClock();

    const finalizedBlocks = await Promise.all(
      params.indexingBuild.chains.map((chain, i) => {
        const rpc = params.indexingBuild.rpcs[i]!;

        return _eth_getBlockByNumber(rpc, { blockTag: "latest" }, context)
          .then((latest) =>
            _eth_getBlockByNumber(
              rpc,
              {
                blockNumber: Math.max(
                  hexToNumber(latest.number) - chain.finalityBlockCount,
                  0,
                ),
              },
              context,
            ),
          )
          .then((finalizedBlock) => {
            const finalizedBlockNumber = hexToNumber(finalizedBlock.number);
            params.common.logger.debug({
              msg: "Refetched finalized block for backfill cutover",
              chain: chain.name,
              chain_id: chain.id,
              finalized_block: finalizedBlockNumber,
              duration: endClock(),
            });

            return finalizedBlock;
          });
      }),
    );

    let shouldCatchup = false;

    for (let i = 0; i < params.indexingBuild.chains.length; i++) {
      const chain = params.indexingBuild.chains[i]!;
      const oldFinalizedBlock =
        params.perChainSync.get(chain)!.syncProgress.finalized;
      const newFinalizedBlock = finalizedBlocks[i]!;

      if (
        hexToNumber(newFinalizedBlock.number) -
          hexToNumber(oldFinalizedBlock.number) >
        chain.finalityBlockCount
      ) {
        shouldCatchup = true;
        break;
      }
    }

    if (shouldCatchup === false) break;

    for (let i = 0; i < params.indexingBuild.chains.length; i++) {
      const chain = params.indexingBuild.chains[i]!;
      const finalizedBlock = finalizedBlocks[i]!;

      params.perChainSync.get(chain)!.syncProgress.finalized = finalizedBlock;
    }

    isCatchup = true;
  }
}

export async function refetchHistoricalEvents(params: {
  common: Common;
  indexingBuild: Pick<IndexingBuild, "sources" | "chains">;
  perChainSync: Map<Chain, { childAddresses: ChildAddresses }>;
  events: Event[];
  syncStore: SyncStore;
}): Promise<Event[]> {
  const events: Event[] = new Array(params.events.length);

  for (const chain of PONDER_INDEXING_BUILD.chains) {
    const { childAddresses } = params.perChainSync.get(chain)!;

    // Note: All filters are refetched, no matter if they are resolved or not.
    const sources = params.indexingBuild.sources.filter(
      ({ filter }) => filter.chainId === chain.id,
    );

    const chainEvents = params.events.filter(
      (event) => event.chainId === chain.id,
    );

    if (chainEvents.length === 0) continue;

    const rawEvents = await initRefetchEvents({
      common: params.common,
      chain,
      childAddresses,
      sources,
      events: chainEvents,
      syncStore: params.syncStore,
    });

    const endClock = startClock();

    const refetchedEvents = decodeEvents(params.common, sources, rawEvents);

    params.common.logger.trace({
      msg: "Decoded events",
      chain: chain.name,
      chain_id: chain.id,
      event_count: events.length,
      duration: endClock(),
    });

    params.common.metrics.ponder_historical_extract_duration.inc(
      { step: "decode" },
      endClock(),
    );

    let i = 0;
    let j = 0;

    while (i < params.events.length && j < refetchedEvents.length) {
      if (params.events[i]?.chainId === chain.id) {
        events[i] = refetchedEvents[j]!;
        i++;
        j++;
      } else {
        i++;
      }
    }
  }

  return events;
}

export async function refetchLocalEvents(params: {
  common: Common;
  chain: Chain;
  childAddresses: ChildAddresses;
  sources: Source[];
  events: Event[];
  syncStore: SyncStore;
}): Promise<RawEvent[]> {
  const from = params.events[0]!.checkpoint;
  const to = params.events[params.events.length - 1]!.checkpoint;

  const fromBlock = Number(decodeCheckpoint(from).blockNumber);
  const toBlock = Number(decodeCheckpoint(to).blockNumber);
  let cursor = fromBlock;

  let events: RawEvent[] | undefined;
  while (cursor <= toBlock) {
    const queryEndClock = startClock();

    const {
      blocks,
      logs,
      transactions,
      transactionReceipts,
      traces,
      cursor: queryCursor,
    } = await params.syncStore.getEventData({
      filters: params.sources.map(({ filter }) => filter),
      fromBlock: cursor,
      toBlock,
      chainId: params.chain.id,
      limit: params.events.length,
    });

    const endClock = startClock();
    const rawEvents = buildEvents({
      sources: params.sources,
      blocks,
      logs,
      transactions,
      transactionReceipts,
      traces,
      childAddresses: params.childAddresses,
      chainId: params.chain.id,
    });

    params.common.logger.trace({
      msg: "Constructed events from block data",
      chain: params.chain.name,
      chain_id: params.chain.id,
      block_range: JSON.stringify([cursor, queryCursor]),
      event_count: rawEvents.length,
      duration: endClock(),
    });

    params.common.metrics.ponder_historical_extract_duration.inc(
      { step: "build" },
      endClock(),
    );

    params.common.logger.debug({
      msg: "Queried backfill JSON-RPC data from database",
      chain: params.chain.name,
      chain_id: params.chain.id,
      block_range: JSON.stringify([cursor, queryCursor]),
      event_count: rawEvents.length,
      duration: queryEndClock(),
    });

    await new Promise(setImmediate);

    if (events === undefined) {
      events = rawEvents;
    } else {
      events.push(...rawEvents);
    }

    cursor = queryCursor + 1;
  }

  return events!;
}

export async function* getLocalEventGenerator(params: {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  sources: Source[];
  childAddresses: ChildAddresses;
  syncProgress: SyncProgress;
  cachedIntervals: CachedIntervals;
  from: string;
  to: string;
  limit: number;
  syncStore: SyncStore;
  isCatchup: boolean;
}) {
  const fromBlock = Number(decodeCheckpoint(params.from).blockNumber);
  const toBlock = Number(decodeCheckpoint(params.to).blockNumber);
  let cursor = fromBlock;

  const localSyncGenerator = getLocalSyncGenerator(params);

  for await (const syncCursor of bufferAsyncGenerator(
    localSyncGenerator,
    Number.POSITIVE_INFINITY,
  )) {
    while (cursor <= Math.min(syncCursor, toBlock)) {
      const queryEndClock = startClock();

      const {
        blocks,
        logs,
        transactions,
        transactionReceipts,
        traces,
        cursor: queryCursor,
      } = await params.syncStore.getEventData({
        filters: params.sources.map(({ filter }) => filter),
        fromBlock: cursor,
        toBlock: Math.min(syncCursor, toBlock),
        chainId: params.chain.id,
        limit: params.limit,
      });

      const endClock = startClock();
      const events = buildEvents({
        sources: params.sources,
        blocks,
        logs,
        transactions,
        transactionReceipts,
        traces,
        childAddresses: params.childAddresses,
        chainId: params.chain.id,
      });

      params.common.logger.trace({
        msg: "Constructed events from block data",
        chain: params.chain.name,
        chain_id: params.chain.id,
        block_range: JSON.stringify([cursor, queryCursor]),
        event_count: events.length,
        duration: endClock(),
      });

      params.common.metrics.ponder_historical_extract_duration.inc(
        { step: "build" },
        endClock(),
      );

      params.common.logger.debug({
        msg: "Queried backfill JSON-RPC data from database",
        chain: params.chain.name,
        chain_id: params.chain.id,
        block_range: JSON.stringify([cursor, queryCursor]),
        event_count: events.length,
        duration: queryEndClock(),
      });

      await new Promise(setImmediate);

      const blockRange = [cursor, queryCursor] satisfies [number, number];

      cursor = queryCursor + 1;
      if (cursor >= toBlock) {
        yield { events, checkpoint: params.to, blockRange };
      } else if (blocks.length > 0) {
        const checkpoint = encodeCheckpoint({
          ...MAX_CHECKPOINT,
          blockTimestamp: blocks[blocks.length - 1]!.timestamp,
          chainId: BigInt(params.chain.id),
          blockNumber: blocks[blocks.length - 1]!.number,
        });
        yield { events, checkpoint, blockRange };
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
  childAddresses: ChildAddresses;
  cachedIntervals: CachedIntervals;
  syncStore: SyncStore;
  isCatchup: boolean;
}) {
  const backfillEndClock = startClock();
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

    params.common.logger.info({
      msg: "Skipped fetching backfill JSON-RPC data (chain only requires live indexing)",
      chain: params.chain.name,
      chain_id: params.chain.id,
      finalized_block: hexToNumber(params.syncProgress.finalized.number),
      start_block: hexToNumber(params.syncProgress.start.number),
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
      if (params.isCatchup === false) {
        params.common.logger.info({
          msg: "Skipped fetching backfill JSON-RPC data (cache contains all required data)",
          chain: params.chain.name,
          chain_id: params.chain.id,
          cached_block: hexToNumber(params.syncProgress.current.number),
          cache_rate: "100%",
        });
      }
      return;
    } else if (params.isCatchup === false) {
      params.common.logger.info({
        msg: "Started fetching backfill JSON-RPC data",
        chain: params.chain.name,
        chain_id: params.chain.id,
        cached_block: hexToNumber(params.syncProgress.current.number),
        cache_rate: formatPercentage((total - required) / total),
      });
    }

    cursor = hexToNumber(params.syncProgress.current.number) + 1;
  } else {
    params.common.logger.info({
      msg: "Started fetching backfill JSON-RPC data",
      chain: params.chain.name,
      chain_id: params.chain.id,
      cache_rate: "0%",
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

    const durationTimer = setTimeout(() => {
      params.common.logger.warn({
        msg: "Fetching backfill JSON-RPC data is taking longer than expected",
        chain: params.chain.name,
        chain_id: params.chain.id,
        block_range: JSON.stringify(interval),
        duration: endClock(),
      });
    }, 5_000);

    let synced: SyncBlock | undefined;
    try {
      synced = await historicalSync.sync(interval);
    } catch (error) {
      if (error instanceof ShutdownError) {
        throw error;
      }

      params.common.logger.warn({
        msg: "Failed to fetch backfill JSON-RPC data",
        chain: params.chain.name,
        chain_id: params.chain.id,
        block_range: JSON.stringify(interval),
        duration: endClock(),
        error,
      });
      throw error;
    }

    clearTimeout(durationTimer);

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
        msg: "Updated block range estimate for fetching backfill JSON-RPC data",
        chain: params.chain.name,
        chain_id: params.chain.id,
        range: estimateRange,
      });
    }

    yield hexToNumber(params.syncProgress.current!.number);

    if (params.syncProgress.isEnd() || params.syncProgress.isFinalized()) {
      params.common.logger.info({
        msg: "Finished fetching backfill JSON-RPC data",
        chain: params.chain.name,
        chain_id: params.chain.id,
        duration: backfillEndClock(),
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
  generators: AsyncGenerator<{
    events: Event[];
    checkpoint: string;
    blockRange: [number, number];
  }>[],
): AsyncGenerator<
  {
    chainId: number;
    events: Event[];
    checkpoint: string;
    blockRange: [number, number];
  }[]
> {
  const results = await Promise.all(generators.map((gen) => gen.next()));

  while (results.some((res) => res.done !== true)) {
    const supremum = min(
      ...results.map((res) => (res.done ? undefined : res.value.checkpoint)),
    );

    const mergedResults: {
      chainId: number;
      events: Event[];
      checkpoint: string;
      blockRange: [number, number];
    }[] = [];

    for (const result of results) {
      if (result.done === false) {
        const [left, right] = partition(
          result.value.events,
          (event) => event.checkpoint <= supremum,
        );

        const event = left[left.length - 1];

        if (event) {
          const blockRange = [
            result.value.blockRange[0],
            right.length > 0
              ? Number(decodeCheckpoint(event.checkpoint).blockNumber)
              : result.value.blockRange[1],
          ] satisfies [number, number];

          mergedResults.push({
            events: left,
            chainId: event.chainId,
            checkpoint:
              right.length > 0 ? event.checkpoint : result.value.checkpoint,
            blockRange,
          });
        }

        result.value.events = right;
      }
    }

    const index = results.findIndex(
      (res) => res.done === false && res.value.checkpoint === supremum,
    );

    const resultPromise = generators[index]!.next();
    if (mergedResults.length > 0) {
      yield mergedResults;
    }
    results[index] = await resultPromise;
  }
}
