import type { Common } from "@/Ponder.js";
import type { IndexingFunctions } from "@/build/functions/functions.js";
import type { TableAccess } from "@/build/parseIndexingAst.js";
import type { Network } from "@/config/networks.js";
import type { Source } from "@/config/sources.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import type { Schema } from "@/schema/types.js";
import type { SyncGateway } from "@/sync-gateway/service.js";
import type { SyncStore } from "@/sync-store/store.js";
import type { Block } from "@/types/block.js";
import type { Log } from "@/types/log.js";
import type { DatabaseModel } from "@/types/model.js";
import type { Transaction } from "@/types/transaction.js";
import { chains } from "@/utils/chains.js";
import {
  type Checkpoint,
  checkpointMin,
  isCheckpointGreaterThan,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { dedupe } from "@/utils/dedupe.js";
import { Emittery } from "@/utils/emittery.js";
import { prettyPrint } from "@/utils/print.js";
import { type Queue, type Worker, createQueue } from "@/utils/queue.js";
import { wait } from "@/utils/wait.js";
import { E_CANCELED, Mutex } from "async-mutex";
import {
  type Abi,
  type AbiItem,
  type Address,
  type Client,
  type Hex,
  decodeEventLog,
} from "viem";
import { checksumAddress, createClient } from "viem";
import { buildDatabaseModels } from "./model.js";
import { type ReadOnlyClient, ponderActions } from "./ponderActions.js";
import { addUserStackTrace } from "./trace.js";
import { ponderTransport } from "./transport.js";

type IndexingEvents = {
  eventsProcessed: { toCheckpoint: Checkpoint };
  error: { error: Error };
};

type LogEvent = {
  networkName: string;
  contractName: string;
  eventName: string;
  chainId: number;
  args: any;
  log: Log;
  block: Block;
  transaction: Transaction;
};
type SetupTask = {
  kind: "SETUP";
  event: {
    networkName: string;
    contractName: string;
    chainId: number;
    blockNumber: number;
  };
};
type LogEventTask = { kind: "LOG"; event: LogEvent };
type IndexingFunctionTask = SetupTask | LogEventTask;
type IndexingFunctionQueue = Queue<IndexingFunctionTask>;

export class IndexingService extends Emittery<IndexingEvents> {
  private common: Common;
  private indexingStore: IndexingStore;
  private syncGatewayService: SyncGateway;
  private sources: Source[];
  private contexts: Record<
    number,
    {
      client: Client;
      network: { chainId: number; name: string };
      contracts: Record<
        string,
        {
          abi: Abi;
          address?: Address | readonly Address[];
          startBlock: number;
          endBlock?: number;
          maxBlockRange?: number;
        }
      >;
    }
  > = {};

  private schema?: Schema;
  private db: Record<string, DatabaseModel<any>> = {};

  private setupFunctionMap?: Record<
    string,
    { function: (...args: any) => any }
  >;
  private indexingFunctionMap?: Record<
    string,
    {
      function: (...args: any) => any;
      sourceName: string;
      eventName: string;
      checkpoint: Checkpoint;
      maxTaskCheckpoint: Checkpoint;
      indexingFunctionTasks: LogEventTask[];
      abiItem: AbiItem;
      eventSelectors: { [sourceId: string]: Hex[] };
      parents: string[];
      serialQueued: boolean;
    }
  >;

  private eventProcessingMutex: Mutex;
  private queue?: IndexingFunctionQueue;

  // TODO: delete
  private eventsProcessedToCheckpoint: Checkpoint = zeroCheckpoint;
  private currentIndexingCheckpoint: Checkpoint = zeroCheckpoint;
  private isPaused = false;

  constructor({
    common,
    syncStore,
    indexingStore,
    syncGatewayService,
    networks,
    sources,
  }: {
    common: Common;
    syncStore: SyncStore;
    indexingStore: IndexingStore;
    syncGatewayService: SyncGateway;
    networks: Network[];
    sources: Source[];
  }) {
    super();
    this.common = common;
    this.indexingStore = indexingStore;
    this.syncGatewayService = syncGatewayService;
    this.sources = sources;

    this.eventProcessingMutex = new Mutex();

    this.contexts = buildContexts(
      sources,
      networks,
      syncStore,
      ponderActions(() => BigInt(this.currentIndexingCheckpoint.blockNumber)),
    );
  }

  kill = async () => {
    this.isPaused = true;
    this.queue?.pause();
    this.queue?.clear();
    await this.queue?.onIdle();

    this.eventProcessingMutex.cancel();

    this.common.logger.debug({
      service: "indexing",
      msg: "Killed indexing service",
    });
  };

  /**
   * Registers a new set of indexing functions and/or a new schema, cancels
   * the current event processing mutex & event queue, drops and re-creates
   * all tables from the indexing store, and resets eventsProcessedToTimestamp to zero.
   *
   * Note: Caller should (probably) immediately call processEvents after this method.
   */
  reset = async ({
    indexingFunctions: newIndexingFunctions,
    schema: newSchema,
    tableAccess,
  }: {
    indexingFunctions?: IndexingFunctions;
    schema?: Schema;
    tableAccess?: TableAccess;
  } = {}) => {
    if (newSchema) {
      this.schema = newSchema;
      this.db = buildDatabaseModels({
        common: this.common,
        indexingStore: this.indexingStore,
        schema: this.schema,
        getCurrentIndexingCheckpoint: () => this.currentIndexingCheckpoint,
      });
    }

    if (newIndexingFunctions && tableAccess) {
      this.indexingFunctionMap = buildIndexingFunctionMap(
        newIndexingFunctions,
        tableAccess,
        this.sources,
      );

      for (const key of Object.keys(this.indexingFunctionMap)) {
        await this.loadIndexingFunctionTasks(key);
      }

      this.queue = this.createEventQueue();

      this.enqueueSetupTasks(newIndexingFunctions);
    }

    // If either the schema or indexing functions have not been provided yet,
    // we're not ready to process events. Just return early.
    // if (!this.schema || this.indexingFunctionMap === {}) return;

    // Cancel all pending calls to processEvents and reset the mutex.
    // this.eventProcessingMutex.cancel();
    // this.eventProcessingMutex = new Mutex();

    // // Pause the old queue, (maybe) wait for the current indexing function to finish,
    // // then create a new queue using the new indexing functions.
    // this.queue?.clear();
    // this.queue?.pause();
    // await this.queue?.onIdle();

    // this.common.logger.debug({
    //   service: "indexing",
    //   msg: "Paused event queue",
    // });

    // this.isPaused = false;
    // this.common.metrics.ponder_indexing_has_error.set(0);

    // this.common.metrics.ponder_indexing_matched_events.reset();
    // this.common.metrics.ponder_indexing_handled_events.reset();
    // this.common.metrics.ponder_indexing_processed_events.reset();

    // await this.indexingStore.reload({ schema: this.schema });
    // this.common.logger.debug({
    //   service: "indexing",
    //   msg: "Reset indexing store",
    // });

    // // When we call indexingStore.reload() above, the indexing store is dropped.
    // // Set the latest processed timestamp to zero accordingly.
    // this.eventsProcessedToCheckpoint = zeroCheckpoint;
    // this.currentIndexingCheckpoint = zeroCheckpoint;
    // this.common.metrics.ponder_indexing_latest_processed_timestamp.set(0);
  };

  private enqueueSetupTasks = (indexingFunctions: IndexingFunctions) => {
    for (const sourceName of Object.keys(indexingFunctions)) {
      for (const eventName of Object.keys(indexingFunctions[sourceName])) {
        if (eventName !== "setup") continue;

        if (this.setupFunctionMap === undefined) {
          this.setupFunctionMap = {};
        }
        this.setupFunctionMap![sourceName] = {
          function: indexingFunctions[sourceName][eventName],
        };

        const contexts = Object.values(this.contexts).filter(
          (c) => sourceName in c.contracts,
        );

        for (const { contracts, network } of contexts) {
          const labels = {
            network: network.name,
            contract: sourceName,
            event: "setup",
          };
          this.common.metrics.ponder_indexing_matched_events.inc(labels);

          this.queue!.addTask({
            kind: "SETUP",
            event: {
              networkName: network.name,
              contractName: sourceName,
              chainId: network.chainId,
              blockNumber: contracts[sourceName].startBlock,
            },
          });
        }
      }
    }
  };

  private enqueueNextTasks = () => {
    if (this.indexingFunctionMap === undefined) return;

    for (const key of Object.keys(this.indexingFunctionMap!)) {
      const parentCheckpoints = this.indexingFunctionMap[key].parents.map(
        (p) => {
          if (
            p === key &&
            this.indexingFunctionMap![key].serialQueued === false
          ) {
            this.indexingFunctionMap![key].serialQueued = true;
            return getEventCheckpoint(
              this.indexingFunctionMap![key].indexingFunctionTasks[0],
            );
          }

          return this.indexingFunctionMap![p].checkpoint;
        },
      );

      const minParentCheckpoint = checkpointMin(...parentCheckpoints);

      // maximum checkpoint that is less than `minParentCheckpoint`
      const maxCheckpointIndex = this.indexingFunctionMap[
        key
      ].indexingFunctionTasks.findIndex((task) =>
        isCheckpointGreaterThan(getEventCheckpoint(task), minParentCheckpoint),
      );

      // TODO: logic is need to make sure multiple of the same events aren't being enqueued

      if (maxCheckpointIndex !== 0) {
        const eventsEnequeued = this.indexingFunctionMap[
          key
        ].indexingFunctionTasks.splice(0, maxCheckpointIndex);

        for (const { event } of eventsEnequeued) {
          const decodedLog = decodeEventLog({
            abi: [this.indexingFunctionMap[key].abiItem],
            data: event.log.data,
            topics: event.log.topics,
          });
          this.queue!.addTask({
            kind: "LOG",
            event: {
              networkName: event.networkName,
              contractName: this.indexingFunctionMap[key].sourceName,
              eventName: this.indexingFunctionMap[key].eventName,
              chainId: event.chainId,
              args: decodedLog.args ?? {},
              log: event.log,
              block: event.block,
              transaction: event.transaction,
            },
          });
        }
      }
    }
  };

  /**
   * This method is triggered by the realtime sync service detecting a reorg,
   * which can happen at any time. The event queue and the indexing store can be
   * in one of several different states that we need to keep in mind:
   *
   * 1) No events have been added to the queue yet.
   * 2) No unsafe events have been processed (eventsProcessedToTimestamp <= commonAncestorTimestamp).
   * 3) Unsafe events may have been processed (eventsProcessedToTimestamp > commonAncestorTimestamp).
   * 4) The queue has encountered a user error and is waiting for a reload.
   *
   * Note: It's crucial that we acquire a mutex lock while handling the reorg.
   * This will only ever run while the queue is idle, so we can be confident
   * that eventsProcessedToTimestamp matches the current state of the indexing store,
   * and that no unsafe events will get processed after handling the reorg.
   *
   * Note: Caller should (probably) immediately call processEvents after this method.
   */
  handleReorg = async (safeCheckpoint: Checkpoint) => {
    try {
      await this.eventProcessingMutex.runExclusive(async () => {
        // If there is a user error, the queue & indexing store will be wiped on reload (case 4).
        if (this.isPaused) return;

        const hasProcessedInvalidEvents = isCheckpointGreaterThan(
          this.eventsProcessedToCheckpoint,
          safeCheckpoint,
        );
        if (!hasProcessedInvalidEvents) {
          // No unsafe events have been processed, so no need to revert (case 1 & case 2).
          this.common.logger.debug({
            service: "indexing",
            msg: "No unsafe events were detected while reconciling a reorg, no-op",
          });
          return;
        }

        // Unsafe events have been processed, must revert the indexing store and update
        // eventsProcessedToTimestamp accordingly (case 3).
        await this.indexingStore.revert({ checkpoint: safeCheckpoint });

        this.eventsProcessedToCheckpoint = safeCheckpoint;
        this.common.metrics.ponder_indexing_latest_processed_timestamp.set(
          safeCheckpoint.blockTimestamp,
        );

        // Note: There's currently no way to know how many events are "thrown out"
        // during the reorg reconciliation, so the event count metrics
        // (e.g. ponder_indexing_processed_events) will be slightly inflated.

        this.common.logger.debug({
          service: "indexing",
          msg: `Reverted indexing store to safe timestamp ${safeCheckpoint.blockTimestamp}`,
        });
      });
    } catch (error) {
      // Pending locks get cancelled in reset(). This is expected, so it's safe to
      // ignore the error that is thrown when a pending lock is cancelled.
      if (error !== E_CANCELED) throw error;
    }
  };

  /**
   * Processes all newly available events.
   *
   * Acquires a lock on the event processing mutex, then gets the latest checkpoint
   * from the sync gateway service. Fetches events between previous checkpoint
   * and the new checkpoint, adds them to the queue, then processes them.
   */
  processEvents = async () => {
    this.eventProcessingMutex.runExclusive(() => {
      this.queue?.start();

      this.enqueueNextTasks();
    });

    // try {
    //   await this.eventProcessingMutex.runExclusive(async () => {
    //     if (this.isPaused || !this.queue || !this.indexingFunctions) return;
    //     const fromCheckpoint = this.eventsProcessedToCheckpoint;
    //     const toCheckpoint = this.syncGatewayService.checkpoint;
    //     // If we have already added events to the queue for the current checkpoint,
    //     // do nothing and return. This can happen if a number of calls to processEvents
    //     // "stack up" while one is being processed, and then they all run sequentially
    //     // but the sync gateway service checkpoint has not moved.
    //     if (!isCheckpointGreaterThan(toCheckpoint, fromCheckpoint)) return;
    //     // If no events have been added yet, add the setup events for each chain & associated metrics.
    //     if (isCheckpointEqual(fromCheckpoint, zeroCheckpoint)) {
    //       Object.entries(this.indexingFunctions)
    //         .filter(([, events]) =>
    //           Object.keys(events).some((e) => e === "setup"),
    //         )
    //         .forEach(([sourceName]) => {
    //           Object.values(this.contexts)
    //             .filter(({ contracts }) => sourceName in contracts)
    //             .forEach(({ contracts, network }) => {
    //               const labels = {
    //                 network: network.name,
    //                 contract: sourceName,
    //                 event: "setup",
    //               };
    //               this.common.metrics.ponder_indexing_matched_events.inc(
    //                 labels,
    //               );
    //               this.queue?.addTask({
    //                 kind: "SETUP",
    //                 event: {
    //                   networkName: network.name,
    //                   contractName: sourceName,
    //                   chainId: network.chainId,
    //                   blockNumber: contracts[sourceName].startBlock,
    //                 },
    //               });
    //               this.common.metrics.ponder_indexing_handled_events.inc(
    //                 labels,
    //               );
    //             });
    //         });
    //     }
    //     // Build source ID and event selector maps.
    //     const sourcesById: { [sourceId: string]: Source } = {};
    //     const registeredSelectorsBySourceId: { [sourceId: string]: Hex[] } = {};
    //     for (const source of this.sources) {
    //       sourcesById[source.id] = source;
    //       const indexingFunctions =
    //         this.indexingFunctions![source.contractName];
    //       if (indexingFunctions) {
    //         registeredSelectorsBySourceId[source.id] = Object.keys(
    //           indexingFunctions,
    //         )
    //           .filter((name) => name !== "setup")
    //           .map((safeEventName) => {
    //             const abiItemMeta = source.abiEvents.bySafeName[safeEventName];
    //             if (!abiItemMeta)
    //               throw new Error(
    //                 `Invariant violation: No abiItemMeta found for ${source.contractName}:${safeEventName}`,
    //               );
    //             return abiItemMeta.selector;
    //           });
    //       } else {
    //         // It's possible for no indexing functions to be registered for a source.
    //         registeredSelectorsBySourceId[source.id] = [];
    //       }
    //     }
    //     const iterator = this.syncGatewayService.getEvents({
    //       fromCheckpoint,
    //       toCheckpoint,
    //       includeEventSelectors: registeredSelectorsBySourceId,
    //     });
    //     let pageIndex = 0;
    //     for await (const page of iterator) {
    //       const { events, metadata } = page;
    //       // Increment the metrics for the total number of matching & indexed events in this timestamp range.
    //       // The metadata comes with every page, but is the same for all pages, so do this on the first page.
    //       if (pageIndex === 0) {
    //         metadata.counts.forEach(({ sourceId, selector, count }) => {
    //           const source = sourcesById[sourceId];
    //           if (!source)
    //             throw new Error(
    //               `Invariant violation: Source ID not found ${sourceId}`,
    //             );
    //           const abiItemMeta = source.abiEvents.bySelector[selector];
    //           // This means that the contract has emitted events that are not present in the ABI
    //           // that the user has provided. Use the raw selector as the event name for the metric.
    //           if (!abiItemMeta) {
    //             const labels = {
    //               network: source.networkName,
    //               contract: source.contractName,
    //               event: selector,
    //             };
    //             this.common.metrics.ponder_indexing_matched_events.inc(
    //               labels,
    //               count,
    //             );
    //             return;
    //           }
    //           const labels = {
    //             network: source.networkName,
    //             contract: source.contractName,
    //             event: abiItemMeta.safeName,
    //           };
    //           this.common.metrics.ponder_indexing_matched_events.inc(
    //             labels,
    //             count,
    //           );
    //           const isRegistered =
    //             registeredSelectorsBySourceId[sourceId].includes(selector);
    //           if (isRegistered) {
    //             this.common.metrics.ponder_indexing_handled_events.inc(
    //               labels,
    //               count,
    //             );
    //           }
    //         });
    //       }
    //       // Decode events and add them to the queue.
    //       events.forEach((event) => {
    //         const selector = event.log.topics[0];
    //         // Should always have a selector because of the includeEventSelectors pattern.
    //         if (!selector)
    //           throw new Error(
    //             `Invariant violation: Log is missing topics ${event.log.id}`,
    //           );
    //         const source = sourcesById[event.sourceId];
    //         if (!source)
    //           throw new Error(
    //             `Invariant violation: Source ID not found ${event.sourceId}`,
    //           );
    //         const abiItemMeta = source.abiEvents.bySelector[selector];
    //         if (!abiItemMeta)
    //           throw new Error(
    //             `Invariant violation: No abiItemMeta found for ${source.contractName}:${selector}`,
    //           );
    //         try {
    //           const decodedLog = decodeEventLog({
    //             abi: [abiItemMeta.item],
    //             data: event.log.data,
    //             topics: event.log.topics,
    //           });
    //           this.queue!.addTask({
    //             kind: "LOG",
    //             event: {
    //               networkName: source.networkName,
    //               contractName: source.contractName,
    //               eventName: abiItemMeta.safeName,
    //               chainId: event.chainId,
    //               args: decodedLog.args ?? {},
    //               log: event.log,
    //               block: event.block,
    //               transaction: event.transaction,
    //             },
    //           });
    //         } catch (err) {
    //           // Sometimes, logs match a selector but cannot be decoded using the provided ABI.
    //           // This happens often when using custom event filters, because the indexed-ness
    //           // of an event parameter is not taken into account when generating the selector.
    //           this.common.logger.debug({
    //             service: "app",
    //             msg: `Unable to decode log, skipping it. id: ${event.log.id}, data: ${event.log.data}, topics: ${event.log.topics}`,
    //           });
    //         }
    //       });
    //       // Process new events that were added to the queue.
    //       this.queue.start();
    //       await this.queue.onIdle();
    //       // If the queue is already paused here, it means that reset() was called, interrupting
    //       // event processing. When this happens, we want to return early.
    //       if (this.queue.isPaused) return;
    //       this.queue.pause();
    //       if (events.length > 0) {
    //         const { blockTimestamp, chainId, blockNumber, logIndex } =
    //           metadata.pageEndCheckpoint;
    //         this.common.logger.info({
    //           service: "indexing",
    //           msg: `Indexed ${
    //             events.length === 1 ? "1 event" : `${events.length} events`
    //           } up to ${formatShortDate(
    //             blockTimestamp,
    //           )} (chainId=${chainId} block=${blockNumber} logIndex=${logIndex})`,
    //         });
    //       }
    //       pageIndex += 1;
    //     }
    //     this.emit("eventsProcessed", { toCheckpoint });
    //     this.eventsProcessedToCheckpoint = toCheckpoint;
    //     // Note that this happens both here and in the log event indexing function.
    //     // They must also happen here to handle the case where no events were processed.
    //     this.common.metrics.ponder_indexing_latest_processed_timestamp.set(
    //       toCheckpoint.blockTimestamp,
    //     );
    //   });
    // } catch (error) {
    //   // Pending locks get cancelled in reset(). This is expected, so it's safe to
    //   // ignore the error that is thrown when a pending lock is cancelled.
    //   if (error !== E_CANCELED) throw error;
    // }
  };

  private createEventQueue = () => {
    const indexingFunctionWorker: Worker<IndexingFunctionTask> = async ({
      task,
    }) => {
      // This is a hack to ensure that the eventsProcessed method is called and updates
      // the UI when using SQLite. It also allows the process to GC and handle SIGINT events.
      // It does, however, slow down event processing a bit. Too frequent waits cause massive performance loses.
      // if (Math.floor(Math.random() * 100) === 69) await wait(0);

      switch (task.kind) {
        case "SETUP": {
          const event = task.event;

          const fullEventName = `${event.contractName}:setup`;

          const indexingFunction =
            this.setupFunctionMap?.[event.contractName]?.function;
          if (!indexingFunction)
            throw new Error(
              `Internal: Indexing function not found for ${fullEventName}`,
            );

          // The "setup" event uses the contract start block number for contract calls.
          // TODO: Consider implications of this "synthetic" checkpoint on record versioning.
          this.currentIndexingCheckpoint = {
            ...zeroCheckpoint,
            chainId: task.event.chainId,
            blockNumber: task.event.blockNumber,
          };

          for (let i = 0; i < 4; i++) {
            try {
              this.common.logger.trace({
                service: "indexing",
                msg: `Started indexing function (event="${fullEventName}", block=${event.blockNumber})`,
              });

              // Running user code here!
              // await indexingFunction({
              //   context: { db: this.db, ...this.contexts[event.chainId] },
              // });

              this.common.logger.trace({
                service: "indexing",
                msg: `Completed indexing function (event="${fullEventName}", block=${event.blockNumber})`,
              });

              const labels = {
                network: event.networkName,
                contract: event.contractName,
                event: "setup",
              };
              this.common.metrics.ponder_indexing_processed_events.inc(labels);

              break;
            } catch (error_) {
              // Remove all remaining tasks from the queue.

              const error = error_ as Error & { meta: string };

              if (i === 3) {
                queue.pause();
                queue.clear();
                this.isPaused = true;

                addUserStackTrace(error, this.common.options);

                this.common.logger.error({
                  service: "indexing",
                  msg: `Error while processing "setup" event: ${error.message}`,
                  error,
                });

                this.common.metrics.ponder_indexing_has_error.set(1);
                this.emit("error", { error });
              } else {
                this.common.logger.warn({
                  service: "indexing",
                  msg: `Indexing function failed, retrying... (event=${fullEventName}, error=${error.name}: ${error.message})`,
                });
                await this.indexingStore.revert({
                  checkpoint: this.currentIndexingCheckpoint,
                });
              }
            }
          }

          break;
        }
        case "LOG": {
          const event = task.event;

          const fullEventName = `${event.contractName}:${event.eventName}`;

          const indexingFunction =
            this.indexingFunctionMap?.[fullEventName].function;
          if (!indexingFunction)
            throw new Error(
              `Internal: Indexing function not found for ${fullEventName}`,
            );

          this.currentIndexingCheckpoint = {
            blockTimestamp: Number(event.block.timestamp),
            chainId: event.chainId,
            blockNumber: Number(event.block.number),
            logIndex: event.log.logIndex,
          };

          for (let i = 0; i < 4; i++) {
            try {
              this.common.logger.trace({
                service: "indexing",
                msg: `Started indexing function (event="${fullEventName}", block=${event.block.number})`,
              });

              await wait(50);
              // Running user code here!
              // await indexingFunction({
              //   event: {
              //     name: event.eventName,
              //     args: event.args,
              //     log: event.log,
              //     transaction: event.transaction,
              //     block: event.block,
              //   },
              //   context: { db: this.db, ...this.contexts[event.chainId] },
              // });

              this.common.logger.trace({
                service: "indexing",
                msg: `Completed indexing function (event="${fullEventName}", block=${event.block.number})`,
              });

              const labels = {
                network: event.networkName,
                contract: event.contractName,
                event: event.eventName,
              };
              this.common.metrics.ponder_indexing_processed_events.inc(labels);
              this.common.metrics.ponder_indexing_latest_processed_timestamp.set(
                this.currentIndexingCheckpoint.blockTimestamp,
              );

              break;
            } catch (error_) {
              const error = error_ as Error & { meta?: string };

              if (i === 3) {
                queue.pause();
                queue.clear();
                this.isPaused = true;

                addUserStackTrace(error, this.common.options);
                if (error.meta) {
                  error.meta += `\nEvent args:\n${prettyPrint(event.args)}`;
                } else {
                  error.meta = `Event args:\n${prettyPrint(event.args)}`;
                }

                this.common.logger.error({
                  service: "indexing",
                  msg: `Error while processing "${fullEventName}" event at block ${Number(
                    event.block.number,
                  )}:`,
                  error,
                });

                this.common.metrics.ponder_indexing_has_error.set(1);
                this.emit("error", { error });
              } else {
                this.common.logger.warn({
                  service: "indexing",
                  msg: `Indexing function failed, retrying... (event=${fullEventName}, block=${Number(
                    event.block.number,
                  )}, error=${`${error.name}: ${error.message}`})`,
                });
                await this.indexingStore.revert({
                  checkpoint: this.currentIndexingCheckpoint,
                });
              }
            }
          }
          await this.loadIndexingFunctionTasks(fullEventName);

          // update checkpoint
          this.indexingFunctionMap![fullEventName].checkpoint =
            getEventCheckpoint(task);

          this.indexingFunctionMap![fullEventName].serialQueued = false;

          this.enqueueNextTasks();

          break;
        }
      }
    };

    const queue = createQueue({
      worker: indexingFunctionWorker,
      options: {
        concurrency: 10,
        autoStart: false,
      },
    });

    return queue;
  };

  /**
   * Load indexing function tasks from the sync store.
   *
   * Max batch size is 1000.
   */
  private loadIndexingFunctionTasks = async (indexingFunctionKey: string) => {
    if (this.indexingFunctionMap === undefined) return;

    const currentTasks =
      this.indexingFunctionMap[indexingFunctionKey].indexingFunctionTasks;

    if (currentTasks.length >= 200) return;

    const events = await this.syncGatewayService
      .getEvents({
        // Note: this should be slightly incremented to avoid retrieving duplicate events
        fromCheckpoint:
          this.indexingFunctionMap[indexingFunctionKey].maxTaskCheckpoint,
        toCheckpoint: maxCheckpoint,
        includeEventSelectors:
          this.indexingFunctionMap[indexingFunctionKey].eventSelectors,
        pageSize: 1_000,
      })
      .next();

    // Note: Should we do something with the maxTaskCheckpoint
    if (events.done === true) {
      this.indexingFunctionMap[indexingFunctionKey].maxTaskCheckpoint =
        maxCheckpoint;
      return;
    } else {
      this.indexingFunctionMap[indexingFunctionKey].maxTaskCheckpoint =
        events.value.metadata.pageEndCheckpoint;

      for (const event of events.value.events) {
        const source = this.sources.find((s) => s.id === event.sourceId)!;

        try {
          const decodedLog = decodeEventLog({
            abi: [this.indexingFunctionMap[indexingFunctionKey].abiItem],
            data: event.log.data,
            topics: event.log.topics,
          });

          this.indexingFunctionMap[
            indexingFunctionKey
          ].indexingFunctionTasks.push({
            kind: "LOG",
            event: {
              networkName: source.networkName,
              contractName: source.contractName,
              eventName:
                this.indexingFunctionMap[indexingFunctionKey].eventName,
              chainId: event.chainId,
              args: decodedLog.args ?? {},
              log: event.log,
              block: event.block,
              transaction: event.transaction,
            },
          });
        } catch (err) {
          // Sometimes, logs match a selector but cannot be decoded using the provided ABI.
          // This happens often when using custom event filters, because the indexed-ness
          // of an event parameter is not taken into account when generating the selector.
          this.common.logger.debug({
            service: "app",
            msg: `Unable to decode log, skipping it. id: ${event.log.id}, data: ${event.log.data}, topics: ${event.log.topics}`,
          });
        }
      }
    }
  };
}

const buildIndexingFunctionMap = (
  indexingFunctions: IndexingFunctions,
  tableAccess: TableAccess,
  sources: Source[],
) => {
  const indexingFunctionMap = {} as NonNullable<
    IndexingService["indexingFunctionMap"]
  >;

  for (const sourceName of Object.keys(indexingFunctions)) {
    for (const eventName of Object.keys(indexingFunctions[sourceName])) {
      if (eventName === "setup") continue;

      const indexingFunctionKey = `${sourceName}:${eventName}`;

      // All tables that this indexing function key reads
      const tableReads = tableAccess
        .filter(
          (t) =>
            t.indexingFunctionKey === indexingFunctionKey &&
            t.access === "read",
        )
        .map((t) => t.table);

      // all indexing function keys that write to a table in `tableReads`
      const parents = tableAccess
        .filter((t) => t.access === "write" && tableReads.includes(t.table))
        .map((t) => t.indexingFunctionKey);

      const eventSelectors = {} as { [sourceId: string]: Hex[] };
      let abiItem: AbiItem;

      for (const source of sources) {
        if (source.contractName === sourceName) {
          if (eventSelectors[source.id] === undefined) {
            eventSelectors[source.id] = [];
          }

          const abiItemMeta = source.abiEvents.bySafeName[eventName];
          if (!abiItemMeta) {
            throw new Error(
              `Invariant violation: No abiItemMeta found for ${indexingFunctionKey}`,
            );
          }

          abiItem = abiItemMeta.item;
          eventSelectors[source.id].push(abiItemMeta.selector);
        } else {
          eventSelectors[source.id] = [];
        }
      }

      indexingFunctionMap[indexingFunctionKey] = {
        eventName,
        sourceName,
        function: indexingFunctions[sourceName][eventName],
        checkpoint: zeroCheckpoint,
        maxTaskCheckpoint: zeroCheckpoint,
        indexingFunctionTasks: [],
        eventSelectors,
        abiItem: abiItem!,
        parents: dedupe(parents),
        serialQueued: false,
      };
    }
  }

  return indexingFunctionMap;
};

const buildContexts = (
  sources: Source[],
  networks: Network[],
  syncStore: SyncStore,
  actions: ReturnType<typeof ponderActions>,
) => {
  const contexts: Record<
    number,
    {
      client: Client;
      network: { chainId: number; name: string };
      contracts: Record<
        string,
        {
          abi: Abi;
          address?: Address | readonly Address[];
          startBlock: number;
          endBlock?: number;
          maxBlockRange?: number;
        }
      >;
    }
  > = {};

  networks.forEach((network) => {
    const defaultChain =
      Object.values(chains).find((c) => c.id === network.chainId) ??
      chains.mainnet;

    const client = createClient({
      transport: ponderTransport({ network, syncStore }),
      chain: { ...defaultChain, name: network.name, id: network.chainId },
    });

    contexts[network.chainId] = {
      network: { name: network.name, chainId: network.chainId },
      // Changing the arguments of readContract is not usually allowed,
      // because we have such a limited api we should be good
      client: client.extend(actions as any) as ReadOnlyClient,
      contracts: {},
    };
  });

  sources.forEach((source) => {
    // Only include the address if it's singular and  static.
    const address =
      typeof source.criteria.address === "string"
        ? source.criteria.address
        : undefined;

    contexts[source.chainId] = {
      ...contexts[source.chainId],
      contracts: {
        ...contexts[source.chainId].contracts,
        [source.contractName]: {
          abi: source.abi,
          address: address ? checksumAddress(address) : address,
          startBlock: source.startBlock,
          endBlock: source.endBlock,
          maxBlockRange: source.maxBlockRange,
        },
      },
    };
  });

  return contexts;
};

const getEventCheckpoint = (logEvent: LogEventTask): Checkpoint => {
  return {
    blockNumber: Number(logEvent.event.block.number),
    blockTimestamp: Number(logEvent.event.block.timestamp),
    chainId: logEvent.event.chainId,
    logIndex: logEvent.event.log.logIndex,
  };
};
