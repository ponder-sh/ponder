import type { Common } from "@/internal/common.js";
import type {
  Chain,
  CrashRecoveryCheckpoint,
  Event,
  IndexingBuild,
  Seconds,
  Source,
} from "@/internal/types.js";
import type { RealtimeSync, RealtimeSyncEvent } from "@/sync-realtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  ZERO_CHECKPOINT_STRING,
  decodeCheckpoint,
  encodeCheckpoint,
  max,
  min,
} from "@/utils/checkpoint.js";
import { mapAsyncGenerator, mergeAsyncGenerators } from "@/utils/generators.js";
import { never } from "@/utils/never.js";
import { partition } from "@/utils/partition.js";
import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
import { _eth_getBlockByNumber } from "@/utils/rpc.js";
import { hexToNumber } from "viem";
import {
  buildEvents,
  decodeEvents,
  syncBlockToInternal,
  syncLogToInternal,
  syncTraceToInternal,
  syncTransactionReceiptToInternal,
  syncTransactionToInternal,
} from "./events.js";
import { type Sync, type SyncProgress, createSync } from "./sync.js";
import {
  type EventGenerator,
  blockToCheckpoint,
  getChainCheckpoint,
  isSyncEnd,
  mergeAsyncGeneratorsWithEventOrder,
} from "./utils.js";

type createSyncMananagerParameters = {
  common: Common;
  indexingBuild: Pick<
    IndexingBuild,
    "sources" | "chains" | "rpcs" | "finalizedBlocks"
  >;
  syncStore: SyncStore;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  ordering: "omnichain" | "multichain";
  onRealtimeEvent(event: RealtimeEvent): Promise<void>;
  onFatalError(error: Error): void;
};

type RealtimeEvent =
  | {
      type: "block";
      chain: Chain;
      events: Event[];
      /**
       * Closest-to-tip checkpoint for each chain,
       * excluding chains that were not updated with this event.
       */
      checkpoints: { chainId: number; checkpoint: string }[];
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

export type SyncManager = {
  getEvents(): EventGenerator;
  startRealtime(): Promise<void>;
  getStartCheckpoint(chain: Chain): string;
  seconds: Seconds;
};

export const createSyncManager = async (
  params: createSyncMananagerParameters,
): Promise<SyncManager> => {
  const perChainSync = new Map<Chain, Sync>();

  for (let i = 0; i < params.indexingBuild.chains.length; ++i) {
    const chain = params.indexingBuild.chains[i]!;
    const rpc = params.indexingBuild.rpcs[i]!;
    const finalizedBlock = params.indexingBuild.finalizedBlocks[i]!;
    const crashRecoveryCheckpoint = params.crashRecoveryCheckpoint?.find(
      ({ chainId }) => chainId === chain.id,
    )?.checkpoint;
    const sources = params.indexingBuild.sources;

    const sync = await createSync({
      ...params,
      chain,
      rpc,
      sources,
      crashRecoveryCheckpoint,
      finalizedBlock,
      onFatalError: params.onFatalError,
    });

    perChainSync.set(chain, sync);
  }

  /**
   * Compute the checkpoint for a single chain.
   */
  const getMultichainCheckpoint = <
    tag extends "start" | "end" | "current" | "finalized",
  >({
    tag,
    chain,
  }: { tag: tag; chain: Chain }): tag extends "end"
    ? string | undefined
    : string => {
    const syncProgress = perChainSync.get(chain)!.syncProgress;
    return getChainCheckpoint({ syncProgress, chain, tag });
  };

  /**
   * Compute the checkpoint across all chains.
   */
  const getOmnichainCheckpoint = <
    tag extends "start" | "end" | "current" | "finalized",
  >({
    tag,
  }: { tag: tag }): tag extends "end" ? string | undefined : string => {
    const checkpoints = Array.from(perChainSync.entries()).map(
      ([chain, { syncProgress }]) =>
        getChainCheckpoint({ syncProgress, chain, tag }),
    );

    if (tag === "end") {
      if (checkpoints.some((c) => c === undefined)) {
        return undefined as tag extends "end" ? string | undefined : string;
      }
      // Note: `max` is used here because `end` is an upper bound.
      return max(...checkpoints) as tag extends "end"
        ? string | undefined
        : string;
    }

    // Note: extra logic is needed for `current` because completed chains
    // shouldn't be included in the minimum checkpoint. However, when all
    // chains are completed, the maximum checkpoint should be computed across
    // all chains.
    if (tag === "current") {
      const isComplete = Array.from(perChainSync.values()).map(
        ({ syncProgress }) => isSyncEnd(syncProgress),
      );
      if (isComplete.every((c) => c)) {
        return max(...checkpoints) as tag extends "end"
          ? string | undefined
          : string;
      }
      return min(
        ...checkpoints.filter((_, i) => isComplete[i] === false),
      ) as tag extends "end" ? string | undefined : string;
    }

    return min(...checkpoints) as tag extends "end"
      ? string | undefined
      : string;
  };

  async function* getEvents() {
    const to = min(
      getOmnichainCheckpoint({ tag: "finalized" }),
      getOmnichainCheckpoint({ tag: "end" }),
    );

    async function* sortCompletedAndPendingEvents(
      eventGenerator: AsyncGenerator<{
        events: Event[];
        checkpoint: string;
      }>,
    ) {
      for await (const { events, checkpoint } of eventGenerator) {
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
          yield { events: left, checkpoint: to };
        } else {
          yield { events, checkpoint };
        }
      }
    }

    const eventGenerators = await Promise.all(
      Array.from(perChainSync.values()).map(async ({ getEventGenerator }) => {
        const eventGenerator = await getEventGenerator(
          Math.round(
            params.common.options.syncEventsQuerySize /
              (params.indexingBuild.chains.length + 1),
          ) + 6,
        );
        return sortCompletedAndPendingEvents(eventGenerator);
      }),
    );

    let eventGenerator: EventGenerator;
    if (params.ordering === "multichain") {
      eventGenerator = mapAsyncGenerator(
        mergeAsyncGenerators(eventGenerators),
        ({ events, checkpoint }) => {
          return {
            events,
            checkpoints: [
              {
                chainId: Number(decodeCheckpoint(checkpoint).chainId),
                checkpoint,
              },
            ],
          };
        },
      );
    } else {
      eventGenerator = mergeAsyncGeneratorsWithEventOrder(eventGenerators);
    }

    for await (const { events, checkpoints } of eventGenerator) {
      params.common.logger.debug({
        service: "sync",
        msg: `Sequenced ${events.length} events`,
      });

      yield { events, checkpoints };
    }
  }

  /** Events that have been executed but not finalized. */
  let executedEvents: Event[] = [];
  /** Events that have not been executed. */
  let pendingEvents: Event[] = [];

  const checkpoints = {
    // Note: `checkpoints.current` not used in multichain ordering
    current: ZERO_CHECKPOINT_STRING,
    finalized: ZERO_CHECKPOINT_STRING,
  };

  // Note: `omnichainCheckpointHooks` not used in multichain ordering
  let omnichainHooks: {
    checkpoint: string;
    callback: () => void;
  }[] = [];

  const onRealtimeSyncEvent = async (
    event: RealtimeSyncEvent,
    {
      chain,
      sources,
      syncProgress,
      realtimeSync,
    }: {
      chain: Chain;
      sources: Source[];
      syncProgress: SyncProgress;
      realtimeSync: RealtimeSync;
    },
  ): Promise<void> => {
    switch (event.type) {
      case "block": {
        const events = buildEvents({
          sources,
          chainId: chain.id,
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
          childAddresses: realtimeSync.childAddresses,
        });

        params.common.logger.debug({
          service: "sync",
          msg: `Extracted ${events.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
        });

        const decodedEvents = decodeEvents(params.common, sources, events);
        params.common.logger.debug({
          service: "sync",
          msg: `Decoded ${decodedEvents.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
        });

        if (params.ordering === "multichain") {
          // Note: `checkpoints.current` not used in multichain ordering
          const checkpoint = getMultichainCheckpoint({ tag: "current", chain });

          const readyEvents = decodedEvents
            .concat(pendingEvents)
            .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
          pendingEvents = [];
          executedEvents = executedEvents.concat(readyEvents);

          params.common.logger.debug({
            service: "sync",
            msg: `Sequenced ${readyEvents.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
          });

          await params.onRealtimeEvent({
            type: "block",
            chain,
            events: readyEvents,
            checkpoints: [{ chainId: chain.id, checkpoint }],
          });
        } else {
          const from = checkpoints.current;
          checkpoints.current = getOmnichainCheckpoint({ tag: "current" });
          const to = getOmnichainCheckpoint({ tag: "current" });

          const pwr = promiseWithResolvers<void>();
          omnichainHooks.push({
            checkpoint: encodeCheckpoint(
              blockToCheckpoint(event.block, chain.id, "down"),
            ),
            callback: () => pwr.resolve(),
          });

          if (to > from) {
            // Move ready events from pending to executed
            const readyEvents = pendingEvents
              .concat(decodedEvents)
              .filter(({ checkpoint }) => checkpoint < to)
              .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
            pendingEvents = pendingEvents
              .concat(decodedEvents)
              .filter(({ checkpoint }) => checkpoint > to);
            executedEvents = executedEvents.concat(readyEvents);

            params.common.logger.debug({
              service: "sync",
              msg: `Sequenced ${readyEvents.length} events`,
            });

            const checkpoints: { chainId: number; checkpoint: string }[] = [];
            for (const chain of params.indexingBuild.chains) {
              const localBlock = perChainSync
                .get(chain)!
                .realtimeSync!.unfinalizedBlocks.findLast((block) => {
                  const checkpoint = encodeCheckpoint(
                    blockToCheckpoint(block, chain.id, "up"),
                  );
                  return checkpoint > from && checkpoint <= to;
                });

              if (localBlock) {
                const checkpoint = encodeCheckpoint(
                  blockToCheckpoint(localBlock, chain.id, "up"),
                );

                checkpoints.push({ chainId: chain.id, checkpoint });
              }
            }

            await params.onRealtimeEvent({
              type: "block",
              events: readyEvents,
              chain,
              checkpoints,
            });

            const completedHooks = omnichainHooks.filter(
              ({ checkpoint }) => checkpoint > from && checkpoint <= to,
            );
            omnichainHooks = omnichainHooks.filter(
              ({ checkpoint }) =>
                (checkpoint > from && checkpoint <= to) === false,
            );
            for (const { callback } of completedHooks) {
              callback();
            }
          } else {
            pendingEvents = pendingEvents.concat(decodedEvents);
          }

          return pwr.promise;
        }

        break;
      }

      case "finalize": {
        const from = checkpoints.finalized;
        checkpoints.finalized = getOmnichainCheckpoint({ tag: "finalized" });
        const to = getOmnichainCheckpoint({ tag: "finalized" });

        if (
          params.ordering === "omnichain" &&
          getChainCheckpoint({ syncProgress, chain, tag: "finalized" }) >
            getOmnichainCheckpoint({ tag: "current" })
        ) {
          const chainId = Number(
            decodeCheckpoint(getOmnichainCheckpoint({ tag: "current" }))
              .chainId,
          );
          const chain = params.indexingBuild.chains.find(
            (chain) => chain.id === chainId,
          )!;
          params.common.logger.warn({
            service: "sync",
            msg: `'${chain.name}' is lagging behind other chains`,
          });
        }

        if (to <= from) {
          break;
        }

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

        // Raise event to parent function (runtime)
        params.onRealtimeEvent({ type: "finalize", chain, checkpoint: to });

        params.common.logger.debug({
          service: "sync",
          msg: `Finalized ${finalizedEvents.length} executed events`,
        });

        break;
      }

      case "reorg": {
        const isReorgedEvent = (_event: Event) => {
          if (
            _event.chainId === chain.id &&
            Number(_event.event.block.number) > hexToNumber(event.block.number)
          ) {
            return true;
          }
          return false;
        };

        if (params.ordering === "multichain") {
          // Note: `checkpoints.current` not used in multichain ordering
          const checkpoint = getMultichainCheckpoint({ tag: "current", chain });

          // index of the first reorged event
          let reorgIndex: number | undefined = undefined;
          for (const [index, event] of executedEvents.entries()) {
            if (event.chainId === chain.id && event.checkpoint > checkpoint) {
              reorgIndex = index;
              break;
            }
          }

          if (reorgIndex === undefined) {
            break;
          }

          // Move events from executed to pending

          const reorgedEvents = executedEvents.slice(reorgIndex);
          executedEvents = executedEvents.slice(0, reorgIndex);
          pendingEvents = pendingEvents.concat(reorgedEvents);

          params.common.logger.debug({
            service: "sync",
            msg: `Rescheduled ${reorgedEvents.length} reorged events`,
          });

          params.onRealtimeEvent({ type: "reorg", chain, checkpoint });

          pendingEvents = pendingEvents.filter(
            (e) => isReorgedEvent(e) === false,
          );
        } else {
          const from = checkpoints.current;
          checkpoints.current = getOmnichainCheckpoint({ tag: "current" });
          const to = getOmnichainCheckpoint({ tag: "current" });

          if (to >= from) {
            break;
          }

          // Move events from executed to pending

          const reorgedEvents = executedEvents.filter((e) => e.checkpoint > to);
          executedEvents = executedEvents.filter((e) => e.checkpoint < to);
          pendingEvents = pendingEvents.concat(reorgedEvents);

          params.common.logger.debug({
            service: "sync",
            msg: `Rescheduled ${reorgedEvents.length} reorged events`,
          });

          params.onRealtimeEvent({ type: "reorg", chain, checkpoint: to });

          pendingEvents = pendingEvents.filter(
            (e) => isReorgedEvent(e) === false,
          );
        }

        break;
      }

      default:
        never(event);
    }
  };

  const seconds: Seconds = {};

  for (const chain of params.indexingBuild.chains) {
    const crashRecoveryCheckpoint = params.crashRecoveryCheckpoint?.find(
      ({ chainId }) => chainId === chain.id,
    )?.checkpoint;

    seconds[chain.name] = {
      start: Number(
        decodeCheckpoint(getOmnichainCheckpoint({ tag: "start" }))
          .blockTimestamp,
      ),
      end: Number(
        decodeCheckpoint(
          min(
            getOmnichainCheckpoint({ tag: "end" }),
            getOmnichainCheckpoint({ tag: "finalized" }),
          ),
        ).blockTimestamp,
      ),
      cached: Number(
        decodeCheckpoint(
          min(
            getOmnichainCheckpoint({ tag: "end" }),
            getOmnichainCheckpoint({ tag: "finalized" }),
            crashRecoveryCheckpoint ?? ZERO_CHECKPOINT_STRING,
          ),
        ).blockTimestamp,
      ),
    };
  }

  return {
    getEvents,
    async startRealtime() {
      for (const sync of perChainSync.values()) {
        sync.startRealtime(onRealtimeSyncEvent);
      }
    },
    getStartCheckpoint(chain) {
      return getMultichainCheckpoint({ tag: "start", chain });
    },
    seconds,
  };
};
