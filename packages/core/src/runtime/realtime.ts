import type {
  Chain,
  Event,
  Factory,
  Filter,
  PerChainPonderApp,
  PonderApp,
  SyncBlock,
  SyncBlockHeader,
} from "@/internal/types.js";
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
import type { SyncStore } from "@/sync-store/index.js";
import {
  ZERO_CHECKPOINT_STRING,
  blockToCheckpoint,
  decodeCheckpoint,
  encodeCheckpoint,
  min,
} from "@/utils/checkpoint.js";
import {
  createCallbackGenerator,
  mergeAsyncGenerators,
} from "@/utils/generators.js";
import { type Interval, intervalIntersection } from "@/utils/interval.js";
import { startClock } from "@/utils/timer.js";
import { type Address, hexToNumber } from "viem";
import {
  type ChildAddresses,
  type SyncProgress,
  getFilters,
  getPerChainPonderApp,
} from "./index.js";
import { getOmnichainCheckpoint } from "./omnichain.js";

export type RealtimeEvent =
  | {
      type: "block";
      events: Event[];
      chain: Chain;
      checkpoint: string;
      blockCallback?: (isAccepted: boolean) => void;
    }
  | {
      type: "reorg";
      chain: Chain;
      checkpoint: string;
    }
  | {
      type: "finalize";
      chain: Chain;
      checkpoint: string;
    };

export async function* getRealtimeEventsOmnichain(
  app: PonderApp,
  {
    perChainSync,
    pendingEvents,
    syncStore,
  }: {
    perChainSync: Map<
      Chain,
      { syncProgress: SyncProgress; childAddresses: ChildAddresses }
    >;
    pendingEvents: Event[];
    syncStore: SyncStore;
  },
): AsyncGenerator<RealtimeEvent> {
  const eventGenerators = getPerChainPonderApp(app)
    .map((app) => {
      const { syncProgress, childAddresses } = perChainSync.get(
        app.indexingBuild.chain,
      )!;

      if (syncProgress.isEnd()) {
        app.common.metrics.ponder_sync_is_complete.set(
          { chain: app.indexingBuild.chain.name },
          1,
        );
        return;
      }

      app.common.metrics.ponder_sync_is_realtime.set(
        { chain: app.indexingBuild.chain.name },
        1,
      );

      return getRealtimeEventGenerator(app, {
        syncProgress,
        childAddresses,
        syncStore,
      });
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
  // let pendingEvents: Event[] = params.pendingEvents;
  /** Closest-to-tip finalized checkpoint across all chains. */
  let finalizedCheckpoint = ZERO_CHECKPOINT_STRING;

  for await (const { chain, event } of mergeAsyncGeneratorsWithRealtimeOrder(
    eventGenerators,
  )) {
    const { syncProgress, childAddresses } = perChainSync.get(chain)!;

    switch (event.type) {
      case "block": {
        const events = buildEvents(app, {
          blockData: {
            block: syncBlockToInternal({ block: event.block }),
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
          },
          childAddresses,
        });

        app.common.logger.debug({
          service: "sync",
          msg: `Extracted ${events.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
        });

        const decodedEvents = decodeEvents(app, { rawEvents: events });
        app.common.logger.debug({
          service: "sync",
          msg: `Decoded ${decodedEvents.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
        });

        const checkpoint = getOmnichainCheckpoint({
          perChainSync,
          tag: "current",
        });

        const readyEvents = pendingEvents
          .concat(decodedEvents)
          .filter((e) => e.checkpoint < checkpoint)
          .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
        pendingEvents = pendingEvents
          .concat(decodedEvents)
          .filter((e) => e.checkpoint > checkpoint);
        executedEvents = executedEvents.concat(readyEvents);

        app.common.logger.debug({
          service: "sync",
          msg: `Sequenced ${readyEvents.length} events`,
        });

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
          perChainSync,
          tag: "finalized",
        });
        const to = getOmnichainCheckpoint({ perChainSync, tag: "finalized" });

        if (
          syncProgress.getCheckpoint({ tag: "finalized" }) >
          getOmnichainCheckpoint({ perChainSync, tag: "current" })
        ) {
          const chainId = Number(
            decodeCheckpoint(
              getOmnichainCheckpoint({ perChainSync, tag: "current" }),
            ).chainId,
          );
          const chain = app.indexingBuild.find(
            ({ chain }) => chain.id === chainId,
          )!.chain;
          app.common.logger.warn({
            service: "sync",
            msg: `'${chain.name}' is lagging behind other chains`,
          });
        }

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

        app.common.logger.debug({
          service: "sync",
          msg: `Finalized ${finalizedEvents.length} executed events`,
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
          perChainSync,
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

        app.common.logger.debug({
          service: "sync",
          msg: `Rescheduled ${reorgedEvents.length} reorged events`,
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

export async function* getRealtimeEventsMultichain(
  app: PonderApp,
  {
    perChainSync,
    syncStore,
  }: {
    perChainSync: Map<
      Chain,
      { syncProgress: SyncProgress; childAddresses: ChildAddresses }
    >;
    syncStore: SyncStore;
  },
): AsyncGenerator<RealtimeEvent> {
  const eventGenerators = getPerChainPonderApp(app)
    .map((app) => {
      const { syncProgress, childAddresses } = perChainSync.get(
        app.indexingBuild.chain,
      )!;

      if (syncProgress.isEnd()) {
        app.common.metrics.ponder_sync_is_complete.set(
          { chain: app.indexingBuild.chain.name },
          1,
        );
        return;
      }

      app.common.metrics.ponder_sync_is_realtime.set(
        { chain: app.indexingBuild.chain.name },
        1,
      );

      return getRealtimeEventGenerator(app, {
        syncProgress,
        childAddresses,
        syncStore,
      });
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
  /** Closest-to-tip finalized checkpoint across all chains. */
  let finalizedCheckpoint = ZERO_CHECKPOINT_STRING;

  for await (const { chain, event } of mergeAsyncGenerators(eventGenerators)) {
    const { syncProgress, childAddresses } = perChainSync.get(chain)!;

    switch (event.type) {
      case "block": {
        const events = buildEvents(app, {
          blockData: {
            block: syncBlockToInternal({ block: event.block }),
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
          },
          childAddresses,
        });

        app.common.logger.debug({
          service: "sync",
          msg: `Extracted ${events.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
        });

        const decodedEvents = decodeEvents(app, { rawEvents: events });
        app.common.logger.debug({
          service: "sync",
          msg: `Decoded ${decodedEvents.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
        });

        const checkpoint = syncProgress.getCheckpoint({ tag: "current" });

        const readyEvents = decodedEvents
          .concat(pendingEvents)
          .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
        pendingEvents = [];
        executedEvents = executedEvents.concat(readyEvents);

        app.common.logger.debug({
          service: "sync",
          msg: `Sequenced ${readyEvents.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
        });

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
          perChainSync,
          tag: "finalized",
        });
        const to = getOmnichainCheckpoint({
          perChainSync,
          tag: "finalized",
        });

        if (
          syncProgress.getCheckpoint({ tag: "finalized" }) >
          getOmnichainCheckpoint({
            perChainSync,
            tag: "current",
          })
        ) {
          const chainId = Number(
            decodeCheckpoint(
              getOmnichainCheckpoint({
                perChainSync,
                tag: "current",
              }),
            ).chainId,
          );
          const chain = app.indexingBuild.find(
            ({ chain }) => chain.id === chainId,
          )!.chain;
          app.common.logger.warn({
            service: "sync",
            msg: `'${chain.name}' is lagging behind other chains`,
          });
        }

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

        app.common.logger.debug({
          service: "sync",
          msg: `Finalized ${finalizedEvents.length} executed events`,
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

        const checkpoint = syncProgress.getCheckpoint({ tag: "current" });

        // index of the first reorged event
        let reorgIndex: number | undefined = undefined;
        for (const [index, event] of executedEvents.entries()) {
          if (event.chain.id === chain.id && event.checkpoint > checkpoint) {
            reorgIndex = index;
            break;
          }
        }

        if (reorgIndex === undefined) continue;

        // Move events from executed to pending

        const reorgedEvents = executedEvents.slice(reorgIndex);
        executedEvents = executedEvents.slice(0, reorgIndex);
        pendingEvents = pendingEvents.concat(reorgedEvents);

        app.common.logger.debug({
          service: "sync",
          msg: `Rescheduled ${reorgedEvents.length} reorged events`,
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

export async function* getRealtimeEventGenerator(
  app: PerChainPonderApp,
  {
    syncProgress,
    childAddresses,
    syncStore,
  }: {
    syncProgress: SyncProgress;
    childAddresses: ChildAddresses;
    syncStore: SyncStore;
  },
) {
  const realtimeSync = createRealtimeSync(app, { childAddresses });

  let childCount = 0;
  for (const [, factoryChildAddresses] of childAddresses) {
    childCount += factoryChildAddresses.size;
  }

  app.common.logger.debug({
    service: "sync",
    msg: `Initialized '${app.indexingBuild.chain.name}' realtime sync with ${childCount} factory child addresses`,
  });

  const { callback, generator } = createCallbackGenerator<
    SyncBlock | SyncBlockHeader,
    boolean
  >();

  app.indexingBuild.rpc.subscribe({
    onBlock: callback,
    onError: realtimeSync.onError,
  });

  for await (const { value: block, onComplete } of generator) {
    const arrivalMs = Date.now();

    const endClock = startClock();

    const syncGenerator = realtimeSync.sync(block, (isAccepted) => {
      if (isAccepted) {
        app.common.metrics.ponder_realtime_block_arrival_latency.observe(
          { chain: app.indexingBuild.chain.name },
          arrivalMs - hexToNumber(block.timestamp) * 1_000,
        );

        app.common.metrics.ponder_realtime_latency.observe(
          { chain: app.indexingBuild.chain.name },
          endClock(),
        );
      }

      onComplete(isAccepted);
    });

    let unfinalizedBlocks: Omit<
      Extract<RealtimeSyncEvent, { type: "block" }>,
      "type"
    >[] = [];

    for await (const event of syncGenerator) {
      switch (event.type) {
        case "block": {
          syncProgress.current = event.block;

          app.common.logger.debug({
            service: "sync",
            msg: `Updated '${app.indexingBuild.chain.name}' current block to ${hexToNumber(event.block.number)}`,
          });

          app.common.metrics.ponder_sync_block.set(
            { chain: app.indexingBuild.chain.name },
            hexToNumber(syncProgress.current!.number),
          );
          app.common.metrics.ponder_sync_block_timestamp.set(
            { chain: app.indexingBuild.chain.name },
            hexToNumber(syncProgress.current!.timestamp),
          );

          unfinalizedBlocks.push(event);

          break;
        }
        case "finalize": {
          const finalizedInterval = [
            hexToNumber(syncProgress.finalized.number),
            hexToNumber(event.block.number),
          ] satisfies Interval;

          syncProgress.finalized = event.block;

          app.common.logger.debug({
            service: "sync",
            msg: `Updated '${app.indexingBuild.chain.name}' finalized block to ${hexToNumber(event.block.number)}`,
          });

          // Remove all finalized data

          const finalizedBlocks = unfinalizedBlocks.filter(
            ({ block }) =>
              hexToNumber(block.number) <= hexToNumber(event.block.number),
          );

          unfinalizedBlocks = unfinalizedBlocks.filter(
            ({ block }) =>
              hexToNumber(block.number) > hexToNumber(event.block.number),
          );

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

          await Promise.all([
            syncStore.insertBlocks({
              blocks: finalizedBlocks
                .filter(({ hasMatchedFilter }) => hasMatchedFilter)
                .map(({ block }) => block),
              chainId: app.indexingBuild.chain.id,
            }),
            syncStore.insertTransactions({
              transactions: finalizedBlocks.flatMap(
                ({ transactions }) => transactions,
              ),
              chainId: app.indexingBuild.chain.id,
            }),
            syncStore.insertTransactionReceipts({
              transactionReceipts: finalizedBlocks.flatMap(
                ({ transactionReceipts }) => transactionReceipts,
              ),
              chainId: app.indexingBuild.chain.id,
            }),
            syncStore.insertLogs({
              logs: finalizedBlocks.flatMap(({ logs }) => logs),
              chainId: app.indexingBuild.chain.id,
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
              chainId: app.indexingBuild.chain.id,
            }),
            ...Array.from(childAddresses.entries()).map(
              ([factory, childAddresses]) =>
                syncStore.insertChildAddresses({
                  factory,
                  childAddresses,
                  chainId: app.indexingBuild.chain.id,
                }),
            ),
          ]);

          // Add corresponding intervals to the sync-store
          // Note: this should happen after insertion so the database doesn't become corrupted

          if (app.indexingBuild.chain.disableCache === false) {
            const syncedIntervals: {
              interval: Interval;
              filter: Filter;
            }[] = [];

            for (const filter of getFilters(app)) {
              const intervals = intervalIntersection(
                [finalizedInterval],
                [
                  [
                    filter.fromBlock ?? 0,
                    filter.toBlock ?? Number.POSITIVE_INFINITY,
                  ],
                ],
              );

              for (const interval of intervals) {
                syncedIntervals.push({ interval, filter });
              }
            }

            await syncStore.insertIntervals({
              intervals: syncedIntervals,
              chainId: app.indexingBuild.chain.id,
            });
          }

          break;
        }
        case "reorg": {
          syncProgress.current = event.block;

          app.common.logger.debug({
            service: "sync",
            msg: `Updated '${app.indexingBuild.chain.name}' current block to ${hexToNumber(event.block.number)}`,
          });

          app.common.metrics.ponder_sync_block.set(
            { chain: app.indexingBuild.chain.name },
            hexToNumber(syncProgress.current!.number),
          );
          app.common.metrics.ponder_sync_block_timestamp.set(
            { chain: app.indexingBuild.chain.name },
            hexToNumber(syncProgress.current!.timestamp),
          );

          // Remove all reorged data

          unfinalizedBlocks = unfinalizedBlocks.filter(
            ({ block }) =>
              hexToNumber(block.number) <= hexToNumber(event.block.number),
          );

          await syncStore.pruneRpcRequestResults({
            chainId: app.indexingBuild.chain.id,
            blocks: event.reorgedBlocks,
          });

          break;
        }
      }

      yield { chain: app.indexingBuild.chain, event };
    }

    if (syncProgress.isFinalized() && syncProgress.isEnd()) {
      // The realtime service can be killed if `endBlock` is
      // defined has become finalized.

      app.common.metrics.ponder_sync_is_realtime.set(
        { chain: app.indexingBuild.chain.name },
        0,
      );
      app.common.metrics.ponder_sync_is_complete.set(
        { chain: app.indexingBuild.chain.name },
        1,
      );
      app.common.logger.info({
        service: "sync",
        msg: `Killing '${app.indexingBuild.chain.name}' live indexing because the end block ${hexToNumber(syncProgress.end!.number)} has been finalized`,
      });
      await app.indexingBuild.rpc.unsubscribe();
      return;
    }
  }
}

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
