import type { Database } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import { ShutdownError } from "@/internal/errors.js";
import type {
  Chain,
  CrashRecoveryCheckpoint,
  Event,
  EventCallback,
  IndexingBuild,
  RawEvent,
  SyncBlock,
} from "@/internal/types.js";
import { eth_getBlockByNumber } from "@/rpc/actions.js";
import type { Rpc } from "@/rpc/index.js";
import { buildEvents, decodeEvents } from "@/runtime/events.js";
import { createHistoricalSync } from "@/sync-historical/index.js";
import { type SyncStore, createSyncStore } from "@/sync-store/index.js";
import {
  MAX_CHECKPOINT,
  ZERO_CHECKPOINT,
  decodeCheckpoint,
  encodeCheckpoint,
  min,
} from "@/utils/checkpoint.js";
import { estimate } from "@/utils/estimate.js";
import { formatPercentage } from "@/utils/format.js";
import {
  bufferAsyncGenerator,
  createCallbackGenerator,
  mergeAsyncGenerators,
} from "@/utils/generators.js";
import { type Interval, intervalSum } from "@/utils/interval.js";
import { partition } from "@/utils/partition.js";
import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
import { startClock } from "@/utils/timer.js";
import { hexToNumber, numberToHex } from "viem";
import {
  type CachedIntervals,
  type ChildAddresses,
  type SyncProgress,
  getRequiredIntervals,
  getRequiredIntervalsWithFilters,
} from "./index.js";
import { initEventGenerator, initRefetchEvents } from "./init.js";
import { getOmnichainCheckpoint } from "./omnichain.js";

export async function* getHistoricalEventsOmnichain(params: {
  common: Common;
  indexingBuild: Pick<
    IndexingBuild,
    "eventCallbacks" | "chains" | "rpcs" | "finalizedBlocks"
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
  database: Database;
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

        const eventCallbacks =
          params.indexingBuild.eventCallbacks[
            params.indexingBuild.chains.findIndex((c) => c.id === chain.id)
          ]!;

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
            const fromBlock = await createSyncStore({
              common: params.common,
              qb: params.database.syncQB,
            }).getSafeCrashRecoveryBlock({
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
          // Previous iterations `to` value
          const cursor = perChainCursor.get(chain)!;

          // Yield pending events from previous iterations. Note that it is possible for
          // previous pending events to still be pending after the catchup.

          const events = pendingEvents.filter(
            (event) =>
              event.chain.id === chain.id && event.checkpoint <= omnichainTo,
          );

          pendingEvents = pendingEvents.filter(
            (event) =>
              (event.chain.id === chain.id &&
                event.checkpoint <= omnichainTo) === false,
          );

          if (events.length > 0) {
            if (omnichainTo >= cursor) {
              const blockRange = [
                Number(decodeCheckpoint(events[0]!.checkpoint).blockNumber),
                Number(decodeCheckpoint(cursor).blockNumber),
              ] satisfies [number, number];

              yield { events, checkpoint: cursor, blockRange };
            } else {
              const checkpoint = events[events.length - 1]!.checkpoint;

              const blockRange = [
                Number(decodeCheckpoint(events[0]!.checkpoint).blockNumber),
                Number(decodeCheckpoint(checkpoint).blockNumber),
              ] satisfies [number, number];

              yield { events, checkpoint, blockRange };
            }
          }

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
          eventCallbacks,
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
          database: params.database,
          isCatchup,
        });

        for await (let {
          events: rawEvents,
          checkpoint,
          blockRange,
        } of eventGenerator) {
          const endClock = startClock();

          let events = decodeEvents(
            params.common,
            chain,
            eventCallbacks,
            rawEvents,
          );

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
            events = left;
            pendingEvents = pendingEvents.concat(right);

            params.common.logger.trace({
              msg: "Filtered pending events",
              chain: chain.name,
              chain_id: chain.id,
              event_count: right.length,
              checkpoint: omnichainTo,
            });

            if (left.length > 0) {
              checkpoint = left[left.length - 1]!.checkpoint;
              blockRange[1] = Number(
                decodeCheckpoint(left[left.length - 1]!.checkpoint).blockNumber,
              );

              yield { events, checkpoint, blockRange };
            }
          } else {
            yield { events, checkpoint, blockRange };
          }
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

        return eth_getBlockByNumber(rpc, ["latest", false], context)
          .then((latest) =>
            eth_getBlockByNumber(
              rpc,
              [
                numberToHex(
                  Math.max(
                    hexToNumber(latest.number) - chain.finalityBlockCount,
                    0,
                  ),
                ),
                false,
              ],
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
    "eventCallbacks" | "chains" | "rpcs" | "finalizedBlocks"
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
  database: Database;
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

        const eventCallbacks =
          params.indexingBuild.eventCallbacks[
            params.indexingBuild.chains.findIndex((c) => c.id === chain.id)
          ]!;

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
            const fromBlock = await createSyncStore({
              common: params.common,
              qb: params.database.syncQB,
            }).getSafeCrashRecoveryBlock({
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
          eventCallbacks,
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
          database: params.database,
          isCatchup,
        });

        for await (const {
          events: rawEvents,
          checkpoint,
          blockRange,
        } of eventGenerator) {
          const endClock = startClock();

          let events = decodeEvents(
            params.common,
            chain,
            eventCallbacks,
            rawEvents,
          );

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

        return eth_getBlockByNumber(rpc, ["latest", false], context)
          .then((latest) =>
            eth_getBlockByNumber(
              rpc,
              [
                numberToHex(
                  Math.max(
                    hexToNumber(latest.number) - chain.finalityBlockCount,
                    0,
                  ),
                ),
                false,
              ],
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

export async function* getHistoricalEventsIsolated(params: {
  common: Common;
  indexingBuild: Pick<
    IndexingBuild,
    "eventCallbacks" | "chains" | "rpcs" | "finalizedBlocks"
  >;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  chain: Chain;
  syncProgress: SyncProgress;
  childAddresses: ChildAddresses;
  cachedIntervals: CachedIntervals;
  database: Database;
}) {
  let isCatchup = false;
  let lastUnfinalizedRefetch = Date.now();
  let cursor: string | undefined;

  while (true) {
    const rpc =
      params.indexingBuild.rpcs[
        params.indexingBuild.chains.findIndex((c) => c.id === params.chain.id)
      ]!;

    const eventCallbacks =
      params.indexingBuild.eventCallbacks[
        params.indexingBuild.chains.findIndex((c) => c.id === params.chain.id)
      ]!;

    const crashRecoveryCheckpoint = params.crashRecoveryCheckpoint?.find(
      ({ chainId }) => chainId === params.chain.id,
    )?.checkpoint;

    const to = min(
      params.syncProgress.getCheckpoint({ tag: "finalized" }),
      params.syncProgress.getCheckpoint({ tag: "end" }),
    );
    let from: string;

    if (isCatchup === false) {
      // In order to speed up the "extract" phase when there is a crash recovery,
      // the beginning cursor is moved forwards. This only works when `crashRecoveryCheckpoint`
      // is defined.

      if (crashRecoveryCheckpoint === undefined) {
        from = params.syncProgress.getCheckpoint({ tag: "start" });
      } else if (
        Number(decodeCheckpoint(crashRecoveryCheckpoint).chainId) ===
        params.chain.id
      ) {
        from = crashRecoveryCheckpoint;
      } else {
        from = params.syncProgress.getCheckpoint({ tag: "start" });
      }
    } else {
      from = encodeCheckpoint({
        ...ZERO_CHECKPOINT,
        blockTimestamp: decodeCheckpoint(cursor!).blockTimestamp,
        chainId: decodeCheckpoint(cursor!).chainId,
        blockNumber: decodeCheckpoint(cursor!).blockNumber + 1n,
      });

      if (from > to) return;
    }

    params.common.logger.info({
      msg: "Started backfill indexing",
      chain: params.chain.name,
      chain_id: params.chain.id,
      block_range: JSON.stringify([
        Number(decodeCheckpoint(from).blockNumber),
        Number(decodeCheckpoint(to).blockNumber),
      ]),
    });

    const eventGenerator = await initEventGenerator({
      common: params.common,
      indexingBuild: params.indexingBuild,
      chain: params.chain,
      rpc,
      eventCallbacks,
      childAddresses: params.childAddresses,
      syncProgress: params.syncProgress,
      cachedIntervals: params.cachedIntervals,
      from,
      to,
      limit:
        Math.round(
          params.common.options.syncEventsQuerySize /
            (params.indexingBuild.chains.length + 1),
        ) + 6,
      database: params.database,
      isCatchup,
    });

    for await (const {
      events: rawEvents,
      checkpoint,
      blockRange,
    } of eventGenerator) {
      const endClock = startClock();

      let events = decodeEvents(
        params.common,
        params.chain,
        eventCallbacks,
        rawEvents,
      );

      params.common.logger.trace({
        msg: "Decoded events",
        chain: params.chain.name,
        chain_id: params.chain.id,
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
            chain: params.chain.name,
            chain_id: params.chain.id,
            event_count: left.length,
            checkpoint: crashRecoveryCheckpoint,
          });
        }
      }

      yield { chainId: params.chain.id, events, checkpoint, blockRange };
    }

    cursor = to;

    if (Date.now() - lastUnfinalizedRefetch < 30_000) {
      break;
    }
    lastUnfinalizedRefetch = Date.now();

    const context = {
      logger: params.common.logger.child({ action: "refetch_finalized_block" }),
    };

    const endClock = startClock();

    const finalizedBlock = await eth_getBlockByNumber(
      rpc,
      ["latest", false],
      context,
    ).then((latest) =>
      eth_getBlockByNumber(
        rpc,
        [
          numberToHex(
            Math.max(
              hexToNumber(latest.number) - params.chain.finalityBlockCount,
              0,
            ),
          ),
          false,
        ],
        context,
      ),
    );

    const finalizedBlockNumber = hexToNumber(finalizedBlock.number);
    params.common.logger.debug({
      msg: "Refetched finalized block for backfill cutover",
      chain: params.chain.name,
      chain_id: params.chain.id,
      finalized_block: finalizedBlockNumber,
      duration: endClock(),
    });

    if (
      hexToNumber(finalizedBlock.number) -
        hexToNumber(params.syncProgress.finalized.number) <=
      params.chain.finalityBlockCount
    ) {
      break;
    }

    params.syncProgress.finalized = finalizedBlock;
    isCatchup = true;
  }
}

export async function refetchHistoricalEvents(params: {
  common: Common;
  indexingBuild: Pick<IndexingBuild, "eventCallbacks" | "chains">;
  perChainSync: Map<Chain, { childAddresses: ChildAddresses }>;
  events: Event[];
  syncStore: SyncStore;
}): Promise<Event[]> {
  const events: Event[] = new Array(params.events.length);

  for (const chain of params.indexingBuild.chains) {
    const { childAddresses } = params.perChainSync.get(chain)!;

    // Note: All filters are refetched, no matter if they are resolved or not.
    const eventCallbacks =
      params.indexingBuild.eventCallbacks[
        params.indexingBuild.chains.findIndex((c) => c.id === chain.id)
      ]!;

    const chainEvents = params.events.filter(
      (event) => event.chain.id === chain.id,
    );

    if (chainEvents.length === 0) continue;

    const rawEvents = await initRefetchEvents({
      common: params.common,
      chain,
      childAddresses,
      eventCallbacks,
      events: chainEvents,
      syncStore: params.syncStore,
    });

    const endClock = startClock();

    const refetchedEvents = decodeEvents(
      params.common,
      chain,
      eventCallbacks,
      rawEvents,
    );

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
      if (params.events[i]?.chain.id === chain.id) {
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
  eventCallbacks: EventCallback[];
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
      filters: params.eventCallbacks.map(({ filter }) => filter),
      fromBlock: cursor,
      toBlock,
      chainId: params.chain.id,
      limit: params.events.length,
    });

    const endClock = startClock();
    const rawEvents = buildEvents({
      eventCallbacks: params.eventCallbacks,
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
  eventCallbacks: EventCallback[];
  childAddresses: ChildAddresses;
  syncProgress: SyncProgress;
  cachedIntervals: CachedIntervals;
  from: string;
  to: string;
  limit: number;
  database: Database;
  isCatchup: boolean;
}) {
  const syncStore = createSyncStore({
    common: params.common,
    qb: params.database.syncQB,
  });

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
      } = await syncStore.getEventData({
        filters: params.eventCallbacks.map(({ filter }) => filter),
        fromBlock: cursor,
        toBlock: Math.min(syncCursor, toBlock),
        chainId: params.chain.id,
        limit: params.limit,
      });

      const endClock = startClock();
      const events = buildEvents({
        eventCallbacks: params.eventCallbacks,
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
  eventCallbacks: EventCallback[];
  syncProgress: SyncProgress;
  childAddresses: ChildAddresses;
  cachedIntervals: CachedIntervals;
  database: Database;
  isCatchup: boolean;
}) {
  const backfillEndClock = startClock();
  const label = { chain: params.chain.name };

  let first = hexToNumber(params.syncProgress.start.number);
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

  const requiredIntervals = getRequiredIntervals({
    filters: params.eventCallbacks.map(({ filter }) => filter),
    interval: totalInterval,
    cachedIntervals: params.cachedIntervals,
  });

  const required = intervalSum(requiredIntervals);
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

    first = hexToNumber(params.syncProgress.current.number) + 1;
  } else {
    params.common.logger.info({
      msg: "Started fetching backfill JSON-RPC data",
      chain: params.chain.name,
      chain_id: params.chain.id,
      cache_rate: "0%",
    });
  }

  const historicalSync = createHistoricalSync(params);

  const { callback: intervalCallback, generator: intervalGenerator } =
    createCallbackGenerator<{
      interval: Interval;
      promise: Promise<void>;
    }>();

  intervalCallback({
    interval: [
      first,
      Math.min(first + estimateRange, hexToNumber(last.number)),
    ],
    promise: Promise.resolve(),
  });

  /**
   * @returns `true` if any data was inserted into the database.
   */
  async function syncInterval({
    interval,
    promise,
  }: { interval: Interval; promise: Promise<void> }): Promise<boolean> {
    const endClock = startClock();

    const isSyncComplete = interval[1] === hexToNumber(last.number);
    const {
      intervals: requiredIntervals,
      factoryIntervals: requiredFactoryIntervals,
    } = getRequiredIntervalsWithFilters({
      interval,
      filters: params.eventCallbacks.map(({ filter }) => filter),
      cachedIntervals: params.cachedIntervals,
    });

    let closestToTipBlock: SyncBlock | undefined;
    if (requiredIntervals.length > 0 || requiredFactoryIntervals.length > 0) {
      const pwr = promiseWithResolvers<void>();

      const durationTimer = setTimeout(
        () => {
          params.common.logger.warn({
            msg: "Fetching backfill JSON-RPC data is taking longer than expected",
            chain: params.chain.name,
            chain_id: params.chain.id,
            block_range: JSON.stringify(interval),
            duration: endClock(),
          });
        },
        params.common.options.command === "dev" ? 10_000 : 50_000,
      );

      closestToTipBlock = await params.database.syncQB
        .transaction(async (tx) => {
          const syncStore = createSyncStore({ common: params.common, qb: tx });
          const logs = await historicalSync.syncBlockRangeData({
            interval,
            requiredIntervals,
            requiredFactoryIntervals,
            syncStore,
          });

          // Wait for the previous interval to complete `syncBlockData`.
          await promise;

          if (isSyncComplete === false) {
            // Queue the next interval
            intervalCallback({
              interval: [
                Math.min(interval[1] + 1, hexToNumber(last.number)),
                Math.min(
                  interval[1] + 1 + estimateRange,
                  hexToNumber(last.number),
                ),
              ],
              promise: pwr.promise,
            });
          }

          const closestToTipBlock = await historicalSync.syncBlockData({
            interval,
            requiredIntervals,
            logs,
            syncStore,
          });
          if (params.chain.disableCache === false) {
            await syncStore.insertIntervals({
              intervals: requiredIntervals,
              factoryIntervals: requiredFactoryIntervals,
              chainId: params.chain.id,
            });
          }

          return closestToTipBlock;
        })
        .catch((error) => {
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
        });

      clearTimeout(durationTimer);

      const duration = endClock();

      // Use the duration and interval of the last call to `sync` to update estimate
      estimateRange = estimate({
        from: interval[0],
        to: interval[1],
        target: params.common.options.command === "dev" ? 2_000 : 10_000,
        result: duration,
        min: 25,
        max: 100_000,
        prev: estimateRange,
        maxIncrease: 1.5,
      });

      params.common.logger.trace({
        msg: "Updated block range estimate for fetching backfill JSON-RPC data",
        chain: params.chain.name,
        chain_id: params.chain.id,
        range: estimateRange,
      });

      // Resolve promise so the next interval can continue.
      pwr.resolve();
    } else {
      // Wait for the previous interval to complete `syncBlockData`.
      await promise;

      if (isSyncComplete === false) {
        // Queue the next interval
        intervalCallback({
          interval: [
            Math.min(interval[1] + 1, hexToNumber(last.number)),
            Math.min(interval[1] + 1 + estimateRange, hexToNumber(last.number)),
          ],
          promise: Promise.resolve(),
        });
      }
    }

    if (interval[1] === hexToNumber(last.number)) {
      params.syncProgress.current = last;
    }

    if (closestToTipBlock) {
      params.common.metrics.ponder_sync_block.set(
        label,
        hexToNumber(closestToTipBlock.number),
      );
      params.common.metrics.ponder_sync_block_timestamp.set(
        label,
        hexToNumber(closestToTipBlock.timestamp),
      );
    } else {
      params.common.metrics.ponder_sync_block.set(label, interval[1]);
    }

    params.common.metrics.ponder_historical_completed_blocks.inc(
      label,
      interval[1] - interval[0] + 1,
    );

    return requiredIntervals.length > 0;
  }

  const { callback, generator } =
    createCallbackGenerator<IteratorResult<number>>();

  (async () => {
    for await (const { interval, promise } of intervalGenerator) {
      // Note: this relies on the invariant that `syncInterval`
      // will always resolve promises in the order it was called.
      syncInterval({ interval, promise }).then((didInsertData) => {
        const isDone = interval[1] === hexToNumber(last.number);
        if (didInsertData || isDone) {
          callback({ value: interval[1], done: false });
        }

        if (isDone) {
          callback({ value: undefined, done: true });
        }
      });
    }
  })();

  for await (const result of generator) {
    if (result.done) break;
    yield result.value;
  }

  params.common.logger.info({
    msg: "Finished fetching backfill JSON-RPC data",
    chain: params.chain.name,
    chain_id: params.chain.id,
    duration: backfillEndClock(),
  });
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
            chainId: event.chain.id,
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
