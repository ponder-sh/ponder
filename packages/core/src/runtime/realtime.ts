import type { Database } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import type {
  Chain,
  Event,
  EventCallback,
  Factory,
  Filter,
  IndexingBuild,
  SyncBlock,
  SyncBlockHeader,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import {
  buildEvents,
  decodeEvents,
  syncBlockToInternal,
  syncLogToInternal,
  syncTraceToInternal,
  syncTransactionReceiptToInternal,
  syncTransactionToInternal,
} from "@/runtime/events.js";
import {
  type RealtimeSyncEvent,
  createRealtimeSync,
} from "@/sync-realtime/index.js";
import { createSyncStore } from "@/sync-store/index.js";
import {
  ZERO_CHECKPOINT_STRING,
  blockToCheckpoint,
  encodeCheckpoint,
  min,
} from "@/utils/checkpoint.js";
import {
  bufferAsyncGenerator,
  createCallbackGenerator,
  mergeAsyncGenerators,
} from "@/utils/generators.js";
import { type Interval, intervalIntersection } from "@/utils/interval.js";
import { promiseAllSettledWithThrow } from "@/utils/promiseAllSettledWithThrow.js";
import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
import { startClock } from "@/utils/timer.js";
import { type Address, hexToNumber } from "viem";
import { getFilterFactories } from "./filter.js";
import type { ChildAddresses, SyncProgress } from "./index.js";
import { getOmnichainCheckpoint } from "./omnichain.js";

export type RealtimeEvent =
  | {
      type: "block";
      events: Event[];
      chain: Chain;
      checkpoint: string;
      blockCallback?: (isAccepted: boolean) => void;
    }
  | { type: "reorg"; chain: Chain; checkpoint: string }
  | { type: "finalize"; chain: Chain; checkpoint: string };

export async function* getRealtimeEventsOmnichain(params: {
  common: Common;
  indexingBuild: Pick<
    IndexingBuild,
    "eventCallbacks" | "chains" | "rpcs" | "finalizedBlocks"
  >;
  perChainSync: Map<
    Chain,
    {
      syncProgress: SyncProgress;
      childAddresses: ChildAddresses;
      unfinalizedBlocks: Omit<
        Extract<RealtimeSyncEvent, { type: "block" }>,
        "type"
      >[];
    }
  >;
  database: Database;
  pendingEvents: Event[];
}): AsyncGenerator<RealtimeEvent> {
  const eventGenerators = Array.from(params.perChainSync.entries())
    .map(([chain, { syncProgress, childAddresses }]) => {
      if (syncProgress.isEnd()) {
        params.common.logger.info({
          msg: "Skipped live indexing (chain only requires backfill indexing)",
          chain: chain.name,
          chain_id: chain.id,
          end_block: hexToNumber(syncProgress.end!.number),
        });

        params.common.metrics.ponder_sync_is_complete.set(
          { chain: chain.name },
          1,
        );
        return;
      }

      const rpc =
        params.indexingBuild.rpcs[params.indexingBuild.chains.indexOf(chain)]!;
      const eventCallbacks =
        params.indexingBuild.eventCallbacks[
          params.indexingBuild.chains.findIndex((c) => c.id === chain.id)
        ]!;

      params.common.metrics.ponder_sync_is_realtime.set(
        { chain: chain.name },
        1,
      );

      const bufferCallback = (bufferSize: number) => {
        // Note: Only log when the buffer size is greater than 1 because
        // a buffer size of 1 is not backpressure.
        if (bufferSize === 1) return;
        params.common.logger.trace({
          msg: "Detected live indexing backpressure",
          chain: chain.name,
          chain_id: chain.id,
          buffer_size: bufferSize,
          indexing_step: "order block events",
        });
      };

      return bufferAsyncGenerator(
        getRealtimeEventGenerator({
          common: params.common,
          chain,
          rpc,
          eventCallbacks,
          syncProgress,
          childAddresses,
          database: params.database,
        }),
        100,
        bufferCallback,
      );
    })
    .filter(
      (
        generator,
      ): generator is AsyncGenerator<{
        chain: Chain;
        event: RealtimeSyncEvent;
      }> => generator !== undefined,
    );

  /** Events that have been executed but not finalized. */
  let executedEvents: Event[] = [];
  /** Events that have not been executed. */
  let pendingEvents: Event[] = params.pendingEvents;
  /** Closest-to-tip finalized checkpoint across all chains. */
  let finalizedCheckpoint = ZERO_CHECKPOINT_STRING;

  for await (const { chain, event } of mergeAsyncGeneratorsWithRealtimeOrder(
    eventGenerators,
  )) {
    const { syncProgress, childAddresses, unfinalizedBlocks } =
      params.perChainSync.get(chain)!;

    const eventCallbacks =
      params.indexingBuild.eventCallbacks[
        params.indexingBuild.chains.findIndex((c) => c.id === chain.id)
      ]!;

    await handleRealtimeSyncEvent(event, {
      common: params.common,
      chain,
      eventCallbacks,
      syncProgress,
      unfinalizedBlocks,
      database: params.database,
    });

    switch (event.type) {
      case "block": {
        const events = buildEvents({
          eventCallbacks,
          chainId: chain.id,
          blocks: [syncBlockToInternal({ block: event.block })],
          logs: event.logs.map((log) => syncLogToInternal({ log })),
          transactions: event.transactions.map((transaction) =>
            syncTransactionToInternal({ transaction }),
          ),
          transactionReceipts: event.transactionReceipts.map(
            (transactionReceipt) =>
              syncTransactionReceiptToInternal({ transactionReceipt }),
          ),
          traces: event.traces.map((trace) =>
            syncTraceToInternal({
              trace,
              block: event.block,
              transaction: event.transactions.find(
                (t) => t.hash === trace.transactionHash,
              )!,
            }),
          ),
          childAddresses,
        });

        params.common.logger.trace({
          msg: "Constructed events from block",
          chain: chain.name,
          chain_id: chain.id,
          number: hexToNumber(event.block.number),
          hash: event.block.hash,
          event_count: events.length,
        });

        const decodedEvents = decodeEvents(
          params.common,
          chain,
          eventCallbacks,
          events,
        );

        params.common.logger.trace({
          msg: "Decoded block events",
          chain: chain.name,
          chain_id: chain.id,
          number: hexToNumber(event.block.number),
          hash: event.block.hash,
          event_count: decodedEvents.length,
        });

        const checkpoint = encodeCheckpoint(
          blockToCheckpoint(event.block, chain.id, "up"),
        );

        const readyEvents = pendingEvents
          .concat(decodedEvents)
          .filter((e) => e.checkpoint < checkpoint)
          .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
        pendingEvents = pendingEvents
          .concat(decodedEvents)
          .filter((e) => e.checkpoint > checkpoint);
        executedEvents = executedEvents.concat(readyEvents);

        yield {
          type: "block",
          events: readyEvents,
          chain,
          checkpoint,
          blockCallback: event.blockCallback,
        };
        break;
      }
      case "finalize": {
        const from = finalizedCheckpoint;
        finalizedCheckpoint = getOmnichainCheckpoint({
          perChainSync: params.perChainSync,
          tag: "finalized",
        });
        const to = getOmnichainCheckpoint({
          perChainSync: params.perChainSync,
          tag: "finalized",
        });

        if (to <= from) continue;

        // index of the first unfinalized event
        let finalizeIndex: number | undefined = undefined;
        for (const [index, event] of executedEvents.entries()) {
          if (event.checkpoint > to) {
            finalizeIndex = index;
            break;
          }
        }

        let finalizedEvents: Event[];

        if (finalizeIndex === undefined) {
          finalizedEvents = executedEvents;
          executedEvents = [];
        } else {
          finalizedEvents = executedEvents.slice(0, finalizeIndex);
          executedEvents = executedEvents.slice(finalizeIndex);
        }

        params.common.logger.trace({
          msg: "Removed finalized events",
          event_count: finalizedEvents.length,
        });

        yield { type: "finalize", chain, checkpoint: to };
        break;
      }
      case "reorg": {
        const isReorgedEvent = (_event: Event) => {
          if (
            _event.chain.id === chain.id &&
            Number(_event.event.block.number) > hexToNumber(event.block.number)
          ) {
            return true;
          }
          return false;
        };

        const checkpoint = getOmnichainCheckpoint({
          perChainSync: params.perChainSync,
          tag: "current",
        });

        // Move events from executed to pending

        const reorgedEvents = executedEvents.filter(
          (e) => e.checkpoint > checkpoint,
        );
        executedEvents = executedEvents.filter(
          (e) => e.checkpoint < checkpoint,
        );
        pendingEvents = pendingEvents.concat(reorgedEvents);

        params.common.logger.trace({
          msg: "Removed and rescheduled reorged events",
          event_count: reorgedEvents.length,
        });

        pendingEvents = pendingEvents.filter(
          (e) => isReorgedEvent(e) === false,
        );

        yield { type: "reorg", chain, checkpoint };
        break;
      }
    }
  }
}

export async function* getRealtimeEventsMultichain(params: {
  common: Common;
  indexingBuild: Pick<
    IndexingBuild,
    "eventCallbacks" | "chains" | "rpcs" | "finalizedBlocks"
  >;
  perChainSync: Map<
    Chain,
    {
      syncProgress: SyncProgress;
      childAddresses: ChildAddresses;
      unfinalizedBlocks: Omit<
        Extract<RealtimeSyncEvent, { type: "block" }>,
        "type"
      >[];
    }
  >;
  database: Database;
}): AsyncGenerator<RealtimeEvent> {
  const eventGenerators = Array.from(params.perChainSync.entries())
    .map(([chain, { syncProgress, childAddresses }]) => {
      if (syncProgress.isEnd()) {
        params.common.logger.info({
          msg: "Skipped live indexing (chain only requires backfill indexing)",
          chain: chain.name,
          chain_id: chain.id,
          end_block: hexToNumber(syncProgress.end!.number),
        });

        params.common.metrics.ponder_sync_is_complete.set(
          { chain: chain.name },
          1,
        );
        return;
      }

      const rpc =
        params.indexingBuild.rpcs[params.indexingBuild.chains.indexOf(chain)]!;
      const eventCallbacks =
        params.indexingBuild.eventCallbacks[
          params.indexingBuild.chains.findIndex((c) => c.id === chain.id)
        ]!;

      params.common.metrics.ponder_sync_is_realtime.set(
        { chain: chain.name },
        1,
      );

      const bufferCallback = (bufferSize: number) => {
        // Note: Only log when the buffer size is greater than 1 because
        // a buffer size of 1 is not backpressure.
        if (bufferSize === 1) return;
        params.common.logger.trace({
          msg: "Detected live indexing backpressure",
          chain: chain.name,
          chain_id: chain.id,
          buffer_size: bufferSize,
          indexing_step: "order block events",
        });
      };

      return bufferAsyncGenerator(
        getRealtimeEventGenerator({
          common: params.common,
          chain,
          rpc,
          eventCallbacks,
          syncProgress,
          childAddresses,
          database: params.database,
        }),
        100,
        bufferCallback,
      );
    })
    .filter(
      (
        generator,
      ): generator is AsyncGenerator<{
        chain: Chain;
        event: RealtimeSyncEvent;
      }> => generator !== undefined,
    );

  /** Events that have been executed but not finalized. */
  let executedEvents: Event[] = [];
  /** Events that have not been executed. */
  let pendingEvents: Event[] = [];

  for await (const { chain, event } of mergeAsyncGenerators(eventGenerators)) {
    const { syncProgress, childAddresses, unfinalizedBlocks } =
      params.perChainSync.get(chain)!;

    const eventCallbacks =
      params.indexingBuild.eventCallbacks[
        params.indexingBuild.chains.findIndex((c) => c.id === chain.id)
      ]!;

    await handleRealtimeSyncEvent(event, {
      common: params.common,
      chain,
      eventCallbacks,
      syncProgress,
      unfinalizedBlocks,
      database: params.database,
    });

    switch (event.type) {
      case "block": {
        const events = buildEvents({
          eventCallbacks,
          chainId: chain.id,
          blocks: [syncBlockToInternal({ block: event.block })],
          logs: event.logs.map((log) => syncLogToInternal({ log })),
          transactions: event.transactions.map((transaction) =>
            syncTransactionToInternal({ transaction }),
          ),
          transactionReceipts: event.transactionReceipts.map(
            (transactionReceipt) =>
              syncTransactionReceiptToInternal({ transactionReceipt }),
          ),
          traces: event.traces.map((trace) =>
            syncTraceToInternal({
              trace,
              block: event.block,
              transaction: event.transactions.find(
                (t) => t.hash === trace.transactionHash,
              )!,
            }),
          ),
          childAddresses,
        });

        params.common.logger.trace({
          msg: "Constructed events from block",
          chain: chain.name,
          chain_id: chain.id,
          number: hexToNumber(event.block.number),
          hash: event.block.hash,
          event_count: events.length,
        });

        const decodedEvents = decodeEvents(
          params.common,
          chain,
          eventCallbacks,
          events,
        );

        params.common.logger.trace({
          msg: "Decoded block events",
          chain: chain.name,
          chain_id: chain.id,
          number: hexToNumber(event.block.number),
          hash: event.block.hash,
          event_count: decodedEvents.length,
        });

        const checkpoint = syncProgress.getCheckpoint({ tag: "current" });

        if (pendingEvents.length > 0) {
          params.common.logger.trace({
            msg: "Included pending events",
            chain: chain.name,
            chain_id: chain.id,
            event_count: pendingEvents.length,
          });
        }

        const readyEvents = decodedEvents
          .concat(pendingEvents)
          .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
        pendingEvents = [];
        executedEvents = executedEvents.concat(readyEvents);

        yield {
          type: "block",
          events: readyEvents,
          chain,
          checkpoint,
          blockCallback: event.blockCallback,
        };
        break;
      }
      case "finalize": {
        const checkpoint = syncProgress.getCheckpoint({ tag: "finalized" });

        // index of the first unfinalized event
        let finalizeIndex: number | undefined = undefined;

        for (const [index, event] of executedEvents.entries()) {
          const _chain = params.indexingBuild.chains.find(
            (c) => c.id === event.chain.id,
          )!;
          const _checkpoint = params.perChainSync
            .get(_chain)!
            .syncProgress.getCheckpoint({ tag: "finalized" });

          if (event.checkpoint > _checkpoint) {
            finalizeIndex = index;
            break;
          }
        }

        let finalizedEvents: Event[];

        if (finalizeIndex === undefined) {
          finalizedEvents = executedEvents;
          executedEvents = [];
        } else {
          finalizedEvents = executedEvents.slice(0, finalizeIndex);
          executedEvents = executedEvents.slice(finalizeIndex);
        }

        params.common.logger.trace({
          msg: "Removed finalized events",
          event_count: finalizedEvents.length,
        });

        yield { type: "finalize", chain, checkpoint };
        break;
      }
      case "reorg": {
        const isReorgedEvent = (_event: Event) => {
          if (
            _event.chain.id === chain.id &&
            Number(_event.event.block.number) > hexToNumber(event.block.number)
          ) {
            return true;
          }
          return false;
        };

        const checkpoint = syncProgress.getCheckpoint({ tag: "current" });

        // index of the first reorged event
        let reorgIndex: number | undefined = undefined;
        for (const [index, event] of executedEvents.entries()) {
          if (event.chain.id === chain.id && event.checkpoint > checkpoint) {
            reorgIndex = index;
            break;
          }
        }

        // Move events from executed to pending

        if (reorgIndex !== undefined) {
          const reorgedEvents = executedEvents.slice(reorgIndex);
          executedEvents = executedEvents.slice(0, reorgIndex);
          pendingEvents = pendingEvents.concat(reorgedEvents);

          params.common.logger.trace({
            msg: "Removed and rescheduled reorged events",
            event_count: reorgedEvents.length,
          });
        }

        pendingEvents = pendingEvents.filter(
          (e) => isReorgedEvent(e) === false,
        );

        yield { type: "reorg", chain, checkpoint };
        break;
      }
    }
  }
}

export async function* getRealtimeEventsIsolated(params: {
  common: Common;
  indexingBuild: Pick<
    IndexingBuild,
    "eventCallbacks" | "chains" | "rpcs" | "finalizedBlocks"
  >;
  chain: Chain;
  syncProgress: SyncProgress;
  childAddresses: ChildAddresses;
  unfinalizedBlocks: Omit<
    Extract<RealtimeSyncEvent, { type: "block" }>,
    "type"
  >[];
  database: Database;
}): AsyncGenerator<RealtimeEvent> {
  if (params.syncProgress.isEnd()) {
    params.common.logger.info({
      msg: "Skipped live indexing (chain only requires backfill indexing)",
      chain: params.chain.name,
      chain_id: params.chain.id,
      end_block: hexToNumber(params.syncProgress.end!.number),
    });

    params.common.metrics.ponder_sync_is_complete.set(
      { chain: params.chain.name },
      1,
    );
    return;
  }

  const rpc =
    params.indexingBuild.rpcs[
      params.indexingBuild.chains.indexOf(params.chain)
    ]!;
  const eventCallbacks =
    params.indexingBuild.eventCallbacks[
      params.indexingBuild.chains.indexOf(params.chain)
    ]!;

  params.common.metrics.ponder_sync_is_realtime.set(
    { chain: params.chain.name },
    1,
  );

  const bufferCallback = (bufferSize: number) => {
    // Note: Only log when the buffer size is greater than 1 because
    // a buffer size of 1 is not backpressure.
    if (bufferSize === 1) return;
    params.common.logger.trace({
      msg: "Detected live indexing backpressure",
      chain: params.chain.name,
      chain_id: params.chain.id,
      buffer_size: bufferSize,
      indexing_step: "order block events",
    });
  };

  const eventGenerator = bufferAsyncGenerator(
    getRealtimeEventGenerator({
      common: params.common,
      chain: params.chain,
      rpc,
      eventCallbacks,
      syncProgress: params.syncProgress,
      childAddresses: params.childAddresses,
      database: params.database,
    }),
    100,
    bufferCallback,
  );

  for await (const { chain, event } of eventGenerator) {
    await handleRealtimeSyncEvent(event, {
      common: params.common,
      chain,
      eventCallbacks,
      syncProgress: params.syncProgress,
      unfinalizedBlocks: params.unfinalizedBlocks,
      database: params.database,
    });

    switch (event.type) {
      case "block": {
        const rawEvents = buildEvents({
          eventCallbacks,
          chainId: chain.id,
          blocks: [syncBlockToInternal({ block: event.block })],
          logs: event.logs.map((log) => syncLogToInternal({ log })),
          transactions: event.transactions.map((transaction) =>
            syncTransactionToInternal({ transaction }),
          ),
          transactionReceipts: event.transactionReceipts.map(
            (transactionReceipt) =>
              syncTransactionReceiptToInternal({ transactionReceipt }),
          ),
          traces: event.traces.map((trace) =>
            syncTraceToInternal({
              trace,
              block: event.block,
              transaction: event.transactions.find(
                (t) => t.hash === trace.transactionHash,
              )!,
            }),
          ),
          childAddresses: params.childAddresses,
        });

        params.common.logger.trace({
          msg: "Constructed events from block",
          chain: chain.name,
          chain_id: chain.id,
          number: hexToNumber(event.block.number),
          hash: event.block.hash,
          event_count: rawEvents.length,
        });

        const events = decodeEvents(
          params.common,
          chain,
          eventCallbacks,
          rawEvents,
        );

        params.common.logger.trace({
          msg: "Decoded block events",
          chain: chain.name,
          chain_id: chain.id,
          number: hexToNumber(event.block.number),
          hash: event.block.hash,
          event_count: events.length,
        });

        const checkpoint = params.syncProgress.getCheckpoint({
          tag: "current",
        });

        yield {
          type: "block",
          events,
          chain,
          checkpoint,
          blockCallback: event.blockCallback,
        };
        break;
      }
      case "finalize": {
        const checkpoint = params.syncProgress.getCheckpoint({
          tag: "finalized",
        });

        yield { type: "finalize", chain, checkpoint };
        break;
      }
      case "reorg": {
        const checkpoint = params.syncProgress.getCheckpoint({
          tag: "current",
        });

        yield { type: "reorg", chain, checkpoint };
        break;
      }
    }
  }
}

export async function* getRealtimeEventGenerator(params: {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  eventCallbacks: EventCallback[];
  syncProgress: SyncProgress;
  childAddresses: ChildAddresses;
  database: Database;
}) {
  const realtimeSync = createRealtimeSync(params);

  let childCount = 0;
  for (const [, factoryChildAddresses] of params.childAddresses) {
    childCount += factoryChildAddresses.size;
  }

  params.common.logger.info({
    msg: "Started live indexing",
    chain: params.chain.name,
    chain_id: params.chain.id,
    finalized_block: hexToNumber(params.syncProgress.finalized.number),
    factory_address_count: childCount,
  });

  const bufferCallback = (bufferSize: number) => {
    // Note: Only log when the buffer size is greater than 1 because
    // a buffer size of 1 is not backpressure.
    if (bufferSize === 1) return;
    params.common.logger.trace({
      msg: "Detected live indexing backpressure",
      chain: params.chain.name,
      chain_id: params.chain.id,
      buffer_size: bufferSize,
      indexing_step: "fetch block data",
    });
  };

  const noNewBlockWarning = () => {
    params.common.logger.warn({
      msg: "No new block received within expected time",
      chain: params.chain.name,
      chain_id: params.chain.id,
    });
  };
  let noNewBlockTimer = setTimeout(noNewBlockWarning, 30_000);
  // Hash of the most recent block received from the RPC.
  let mostRecentHash = params.syncProgress.finalized.hash;

  const { callback, generator } = createCallbackGenerator<{
    block: SyncBlock | SyncBlockHeader;
    blockCallback: (isAccepted: boolean) => void;
    endClock: () => number;
  }>(bufferCallback);

  params.rpc.subscribe({
    onBlock: (block) => {
      if (block.hash !== mostRecentHash) {
        mostRecentHash = block.hash;
        clearTimeout(noNewBlockTimer);
        noNewBlockTimer = setTimeout(noNewBlockWarning, 30_000);
      }

      const pwr = promiseWithResolvers<boolean>();
      const endClock = startClock();
      callback({ block, blockCallback: pwr.resolve, endClock });
      return pwr.promise;
    },
    onError: realtimeSync.onError,
  });

  for await (const { block, blockCallback, endClock } of generator) {
    const arrivalMs = Date.now();

    // Note: No log here because `realtimeSync.sync` logs the block
    const syncGenerator = realtimeSync.sync(block, (isAccepted) => {
      params.common.logger.trace({
        msg: `Block ${isAccepted ? "accepted into" : "rejected from"} live indexing`,
        chain: params.chain.name,
        chain_id: params.chain.id,
        number: hexToNumber(block.number),
        hash: block.hash,
        duration: endClock(),
      });

      if (isAccepted) {
        params.common.metrics.ponder_realtime_block_arrival_latency.observe(
          { chain: params.chain.name },
          arrivalMs - hexToNumber(block.timestamp) * 1_000,
        );

        params.common.metrics.ponder_realtime_latency.observe(
          { chain: params.chain.name },
          endClock(),
        );
      }

      blockCallback(isAccepted);
    });

    for await (const event of syncGenerator) {
      yield { chain: params.chain, event };
    }

    if (block.number === params.syncProgress.end?.number) {
      // The realtime service can be killed if `endBlock` is
      // defined has become finalized.

      params.common.metrics.ponder_sync_is_realtime.set(
        { chain: params.chain.name },
        0,
      );
      params.common.metrics.ponder_sync_is_complete.set(
        { chain: params.chain.name },
        1,
      );
      params.common.logger.info({
        msg: "Completed live indexing (chain end block has been indexed)",
        chain: params.chain.name,
        chain_id: params.chain.id,
        end_block: hexToNumber(params.syncProgress.end!.number),
      });
      await params.rpc.unsubscribe();
      return;
    }
  }
}

export async function handleRealtimeSyncEvent(
  event: RealtimeSyncEvent,
  params: {
    common: Common;
    chain: Chain;
    eventCallbacks: EventCallback[];
    syncProgress: SyncProgress;
    unfinalizedBlocks: Omit<
      Extract<RealtimeSyncEvent, { type: "block" }>,
      "type"
    >[];
    database: Database;
  },
) {
  switch (event.type) {
    case "block": {
      params.syncProgress.current = event.block;

      params.common.metrics.ponder_sync_block.set(
        { chain: params.chain.name },
        hexToNumber(params.syncProgress.current!.number),
      );
      params.common.metrics.ponder_sync_block_timestamp.set(
        { chain: params.chain.name },
        hexToNumber(params.syncProgress.current!.timestamp),
      );

      params.unfinalizedBlocks.push(event);

      break;
    }
    case "finalize": {
      const finalizedInterval = [
        hexToNumber(params.syncProgress.finalized.number),
        hexToNumber(event.block.number),
      ] satisfies Interval;

      params.syncProgress.finalized = event.block;

      // Remove all finalized data

      const finalizedBlocks: typeof params.unfinalizedBlocks = [];

      while (params.unfinalizedBlocks.length > 0) {
        const block = params.unfinalizedBlocks[0]!;

        if (
          hexToNumber(block.block.number) <= hexToNumber(event.block.number)
        ) {
          finalizedBlocks.push(block);
          params.unfinalizedBlocks.shift();
        } else break;
      }

      if (params.chain.disableCache) break;

      // Add finalized blocks, logs, transactions, receipts, and traces to the sync-store.

      const childAddresses = new Map<Factory, Map<Address, number>>();

      for (const block of finalizedBlocks) {
        for (const [factory, addresses] of block.childAddresses) {
          if (childAddresses.has(factory) === false) {
            childAddresses.set(factory, new Map());
          }
          for (const address of addresses) {
            if (childAddresses.get(factory)!.has(address) === false) {
              childAddresses
                .get(factory)!
                .set(address, hexToNumber(block.block.number));
            }
          }
        }
      }

      const context = {
        logger: params.common.logger.child({ action: "finalize_block_range" }),
      };

      await params.database.syncQB.transaction(
        async (tx) => {
          const syncStore = createSyncStore({ common: params.common, qb: tx });

          await promiseAllSettledWithThrow([
            syncStore.insertBlocks({
              blocks: finalizedBlocks
                .filter(({ hasMatchedFilter }) => hasMatchedFilter)
                .map(({ block }) => block),
              chainId: params.chain.id,
            }),
            syncStore.insertTransactions({
              transactions: finalizedBlocks.flatMap(
                ({ transactions }) => transactions,
              ),
              chainId: params.chain.id,
            }),
            syncStore.insertTransactionReceipts({
              transactionReceipts: finalizedBlocks.flatMap(
                ({ transactionReceipts }) => transactionReceipts,
              ),
              chainId: params.chain.id,
            }),
            syncStore.insertLogs({
              logs: finalizedBlocks.flatMap(({ logs }) => logs),
              chainId: params.chain.id,
            }),
            syncStore.insertTraces({
              traces: finalizedBlocks.flatMap(
                ({ traces, block, transactions }) =>
                  traces.map((trace) => ({
                    trace,
                    block: block as SyncBlock, // SyncBlock is expected for traces.length !== 0
                    transaction: transactions.find(
                      (t) => t.hash === trace.transactionHash,
                    )!,
                  })),
              ),
              chainId: params.chain.id,
            }),
            ...Array.from(childAddresses.entries()).map(
              ([factory, childAddresses]) =>
                syncStore.insertChildAddresses({
                  factory,
                  childAddresses,
                  chainId: params.chain.id,
                }),
            ),
          ]);

          const intervals: {
            interval: Interval;
            filter: Filter;
          }[] = [];

          const factoryIntervals: {
            interval: Interval;
            factory: Factory;
          }[] = [];

          for (const { filter } of params.eventCallbacks) {
            const completedIntervals = intervalIntersection(
              [finalizedInterval],
              [
                [
                  filter.fromBlock ?? 0,
                  filter.toBlock ?? Number.POSITIVE_INFINITY,
                ],
              ],
            );

            for (const interval of completedIntervals) {
              intervals.push({ interval, filter });
            }

            for (const factory of getFilterFactories(filter)) {
              const completedIntervals = intervalIntersection(
                [finalizedInterval],
                [
                  [
                    factory.fromBlock ?? 0,
                    factory.toBlock ?? Number.POSITIVE_INFINITY,
                  ],
                ],
              );

              for (const interval of completedIntervals) {
                factoryIntervals.push({ interval, factory });
              }
            }
          }

          await syncStore.insertIntervals(
            {
              intervals,
              factoryIntervals,
              chainId: params.chain.id,
            },
            context,
          );
        },
        undefined,
        context,
      );
      break;
    }
    case "reorg": {
      params.syncProgress.current = event.block;

      params.common.metrics.ponder_sync_block.set(
        { chain: params.chain.name },
        hexToNumber(params.syncProgress.current!.number),
      );
      params.common.metrics.ponder_sync_block_timestamp.set(
        { chain: params.chain.name },
        hexToNumber(params.syncProgress.current!.timestamp),
      );

      // Remove all reorged data

      while (params.unfinalizedBlocks.length > 0) {
        const block =
          params.unfinalizedBlocks[params.unfinalizedBlocks.length - 1]!;

        if (hexToNumber(block.block.number) > hexToNumber(event.block.number)) {
          params.unfinalizedBlocks.pop();
        } else break;
      }

      await createSyncStore({
        common: params.common,
        qb: params.database.syncQB,
      }).pruneRpcRequestResults(
        {
          chainId: params.chain.id,
          blocks: event.reorgedBlocks,
        },
        { logger: params.common.logger.child({ action: "reconcile_reorg" }) },
      );

      break;
    }
  }
}

/**
 * Merges multiple async generators into a single async generator while preserving
 * the order of "block" events.
 *
 * @dev "reorg" and "finalize" events are not ordered between chains.
 */
export async function* mergeAsyncGeneratorsWithRealtimeOrder(
  generators: AsyncGenerator<{ chain: Chain; event: RealtimeSyncEvent }>[],
): AsyncGenerator<{ chain: Chain; event: RealtimeSyncEvent }> {
  const results = await Promise.all(generators.map((gen) => gen.next()));

  while (results.some((res) => res.done !== true)) {
    let index: number;

    if (
      results.some(
        (result) =>
          result.done === false &&
          (result.value.event.type === "reorg" ||
            result.value.event.type === "finalize"),
      )
    ) {
      index = results.findIndex(
        (result) =>
          result.done === false &&
          (result.value.event.type === "reorg" ||
            result.value.event.type === "finalize"),
      );
    } else {
      const blockCheckpoints = results.map((result) =>
        result.done
          ? undefined
          : encodeCheckpoint(
              blockToCheckpoint(
                result.value.event.block,
                result.value.chain.id,
                "up",
              ),
            ),
      );

      const supremum = min(...blockCheckpoints);

      index = blockCheckpoints.findIndex(
        (checkpoint) => checkpoint === supremum,
      );
    }

    const resultPromise = generators[index]!.next();

    yield {
      chain: results[index]!.value.chain,
      event: results[index]!.value.event,
    };
    results[index] = await resultPromise;
  }
}
