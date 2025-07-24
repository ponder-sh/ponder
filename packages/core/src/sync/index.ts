import type { Common } from "@/internal/common.js";
import type {
  Chain,
  CrashRecoveryCheckpoint,
  Event,
  Factory,
  FactoryId,
  Filter,
  IndexingBuild,
  LightBlock,
  RawEvent,
  Source,
  SyncBlock,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import {
  type HistoricalSync,
  createHistoricalSync,
} from "@/sync-historical/index.js";
import {
  type RealtimeSync,
  type RealtimeSyncEvent,
  createRealtimeSync,
} from "@/sync-realtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  MAX_CHECKPOINT,
  ZERO_CHECKPOINT,
  ZERO_CHECKPOINT_STRING,
  decodeCheckpoint,
  encodeCheckpoint,
  max,
  min,
} from "@/utils/checkpoint.js";
import { formatPercentage } from "@/utils/format.js";
import { bufferAsyncGenerator } from "@/utils/generators.js";
import {
  type Interval,
  intervalDifference,
  intervalIntersection,
  intervalIntersectionMany,
  intervalSum,
  sortIntervals,
} from "@/utils/interval.js";
import { intervalUnion } from "@/utils/interval.js";
import { createMutex } from "@/utils/mutex.js";
import { partition } from "@/utils/partition.js";
import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
import { _eth_getBlockByNumber } from "@/utils/rpc.js";
import { startClock } from "@/utils/timer.js";
import { type Address, hexToNumber, toHex } from "viem";
import {
  buildEvents,
  decodeEvents,
  syncBlockToInternal,
  syncLogToInternal,
  syncTraceToInternal,
  syncTransactionReceiptToInternal,
  syncTransactionToInternal,
} from "./events.js";
import { isAddressFactory } from "./filter.js";
import { initGenerator, initSyncProgress } from "./init.js";
import {
  blockToCheckpoint,
  getChainCheckpoint,
  getHistoricalLast,
  isSyncEnd,
  isSyncFinalized,
} from "./utils.js";

export type RealtimeEvent =
  | {
      type: "block";
      events: Event[];
      /**
       * Closest-to-tip checkpoint for each chain,
       * excluding chains that were not updated with this event.
       */
      checkpoints: { chainId: number; checkpoint: string }[];
    }
  | {
      type: "reorg";
      checkpoint: string;
    }
  | {
      type: "finalize";
      checkpoint: string;
    };

export type Sync = {
  getEventGenerators(): Promise<EventGenerator[]>;
  startRealtime(): Promise<void>;
  getStartCheckpoint(chain: Chain): string;
};

type SyncState = {
  [chainId: number]: {
    chain: Chain;
    syncProgress: SyncProgress;
    sources: Source[];
    realtimeSync: RealtimeSync | undefined;
    getEventGenerator(): Promise<EventGenerator>;
    startRealtime(): Promise<void>;
  };
};

type EventGenerator = AsyncGenerator<{ events: Event[]; checkpoint: string }>;

export type SyncProgress = {
  start: SyncBlock | LightBlock;
  end: SyncBlock | LightBlock | undefined;
  current: SyncBlock | LightBlock | undefined;
  finalized: SyncBlock | LightBlock;
};

type createSyncParameters = {
  common: Common;
  indexingBuild: Pick<
    IndexingBuild,
    "sources" | "chains" | "rpcs" | "finalizedBlocks"
  >;
  syncStore: SyncStore;
  crashRecoveryCheckpoint: CrashRecoveryCheckpoint;
  ordering: "multichain" | "omnichain";
  onRealtimeEvent(event: RealtimeEvent): Promise<void>;
  onFatalError(error: Error): void;
};

export const createSync = async (
  params: createSyncParameters,
): Promise<Sync> => {
  const perChainSync = {} as SyncState;

  await Promise.all(
    params.indexingBuild.chains.map(async (chain, index) => {
      const rpc = params.indexingBuild.rpcs[index]!;
      const finalizedBlock = params.indexingBuild.finalizedBlocks[index]!;
      const crashRecoveryCheckpoint = params.crashRecoveryCheckpoint?.find(
        ({ chainId }) => chainId === chain.id,
      )?.checkpoint;
      const sources = params.indexingBuild.sources.filter(
        ({ filter }) => filter.chainId === chain.id,
      );

      // Invalidate sync cache for devnet sources
      if (chain.disableCache) {
        params.common.logger.warn({
          service: "sync",
          msg: `Deleting cache records for '${chain.name}'`,
        });

        await params.syncStore.pruneByChain({
          chainId: chain.id,
        });
      }

      const childAddresses: Map<FactoryId, Map<Address, number>> = new Map();
      for (const source of sources) {
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

      const historicalSync = await createHistoricalSync({
        common: params.common,
        sources,
        syncStore: params.syncStore,
        childAddresses,
        rpc,
        chain,
        onFatalError: params.onFatalError,
      });

      const syncProgress = await initSyncProgress({
        common: params.common,
        chain,
        sources,
        rpc,
        finalizedBlock,
        historicalSync,
      });

      params.common.metrics.ponder_sync_is_realtime.set(
        { chain: chain.name },
        0,
      );
      params.common.metrics.ponder_sync_is_complete.set(
        { chain: chain.name },
        0,
      );

      const realtimeMutex = createMutex();
      perChainSync[chain.id] = {
        chain,
        syncProgress,
        sources,
        realtimeSync: undefined,
        async getEventGenerator() {
          async function* decodeEventGenerator(
            eventGenerator: AsyncGenerator<{
              events: RawEvent[];
              checkpoint: string;
            }>,
          ) {
            for await (const { events, checkpoint } of eventGenerator) {
              const endClock = startClock();
              const decodedEvents = decodeEvents(
                params.common,
                sources,
                events,
              );
              params.common.logger.debug({
                service: "app",
                msg: `Decoded ${decodedEvents.length} '${chain.name}' events`,
              });
              params.common.metrics.ponder_historical_extract_duration.inc(
                { step: "decode" },
                endClock(),
              );

              await new Promise(setImmediate);

              yield { events: decodedEvents, checkpoint };
            }
          }

          // Removes events that have a checkpoint earlier than (or equal to)
          // the crash recovery checkpoint.
          async function* sortCrashRecoveryEvents(
            eventGenerator: AsyncGenerator<{
              events: Event[];
              checkpoint: string;
            }>,
          ) {
            for await (const { events, checkpoint } of eventGenerator) {
              if (
                crashRecoveryCheckpoint &&
                events.length > 0 &&
                events[0]!.checkpoint <= crashRecoveryCheckpoint
              ) {
                const [, right] = partition(
                  events,
                  (event) => event.checkpoint <= crashRecoveryCheckpoint,
                );
                yield { events: right, checkpoint };
              } else {
                yield { events, checkpoint };
              }
            }
          }

          const getLocalGenerator = async () => {
            const localSyncGenerator = getLocalSyncGenerator({
              common: params.common,
              chain: chain,
              syncProgress: syncProgress,
              historicalSync: historicalSync,
            });

            // In order to speed up the "extract" phase when there is a crash recovery,
            // the beginning cursor is moved forwards. This only works when `crashRecoveryCheckpoint`
            // is defined.
            let from: string;
            if (crashRecoveryCheckpoint === undefined) {
              from = getChainCheckpoint({
                tag: "start",
                chainId: chain.id,
                syncProgress,
              });
            } else if (
              Number(decodeCheckpoint(crashRecoveryCheckpoint).chainId) ===
              chain.id
            ) {
              from = crashRecoveryCheckpoint;
            } else {
              const fromBlock =
                await params.syncStore.getSafeCrashRecoveryBlock({
                  chainId: chain.id,
                  timestamp: Number(
                    decodeCheckpoint(crashRecoveryCheckpoint).blockTimestamp,
                  ),
                });

              if (fromBlock === undefined) {
                from = getChainCheckpoint({
                  tag: "start",
                  chainId: chain.id,
                  syncProgress,
                });
              } else {
                from = encodeCheckpoint({
                  ...ZERO_CHECKPOINT,
                  blockNumber: fromBlock.number,
                  blockTimestamp: fromBlock.timestamp,
                  chainId: BigInt(chain.id),
                });
              }
            }

            return getLocalEventGenerator({
              common: params.common,
              chain,
              syncStore: params.syncStore,
              sources,
              localSyncGenerator,
              childAddresses,
              from,
              to: min(
                getChainCheckpoint({
                  tag: "finalized",
                  chainId: chain.id,
                  syncProgress,
                }),
                getChainCheckpoint({
                  tag: "end",
                  chainId: chain.id,
                  syncProgress,
                }),
              ),
              limit:
                Math.round(
                  params.common.options.syncEventsQuerySize /
                    (params.indexingBuild.chains.length + 1),
                ) + 6,
            });
          };

          return initGenerator({
            getLocalGenerator,
            decodeEventGenerator,
            sortCrashRecoveryEvents,
          });
        },
        async startRealtime() {
          if (isSyncEnd(syncProgress)) {
            params.common.metrics.ponder_sync_is_complete.set(
              { chain: chain.name },
              1,
            );

            return;
          }
          params.common.metrics.ponder_sync_is_realtime.set(
            { chain: chain.name },
            1,
          );

          const initialChildAddresses = childAddresses;

          const perChainOnRealtimeSyncEvent = getPerChainOnRealtimeSyncEvent({
            common: params.common,
            chain,
            syncStore: params.syncStore,
            sync: perChainSync,
            ordering: params.ordering,
          });

          const realtimeSync = createRealtimeSync({
            common: params.common,
            chain,
            rpc,
            sources,
            syncProgress,
            initialChildAddresses,
            onEvent: realtimeMutex(async (event) => {
              try {
                // Note: `promise` resolves when the event is fully processed, however,
                // awaiting it will cause a deadlock in "omnichain" ordering.
                const p = await perChainOnRealtimeSyncEvent(event);

                if (isSyncFinalized(syncProgress) && isSyncEnd(syncProgress)) {
                  // The realtime service can be killed if `endBlock` is
                  // defined has become finalized.

                  params.common.metrics.ponder_sync_is_realtime.set(
                    { chain: chain.name },
                    0,
                  );
                  params.common.metrics.ponder_sync_is_complete.set(
                    { chain: chain.name },
                    1,
                  );
                  params.common.logger.info({
                    service: "sync",
                    msg: `Killing '${chain.name}' live indexing because the end block ${hexToNumber(syncProgress.end!.number)} has been finalized`,
                  });
                  rpc.unsubscribe();
                }

                return p ?? { promise: Promise.resolve() };
              } catch (error) {
                params.common.logger.error({
                  service: "sync",
                  msg: `Fatal error: Unable to process ${event.type} event`,
                  error: error as Error,
                });
                params.onFatalError(error as Error);
                return { promise: Promise.resolve() };
              }
            }),
            onFatalError: params.onFatalError,
          });

          perChainSync[chain.id]!.realtimeSync = realtimeSync;

          let childCount = 0;
          for (const [, childAddresses] of initialChildAddresses) {
            childCount += childAddresses.size;
          }

          params.common.logger.debug({
            service: "sync",
            msg: `Initialized '${chain.name}' realtime sync with ${childCount} factory child addresses`,
          });

          rpc.subscribe({
            onBlock: async (block) => {
              const arrivalMs = Date.now();

              const endClock = startClock();
              const syncResult = await realtimeSync.sync(block);

              if (syncResult.type === "accepted") {
                syncResult.blockPromise.then(() => {
                  params.common.metrics.ponder_realtime_block_arrival_latency.observe(
                    { chain: chain.name },
                    arrivalMs - hexToNumber(block.timestamp) * 1_000,
                  );

                  params.common.metrics.ponder_realtime_latency.observe(
                    { chain: chain.name },
                    endClock(),
                  );
                });
              }

              return syncResult;
            },
            onError: (error) => {
              realtimeSync.onError(error);
            },
          });
        },
      };
    }),
  );

  const sync: Awaited<ReturnType<typeof createSync>> = {
    async getEventGenerators() {
      return Promise.all(
        Array.from(Object.values(perChainSync)).map(({ getEventGenerator }) =>
          getEventGenerator(),
        ),
      );
    },
    async startRealtime() {
      for (const { startRealtime } of Object.values(perChainSync)) {
        await startRealtime();
      }
    },
    getStartCheckpoint(chain) {
      const { syncProgress } = perChainSync[chain.id]!;
      return getChainCheckpoint({
        syncProgress,
        chainId: chain.id,
        tag: "start",
      });
    },
  };

  return sync;
};

// type createSyncParameters = {
//   common: Common;
//   syncStore: SyncStore;
//   chain: Chain;
//   rpc: Rpc;
//   sources: Source[];
//   finalizedBlock: LightBlock;
//   crashRecoveryCheckpoint: string | undefined;
//   onRealtimeSyncEvent: (
//     event: RealtimeSyncEvent,
//     chainId: number,
//   ) => Promise<void>;
//   onFatalError(error: Error): void;
// };

// export const createSync = async (
//   params: createSyncParameters,
// ): Promise<Sync> => {
//   const { chain, rpc, finalizedBlock, crashRecoveryCheckpoint, sources } =
//     params;

//   // Invalidate sync cache for devnet sources
//   if (chain.disableCache) {
//     params.common.logger.warn({
//       service: "sync",
//       msg: `Deleting cache records for '${chain.name}'`,
//     });

//     await params.syncStore.pruneByChain({
//       chainId: chain.id,
//     });
//   }

//   const childAddresses: Map<FactoryId, Map<Address, number>> = new Map();
//   for (const source of sources) {
//     switch (source.filter.type) {
//       case "log":
//         if (isAddressFactory(source.filter.address)) {
//           const _childAddresses = await params.syncStore.getChildAddresses({
//             factory: source.filter.address,
//           });
//           childAddresses.set(source.filter.address.id, _childAddresses);
//         }
//         break;
//       case "transaction":
//       case "transfer":
//       case "trace":
//         if (isAddressFactory(source.filter.fromAddress)) {
//           const _childAddresses = await params.syncStore.getChildAddresses({
//             factory: source.filter.fromAddress,
//           });
//           childAddresses.set(source.filter.fromAddress.id, _childAddresses);
//         }

//         if (isAddressFactory(source.filter.toAddress)) {
//           const _childAddresses = await params.syncStore.getChildAddresses({
//             factory: source.filter.toAddress,
//           });
//           childAddresses.set(source.filter.toAddress.id, _childAddresses);
//         }

//         break;
//     }
//   }

//   const historicalSync = await createHistoricalSync({
//     common: params.common,
//     sources,
//     syncStore: params.syncStore,
//     childAddresses,
//     rpc,
//     chain,
//     onFatalError: params.onFatalError,
//   });

//   const syncProgress = await initSyncProgress({
//     common: params.common,
//     chain,
//     sources,
//     rpc,
//     finalizedBlock,
//     historicalSync,
//   });

//   params.common.metrics.ponder_sync_is_realtime.set({ chain: chain.name }, 0);
//   params.common.metrics.ponder_sync_is_complete.set({ chain: chain.name }, 0);

//   const realtimeMutex = createMutex();
//   const sync: Sync = {
//     async getEventGenerator(limit: number) {
//       async function* decodeEventGenerator(
//         eventGenerator: AsyncGenerator<{
//           events: RawEvent[];
//           checkpoint: string;
//         }>,
//       ) {
//         for await (const { events, checkpoint } of eventGenerator) {
//           const endClock = startClock();
//           const decodedEvents = decodeEvents(params.common, sources, events);
//           params.common.logger.debug({
//             service: "app",
//             msg: `Decoded ${decodedEvents.length} '${chain.name}' events`,
//           });
//           params.common.metrics.ponder_historical_extract_duration.inc(
//             { step: "decode" },
//             endClock(),
//           );

//           await new Promise(setImmediate);

//           yield { events: decodedEvents, checkpoint };
//         }
//       }

//       // Removes events that have a checkpoint earlier than (or equal to)
//       // the crash recovery checkpoint.
//       async function* sortCrashRecoveryEvents(
//         eventGenerator: AsyncGenerator<{
//           events: Event[];
//           checkpoint: string;
//         }>,
//       ) {
//         for await (const { events, checkpoint } of eventGenerator) {
//           if (
//             crashRecoveryCheckpoint &&
//             events.length > 0 &&
//             events[0]!.checkpoint <= crashRecoveryCheckpoint
//           ) {
//             const [, right] = partition(
//               events,
//               (event) => event.checkpoint <= crashRecoveryCheckpoint,
//             );
//             yield { events: right, checkpoint };
//           } else {
//             yield { events, checkpoint };
//           }
//         }
//       }

//       const getLocalGenerator = async () => {
//         const localSyncGenerator = getLocalSyncGenerator({
//           common: params.common,
//           chain: chain,
//           syncProgress: sync.syncProgress,
//           historicalSync: historicalSync,
//         });

//         // In order to speed up the "extract" phase when there is a crash recovery,
//         // the beginning cursor is moved forwards. This only works when `crashRecoveryCheckpoint`
//         // is defined.
//         let from: string;
//         if (crashRecoveryCheckpoint === undefined) {
//           from = getChainCheckpoint({
//             tag: "start",
//             chainId: chain.id,
//             syncProgress,
//           });
//         } else if (
//           Number(decodeCheckpoint(crashRecoveryCheckpoint).chainId) === chain.id
//         ) {
//           from = crashRecoveryCheckpoint;
//         } else {
//           const fromBlock = await params.syncStore.getSafeCrashRecoveryBlock({
//             chainId: chain.id,
//             timestamp: Number(
//               decodeCheckpoint(crashRecoveryCheckpoint).blockTimestamp,
//             ),
//           });

//           if (fromBlock === undefined) {
//             from = getChainCheckpoint({
//               tag: "start",
//               chainId: chain.id,
//               syncProgress,
//             });
//           } else {
//             from = encodeCheckpoint({
//               ...ZERO_CHECKPOINT,
//               blockNumber: fromBlock.number,
//               blockTimestamp: fromBlock.timestamp,
//               chainId: BigInt(chain.id),
//             });
//           }
//         }

//         return getLocalEventGenerator({
//           common: params.common,
//           chain,
//           syncStore: params.syncStore,
//           sources,
//           localSyncGenerator,
//           childAddresses,
//           from,
//           to: min(
//             getChainCheckpoint({
//               tag: "finalized",
//               chainId: chain.id,
//               syncProgress,
//             }),
//             getChainCheckpoint({ tag: "end", chainId: chain.id, syncProgress }),
//           ),
//           limit,
//         });
//       };

//       return initGenerator({
//         getLocalGenerator,
//         decodeEventGenerator,
//         sortCrashRecoveryEvents,
//       });
//     },
//     async startRealtime() {
//       if (isSyncEnd(syncProgress)) {
//         params.common.metrics.ponder_sync_is_complete.set(
//           { chain: chain.name },
//           1,
//         );
//       } else {
//         params.common.metrics.ponder_sync_is_realtime.set(
//           { chain: chain.name },
//           1,
//         );

//         const initialChildAddresses = childAddresses;

//         const perChainOnRealtimeSyncEvent = getPerChainOnRealtimeSyncEvent({
//           common: params.common,
//           chain,
//           sources,
//           syncStore: params.syncStore,
//           syncProgress,
//         });

//         const realtimeSync = createRealtimeSync({
//           common: params.common,
//           chain,
//           rpc,
//           sources,
//           syncProgress,
//           initialChildAddresses,
//           onEvent: realtimeMutex(async (event) => {
//             try {
//               await perChainOnRealtimeSyncEvent(event);
//               // Note: `promise` resolves when the event is fully processed, however,
//               // awaiting it will cause a deadlock in "omnichain" ordering.
//               const promise = params.onRealtimeSyncEvent(event, chain.id);

//               if (isSyncFinalized(syncProgress) && isSyncEnd(syncProgress)) {
//                 // The realtime service can be killed if `endBlock` is
//                 // defined has become finalized.

//                 params.common.metrics.ponder_sync_is_realtime.set(
//                   { chain: chain.name },
//                   0,
//                 );
//                 params.common.metrics.ponder_sync_is_complete.set(
//                   { chain: chain.name },
//                   1,
//                 );
//                 params.common.logger.info({
//                   service: "sync",
//                   msg: `Killing '${chain.name}' live indexing because the end block ${hexToNumber(syncProgress.end!.number)} has been finalized`,
//                 });
//                 rpc.unsubscribe();
//               }

//               return { promise };
//             } catch (error) {
//               params.common.logger.error({
//                 service: "sync",
//                 msg: `Fatal error: Unable to process ${event.type} event`,
//                 error: error as Error,
//               });
//               params.onFatalError(error as Error);
//               return { promise: Promise.resolve() };
//             }
//           }),
//           onFatalError: params.onFatalError,
//         });

//         sync.realtimeSync = realtimeSync;

//         let childCount = 0;
//         for (const [, childAddresses] of initialChildAddresses) {
//           childCount += childAddresses.size;
//         }

//         params.common.logger.debug({
//           service: "sync",
//           msg: `Initialized '${chain.name}' realtime sync with ${childCount} factory child addresses`,
//         });

//         rpc.subscribe({
//           onBlock: async (block) => {
//             const arrivalMs = Date.now();

//             const endClock = startClock();
//             const syncResult = await realtimeSync.sync(block);

//             if (syncResult.type === "accepted") {
//               syncResult.blockPromise.then(() => {
//                 params.common.metrics.ponder_realtime_block_arrival_latency.observe(
//                   { chain: chain.name },
//                   arrivalMs - hexToNumber(block.timestamp) * 1_000,
//                 );

//                 params.common.metrics.ponder_realtime_latency.observe(
//                   { chain: chain.name },
//                   endClock(),
//                 );
//               });
//             }

//             return syncResult;
//           },
//           onError: (error) => {
//             realtimeSync.onError(error);
//           },
//         });
//       }
//     },
//     chain,
//     sources,
//     realtimeSync: undefined,
//     syncProgress: syncProgress,
//   };

//   return sync;
// };

function getMultichainCheckpoint<
  tag extends "start" | "end" | "current" | "finalized",
>({
  sync,
  chainId,
  tag,
}: {
  sync: SyncState;
  chainId: number;
  tag: tag;
}): tag extends "end" ? string | undefined : string {
  const { syncProgress } = sync[chainId]!;
  return getChainCheckpoint({ syncProgress, chainId, tag });
}

/**
 * Compute the checkpoint across all chains.
 */
function getOmnichainCheckpoint<
  tag extends "start" | "end" | "current" | "finalized",
>({
  sync,
  tag,
}: {
  sync: SyncState;
  tag: tag;
}): tag extends "end" ? string | undefined : string {
  const checkpoints = Array.from(Object.values(sync)).map(
    ({ chain, syncProgress }) =>
      getChainCheckpoint({ syncProgress, chainId: chain.id, tag }),
  );

  if (tag === "end") {
    if (checkpoints.some((c) => c === undefined)) {
      return undefined as typeof tag extends "end"
        ? string | undefined
        : string;
    }
    // Note: `max` is used here because `end` is an upper bound.
    return max(...checkpoints) as typeof tag extends "end"
      ? string | undefined
      : string;
  }

  // Note: extra logic is needed for `current` because completed chains
  // shouldn't be included in the minimum checkpoint. However, when all
  // chains are completed, the maximum checkpoint should be computed across
  // all chains.
  if (tag === "current") {
    const isComplete = Array.from(Object.values(sync)).map(({ syncProgress }) =>
      isSyncEnd(syncProgress),
    );
    if (isComplete.every((c) => c)) {
      return max(...checkpoints) as typeof tag extends "end"
        ? string | undefined
        : string;
    }
    return min(
      ...checkpoints.filter((_, i) => isComplete[i] === false),
    ) as typeof tag extends "end" ? string | undefined : string;
  }

  return min(...checkpoints) as typeof tag extends "end"
    ? string | undefined
    : string;
}
/**
 * Helpers
 */

export const getPerChainOnRealtimeSyncEvent = ({
  common,
  chain,
  syncStore,
  sync,
  ordering,
}: {
  common: Common;
  chain: Chain;
  syncStore: SyncStore;
  sync: SyncState;
  ordering: "multichain" | "omnichain";
}) => {
  const { syncProgress, sources, realtimeSync } = sync[chain.id]!;

  let unfinalizedBlocks: Omit<
    Extract<RealtimeSyncEvent, { type: "block" }>,
    "type"
  >[] = [];

  /** Events that have been executed but not finalized. */
  let executedEvents = [] as Event[];
  /** Events that have not been executed. */
  let pendingEvents = [] as Event[];
  const checkpoints = {
    // Note: `checkpoints.current` not used in multichain ordering
    current: ZERO_CHECKPOINT_STRING,
    finalized: ZERO_CHECKPOINT_STRING,
  };
  // Note: `omnichainCheckpointHooks` not used in multichain ordering
  let omnichainHooks = [] as {
    checkpoint: string;
    callback: () => void;
  }[];

  return async (
    event: RealtimeSyncEvent,
  ): Promise<{ promise: Promise<void> } | void> => {
    switch (event.type) {
      case "block": {
        syncProgress.current = event.block;

        common.logger.debug({
          service: "sync",
          msg: `Updated '${chain.name}' current block to ${hexToNumber(event.block.number)}`,
        });

        common.metrics.ponder_sync_block.set(
          { chain: chain.name },
          hexToNumber(syncProgress.current!.number),
        );

        unfinalizedBlocks.push(event);

        /**
         * Build events -> decode events
         */

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
          childAddresses: realtimeSync!.childAddresses,
        });

        common.logger.debug({
          service: "sync",
          msg: `Extracted ${events.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
        });

        const decodedEvents = decodeEvents(common, sources, events);
        common.logger.debug({
          service: "sync",
          msg: `Decoded ${decodedEvents.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
        });

        /**
         * Resolve ordering dependent chain of events.
         */

        if (ordering === "multichain") {
          // Note: `checkpoints.current` not used in multichain ordering
          const checkpoint = getMultichainCheckpoint({
            tag: "current",
            chainId: chain.id,
            sync,
          });

          const readyEvents = decodedEvents
            .concat(pendingEvents)
            .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
          pendingEvents = [];
          executedEvents = executedEvents.concat(readyEvents);

          common.logger.debug({
            service: "sync",
            msg: `Sequenced ${readyEvents.length} '${chain.name}' events for block ${hexToNumber(event.block.number)}`,
          });

          await onRealtimeEvent({
            type: "block",
            events: readyEvents,
            checkpoints: [{ chainId: chain.id, checkpoint }],
          });
        } else {
          const from = checkpoints.current;
          checkpoints.current = getOmnichainCheckpoint({
            tag: "current",
            sync,
          });
          const to = getOmnichainCheckpoint({ sync, tag: "current" });

          const pwr = promiseWithResolvers<void>();
          omnichainHooks.push({
            checkpoint: encodeCheckpoint(
              blockToCheckpoint(event.block, chain.id, "down"),
            ),
            callback: () => pwr.resolve(),
          });

          if (to <= from) {
            pendingEvents = pendingEvents.concat(decodedEvents);

            return {
              promise: pwr.promise,
            };
          } else {
            // Move ready events from pending to executed
            const readyEvents = pendingEvents
              .concat(decodedEvents)
              .filter(({ checkpoint }) => checkpoint < to)
              .sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
            pendingEvents = pendingEvents
              .concat(decodedEvents)
              .filter(({ checkpoint }) => checkpoint > to);
            executedEvents = executedEvents.concat(readyEvents);

            common.logger.debug({
              service: "sync",
              msg: `Sequenced ${readyEvents.length} events`,
            });

            const checkpoints: { chainId: number; checkpoint: string }[] = [];
            for (const { chain } of Object.values(sync)) {
              const localBlock = sync[
                chain.id
              ]!.realtimeSync!.unfinalizedBlocks.findLast((block) => {
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

            await onRealtimeEvent({
              type: "block",
              events: readyEvents,
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

            return {
              promise: pwr.promise,
            };
          }
        }

        return {
          promise: Promise.resolve(),
        };
      }

      case "finalize": {
        const finalizedInterval = [
          hexToNumber(syncProgress.finalized.number),
          hexToNumber(event.block.number),
        ] satisfies Interval;

        syncProgress.finalized = event.block;

        common.logger.debug({
          service: "sync",
          msg: `Updated '${chain.name}' finalized block to ${hexToNumber(event.block.number)}`,
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
            chainId: chain.id,
          }),
          syncStore.insertTransactions({
            transactions: finalizedBlocks.flatMap(
              ({ transactions }) => transactions,
            ),
            chainId: chain.id,
          }),
          syncStore.insertTransactionReceipts({
            transactionReceipts: finalizedBlocks.flatMap(
              ({ transactionReceipts }) => transactionReceipts,
            ),
            chainId: chain.id,
          }),
          syncStore.insertLogs({
            logs: finalizedBlocks.flatMap(({ logs }) => logs),
            chainId: chain.id,
          }),
          syncStore.insertTraces({
            traces: finalizedBlocks.flatMap(({ traces, block, transactions }) =>
              traces.map((trace) => ({
                trace,
                block: block as SyncBlock, // SyncBlock is expected for traces.length !== 0
                transaction: transactions.find(
                  (t) => t.hash === trace.transactionHash,
                )!,
              })),
            ),
            chainId: chain.id,
          }),
          ...Array.from(childAddresses.entries()).map(
            ([factory, childAddresses]) =>
              syncStore.insertChildAddresses({
                factory,
                childAddresses,
                chainId: chain.id,
              }),
          ),
        ]);

        // Add corresponding intervals to the sync-store
        // Note: this should happen after insertion so the database doesn't become corrupted

        if (chain.disableCache === false) {
          const syncedIntervals: {
            interval: Interval;
            filter: Filter;
          }[] = [];

          for (const { filter } of sources) {
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
            chainId: chain.id,
          });
        }

        /**
         * Resolve ordering dependent chain of events.
         */

        const from = checkpoints.finalized;
        checkpoints.finalized = getOmnichainCheckpoint({
          tag: "finalized",
          sync,
        });
        const to = getOmnichainCheckpoint({ sync, tag: "finalized" });

        if (
          ordering === "omnichain" &&
          getMultichainCheckpoint({
            chainId: chain.id,
            tag: "finalized",
            sync,
          }) > getOmnichainCheckpoint({ sync, tag: "current" })
        ) {
          const chainId = Number(
            decodeCheckpoint(getOmnichainCheckpoint({ sync, tag: "current" }))
              .chainId,
          );
          const chain = sync[chainId]!.chain;
          common.logger.warn({
            service: "sync",
            msg: `'${chain.name}' is lagging behind other chains`,
          });
        }

        if (to <= from) {
          return;
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
        onRealtimeEvent({ type: "finalize", checkpoint: to });

        common.logger.debug({
          service: "sync",
          msg: `Finalized ${finalizedEvents.length} executed events`,
        });

        return;
      }

      case "reorg": {
        syncProgress.current = event.block;

        common.logger.debug({
          service: "sync",
          msg: `Updated '${chain.name}' current block to ${hexToNumber(event.block.number)}`,
        });

        common.metrics.ponder_sync_block.set(
          { chain: chain.name },
          hexToNumber(syncProgress.current!.number),
        );

        // Remove all reorged data

        unfinalizedBlocks = unfinalizedBlocks.filter(
          ({ block }) =>
            hexToNumber(block.number) <= hexToNumber(event.block.number),
        );

        await syncStore.pruneRpcRequestResults({
          chainId: chain.id,
          blocks: event.reorgedBlocks,
        });

        /**
         * Resolve ordering dependent chain of events.
         */

        const isReorgedEvent = (_event: Event) => {
          if (
            _event.chainId === chain.id &&
            Number(_event.event.block.number) > hexToNumber(event.block.number)
          ) {
            return true;
          }
          return false;
        };

        if (ordering === "multichain") {
          // Note: `checkpoints.current` not used in multichain ordering
          const checkpoint = getMultichainCheckpoint({
            tag: "current",
            chainId: chain.id,
            sync,
          });

          // index of the first reorged event
          let reorgIndex: number | undefined = undefined;
          for (const [index, event] of executedEvents.entries()) {
            if (event.chainId === chain.id && event.checkpoint > checkpoint) {
              reorgIndex = index;
              break;
            }
          }

          if (reorgIndex === undefined) {
            return;
          }

          // Move events from executed to pending

          const reorgedEvents = executedEvents.slice(reorgIndex);
          executedEvents = executedEvents.slice(0, reorgIndex);
          pendingEvents = pendingEvents.concat(reorgedEvents);

          common.logger.debug({
            service: "sync",
            msg: `Rescheduled ${reorgedEvents.length} reorged events`,
          });

          onRealtimeEvent({ type: "reorg", checkpoint });

          pendingEvents = pendingEvents.filter(
            (e) => isReorgedEvent(e) === false,
          );
        } else {
          const from = checkpoints.current;
          checkpoints.current = getOmnichainCheckpoint({
            sync,
            tag: "current",
          });
          const to = getOmnichainCheckpoint({ sync, tag: "current" });

          if (to >= from) {
            return;
          }

          // Move events from executed to pending

          const reorgedEvents = executedEvents.filter((e) => e.checkpoint > to);
          executedEvents = executedEvents.filter((e) => e.checkpoint < to);
          pendingEvents = pendingEvents.concat(reorgedEvents);

          common.logger.debug({
            service: "sync",
            msg: `Rescheduled ${reorgedEvents.length} reorged events`,
          });

          onRealtimeEvent({ type: "reorg", checkpoint: to });

          pendingEvents = pendingEvents.filter(
            (e) => isReorgedEvent(e) === false,
          );
        }

        return;
      }
    }
  };
};

export async function* getLocalEventGenerator(params: {
  common: Common;
  chain: Chain;
  syncStore: SyncStore;
  sources: Source[];
  localSyncGenerator: AsyncGenerator<number>;
  childAddresses: Map<FactoryId, Map<Address, number>>;
  from: string;
  to: string;
  limit: number;
}): AsyncGenerator<{ events: RawEvent[]; checkpoint: string }> {
  const fromBlock = Number(decodeCheckpoint(params.from).blockNumber);
  const toBlock = Number(decodeCheckpoint(params.to).blockNumber);
  let cursor = fromBlock;

  params.common.logger.debug({
    service: "sync",
    msg: `Initialized '${params.chain.name}' extract query for block range [${fromBlock}, ${toBlock}]`,
  });

  for await (const syncCursor of bufferAsyncGenerator(
    params.localSyncGenerator,
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

export async function* getLocalSyncGenerator({
  common,
  chain,
  syncProgress,
  historicalSync,
}: {
  common: Common;
  chain: Chain;
  syncProgress: SyncProgress;
  historicalSync: HistoricalSync;
}): AsyncGenerator<number> {
  const label = { chain: chain.name };

  let cursor = hexToNumber(syncProgress.start.number);
  const last = getHistoricalLast(syncProgress);

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

    common.logger.warn({
      service: "sync",
      msg: `Skipped '${chain.name}' historical sync because the start block is unfinalized`,
    });

    common.metrics.ponder_sync_block.set(
      label,
      hexToNumber(syncProgress.current.number),
    );
    common.metrics.ponder_historical_total_blocks.set(label, 0);
    common.metrics.ponder_historical_cached_blocks.set(label, 0);

    return;
  }

  const totalInterval = [
    hexToNumber(syncProgress.start.number),
    hexToNumber(last.number),
  ] satisfies Interval;

  common.logger.debug({
    service: "sync",
    msg: `Initialized '${chain.name}' historical sync for block range [${totalInterval[0]}, ${totalInterval[1]}]`,
  });

  const requiredIntervals = Array.from(
    historicalSync.intervalsCache.entries(),
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

  common.metrics.ponder_historical_total_blocks.set(label, total);
  common.metrics.ponder_historical_cached_blocks.set(label, total - required);

  // Handle cache hit
  if (syncProgress.current !== undefined) {
    common.metrics.ponder_sync_block.set(
      label,
      hexToNumber(syncProgress.current.number),
    );

    // `getEvents` can make progress without calling `sync`, so immediately "yield"
    yield hexToNumber(syncProgress.current.number);

    if (hexToNumber(syncProgress.current.number) === hexToNumber(last.number)) {
      common.logger.info({
        service: "sync",
        msg: `Skipped '${chain.name}' historical sync because all blocks are cached`,
      });
      return;
    } else {
      common.logger.info({
        service: "sync",
        msg: `Started '${chain.name}' historical sync with ${formatPercentage(
          (total - required) / total,
        )} cached`,
      });
    }

    cursor = hexToNumber(syncProgress.current.number) + 1;
  } else {
    common.logger.info({
      service: "historical",
      msg: `Started '${chain.name}' historical sync with 0% cached`,
    });
  }

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

    common.logger.debug({
      service: "sync",
      msg: `Synced ${interval[1] - interval[0] + 1} '${chain.name}' blocks in range [${interval[0]}, ${interval[1]}]`,
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

      common.metrics.ponder_sync_block.set(
        label,
        hexToNumber(syncProgress.current!.number),
      );
      common.metrics.ponder_historical_duration.observe(label, duration);
      common.metrics.ponder_historical_completed_blocks.inc(
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

      common.logger.trace({
        service: "sync",
        msg: `Updated '${chain.name}' historical sync estimate to ${estimateRange} blocks`,
      });
    }

    yield hexToNumber(syncProgress.current.number);

    if (isSyncEnd(syncProgress) || isSyncFinalized(syncProgress)) {
      common.logger.info({
        service: "sync",
        msg: `Completed '${chain.name}' historical sync`,
      });
      return;
    }
  }
}

export const getLocalSyncProgress = async ({
  common,
  sources,
  chain,
  rpc,
  finalizedBlock,
  intervalsCache,
}: {
  common: Common;
  sources: Source[];
  chain: Chain;
  rpc: Rpc;
  finalizedBlock: LightBlock;
  intervalsCache: HistoricalSync["intervalsCache"];
}): Promise<SyncProgress> => {
  const syncProgress = {} as SyncProgress;
  const filters = sources.map(({ filter }) => filter);

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

  const cached = getCachedBlock({ filters, intervalsCache });

  const diagnostics = await Promise.all(
    cached === undefined
      ? [
          rpc.request({ method: "eth_chainId" }),
          _eth_getBlockByNumber(rpc, { blockNumber: start }),
        ]
      : [
          rpc.request({ method: "eth_chainId" }),
          _eth_getBlockByNumber(rpc, { blockNumber: start }),
          _eth_getBlockByNumber(rpc, { blockNumber: cached }),
        ],
  );

  syncProgress.finalized = finalizedBlock;
  syncProgress.start = diagnostics[1];
  if (diagnostics.length === 3) {
    syncProgress.current = diagnostics[2];
  }

  // Warn if the config has a different chainId than the remote.
  if (hexToNumber(diagnostics[0]) !== chain.id) {
    common.logger.warn({
      service: "sync",
      msg: `Remote chain ID (${diagnostics[0]}) does not match configured chain ID (${chain.id}) for chain "${chain.name}"`,
    });
  }

  if (filters.some((filter) => filter.toBlock === undefined)) {
    return syncProgress;
  }

  // Latest `toBlock` among all `filters`
  const end = Math.max(...filters.map((filter) => filter.toBlock!));

  if (end > hexToNumber(finalizedBlock.number)) {
    syncProgress.end = {
      number: toHex(end),
      hash: "0x",
      parentHash: "0x",
      timestamp: toHex(MAX_CHECKPOINT.blockTimestamp),
    } satisfies LightBlock;
  } else {
    syncProgress.end = await _eth_getBlockByNumber(rpc, {
      blockNumber: end,
    });
  }

  return syncProgress;
};

/** Returns the closest-to-tip block that has been synced for all `sources`. */
export const getCachedBlock = ({
  filters,
  intervalsCache,
}: {
  filters: Filter[];
  intervalsCache: HistoricalSync["intervalsCache"];
}): number | undefined => {
  const latestCompletedBlocks = filters.map((filter) => {
    const requiredInterval = [
      filter.fromBlock ?? 0,
      filter.toBlock ?? Number.POSITIVE_INFINITY,
    ] satisfies Interval;
    const fragmentIntervals = intervalsCache.get(filter)!;

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
