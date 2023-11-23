import { E_CANCELED, Mutex } from "async-mutex";
import Emittery from "emittery";
import type { Abi, Address, Client, Hex } from "viem";
import { createClient, decodeEventLog } from "viem";

import type { IndexingFunctions } from "@/build/functions.js";
import type { Config } from "@/config/config.js";
import type { Source } from "@/config/sources.js";
import { UserError } from "@/errors/user.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import type { Common } from "@/Ponder.js";
import type { Schema } from "@/schema/types.js";
import type { SyncGateway } from "@/sync-gateway/service.js";
import type { SyncStore } from "@/sync-store/store.js";
import type { Block } from "@/types/block.js";
import type { Log } from "@/types/log.js";
import type { DatabaseModel } from "@/types/model.js";
import type { Transaction } from "@/types/transaction.js";
import { chains } from "@/utils/chains.js";
import { formatShortDate } from "@/utils/date.js";
import { prettyPrint } from "@/utils/print.js";
import { createQueue, type Queue, type Worker } from "@/utils/queue.js";
import { wait } from "@/utils/wait.js";

import { buildDatabaseModels } from "./model.js";
import { ponderActions, type ReadOnlyClient } from "./ponderActions.js";
import { getStackTrace } from "./trace.js";
import { ponderTransport } from "./transport.js";

type IndexingEvents = {
  eventsProcessed: { toTimestamp: number };
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
    chainId: number;
    networkName: string;
    contractName: string;
    blockNumber: bigint;
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

  private indexingFunctions?: IndexingFunctions;

  private eventProcessingMutex: Mutex;
  private queue?: IndexingFunctionQueue;

  private eventsProcessedToTimestamp = 0;
  private hasError = false;

  private currentEventBlockNumber = 0n;
  private currentEventTimestamp = 0;

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
    networks: Config["networks"];
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
      ponderActions(() => this.currentEventBlockNumber),
    );
  }

  kill = async () => {
    this.queue?.pause();
    this.queue?.clear();
    await this.queue?.onIdle();

    this.eventProcessingMutex.cancel();

    this.common.logger.debug({
      service: "indexing",
      msg: `Killed indexing service`,
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
  }: {
    indexingFunctions?: IndexingFunctions;
    schema?: Schema;
  } = {}) => {
    if (newSchema) {
      this.schema = newSchema;
      this.db = buildDatabaseModels({
        common: this.common,
        indexingStore: this.indexingStore,
        schema: this.schema,
        getCurrentEventTimestamp: () => this.currentEventTimestamp,
      });
    }

    if (newIndexingFunctions) {
      this.indexingFunctions = newIndexingFunctions;
    }

    // If either the schema or indexing functions have not been provided yet,
    // we're not ready to process events. Just return early.
    if (!this.schema || !this.indexingFunctions) return;

    // Cancel all pending calls to processEvents and reset the mutex.
    this.eventProcessingMutex.cancel();
    this.eventProcessingMutex = new Mutex();

    // Pause the old queue, (maybe) wait for the current indexing function to finish,
    // then create a new queue using the new indexing functions.
    this.queue?.clear();
    this.queue?.pause();
    await this.queue?.onIdle();
    this.queue = this.createEventQueue({
      indexingFunctions: this.indexingFunctions,
    });
    this.common.logger.debug({
      service: "indexing",
      msg: `Paused event queue`,
    });

    this.hasError = false;
    this.common.metrics.ponder_indexing_has_error.set(0);

    this.common.metrics.ponder_indexing_matched_events.reset();
    this.common.metrics.ponder_indexing_handled_events.reset();
    this.common.metrics.ponder_indexing_processed_events.reset();

    await this.indexingStore.reload({ schema: this.schema });
    this.common.logger.debug({
      service: "indexing",
      msg: `Reset indexing store`,
    });

    // When we call indexingStore.reload() above, the indexing store is dropped.
    // Set the latest processed timestamp to zero accordingly.
    this.eventsProcessedToTimestamp = 0;
    this.common.metrics.ponder_indexing_latest_processed_timestamp.set(0);
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
  handleReorg = async ({
    commonAncestorTimestamp,
  }: {
    commonAncestorTimestamp: number;
  }) => {
    try {
      await this.eventProcessingMutex.runExclusive(async () => {
        // If there is a user error, the queue & indexing store will be wiped on reload (case 4).
        if (this.hasError) return;

        if (this.eventsProcessedToTimestamp <= commonAncestorTimestamp) {
          // No unsafe events have been processed, so no need to revert (case 1 & case 2).
          this.common.logger.debug({
            service: "indexing",
            msg: `No unsafe events were detected while reconciling a reorg, no-op`,
          });
        } else {
          // Unsafe events have been processed, must revert the indexing store and update
          // eventsProcessedToTimestamp accordingly (case 3).
          await this.indexingStore.revert({
            safeTimestamp: commonAncestorTimestamp,
          });

          this.eventsProcessedToTimestamp = commonAncestorTimestamp;
          this.common.metrics.ponder_indexing_latest_processed_timestamp.set(
            commonAncestorTimestamp,
          );

          // Note: There's currently no way to know how many events are "thrown out"
          // during the reorg reconciliation, so the event count metrics
          // (e.g. ponder_indexing_processed_events) will be slightly inflated.

          this.common.logger.debug({
            service: "indexing",
            msg: `Reverted indexing store to safe timestamp ${commonAncestorTimestamp}`,
          });
        }
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
    try {
      await this.eventProcessingMutex.runExclusive(async () => {
        if (this.hasError || !this.queue) return;

        const eventsAvailableTo = this.syncGatewayService.checkpoint;

        // If we have already added events to the queue for the current checkpoint,
        // do nothing and return. This can happen if a number of calls to processEvents
        // "stack up" while one is being processed, and then they all run sequentially
        // but the sync gateway service checkpoint has not moved.
        if (this.eventsProcessedToTimestamp >= eventsAvailableTo) {
          return;
        }

        // The getEvents method is inclusive on both sides, so we need to add 1 here
        // to avoid fetching the same event twice.
        const fromTimestamp =
          this.eventsProcessedToTimestamp === 0
            ? 0
            : this.eventsProcessedToTimestamp + 1;

        const toTimestamp = eventsAvailableTo;

        // If no events have been added yet, add the setup events for each chain & associated metrics.
        if (this.eventsProcessedToTimestamp === 0 && this.indexingFunctions) {
          for (const [sourceName, events] of Object.entries(
            this.indexingFunctions,
          )) {
            if (Object.keys(events).some((e) => e === "setup")) {
              // Get all chains that have the contract "sourceName"
              Object.values(this.contexts).forEach(({ contracts, network }) => {
                if (contracts[sourceName] === undefined) return;

                const labels = {
                  network: network.name,
                  contract: sourceName,
                  event: "setup",
                };

                this.common.metrics.ponder_indexing_matched_events.inc(labels);
                this.queue?.addTask({
                  kind: "SETUP",
                  event: {
                    chainId: network.chainId,
                    contractName: sourceName,
                    blockNumber: BigInt(contracts[sourceName].startBlock),
                    networkName: network.name,
                  },
                });
                this.common.metrics.ponder_indexing_handled_events.inc(labels);
              });
            }
          }
        }

        const sourcesById: { [sourceId: string]: Source } = {};
        const registeredSelectorsBySourceId: { [sourceId: string]: Hex[] } = {};

        for (const source of this.sources) {
          sourcesById[source.id] = source;
          registeredSelectorsBySourceId[source.id] = Object.keys(
            this.indexingFunctions![source.contractName],
          )
            .filter((name) => name !== "setup")
            .map((safeEventName) => {
              const abiItemMeta = source.events.bySafeName[safeEventName];
              if (!abiItemMeta)
                throw new Error(
                  `Invariant violation: No abiItemMeta found for ${source.contractName}:${safeEventName}`,
                );
              return abiItemMeta.selector;
            });
        }

        const iterator = this.syncGatewayService.getEvents({
          fromTimestamp,
          toTimestamp,
          includeEventSelectors: registeredSelectorsBySourceId,
        });

        let pageIndex = 0;

        for await (const page of iterator) {
          const { events, metadata } = page;

          // Increment the metrics for the total number of matching & indexed events in this timestamp range.
          // The metadata comes with every page, but is the same for all pages, so do this on the first page.
          if (pageIndex === 0) {
            metadata.counts.forEach(({ sourceId, selector, count }) => {
              const source = sourcesById[sourceId];
              if (!source)
                throw new Error(
                  `Invariant violation: Source ID not found ${sourceId}`,
                );
              const abiItemMeta = source.events.bySelector[selector];

              // This means that the contract has emitted events that are not present in the ABI
              // that the user has provided. Use the raw selector as the event name for the metric.
              if (!abiItemMeta) {
                const labels = {
                  network: source.networkName,
                  contract: source.contractName,
                  event: selector,
                };
                this.common.metrics.ponder_indexing_matched_events.inc(
                  labels,
                  count,
                );
                return;
              }

              const labels = {
                network: source.networkName,
                contract: source.contractName,
                event: abiItemMeta.safeName,
              };
              this.common.metrics.ponder_indexing_matched_events.inc(
                labels,
                count,
              );
              const isRegistered =
                registeredSelectorsBySourceId[sourceId].includes(selector);
              if (isRegistered) {
                this.common.metrics.ponder_indexing_handled_events.inc(
                  labels,
                  count,
                );
              }
            });
          }

          // Decode events, dropping any that cannot be decoded using the provided ABI item.
          const decodedEvents = events.reduce<LogEvent[]>((acc, event) => {
            const selector = event.log.topics[0];
            // Should always have a selector because of the includeEventSelectors pattern.
            if (!selector)
              throw new Error(
                `Invariant violation: Log is missing topics ${event.log.id}`,
              );
            const source = sourcesById[event.sourceId];
            if (!source)
              throw new Error(
                `Invariant violation: Source ID not found ${event.sourceId}`,
              );
            const abiItemMeta = source.events.bySelector[selector];
            if (!abiItemMeta)
              throw new Error(
                `Invariant violation: No abiItemMeta found for ${source.contractName}:${selector}`,
              );

            try {
              const decodedLog = decodeEventLog({
                abi: [abiItemMeta.item],
                data: event.log.data,
                topics: event.log.topics,
              });

              acc.push({
                networkName: source.networkName,
                contractName: source.contractName,
                eventName: abiItemMeta.safeName,
                chainId: event.chainId,
                args: decodedLog.args ?? {},
                log: event.log,
                block: event.block,
                transaction: event.transaction,
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

            return acc;
          }, []);

          // Add new events to the queue.
          for (const event of decodedEvents) {
            this.queue.addTask({
              kind: "LOG",
              event,
            });
          }

          // Process new events that were added to the queue.
          this.queue.start();
          await this.queue.onIdle();

          // If the queue is already paused here, it means that reset() was called, interrupting
          // event processing. When this happens, we want to return early.
          if (this.queue.isPaused) return;

          this.queue.pause();

          if (events.length > 0) {
            this.common.logger.info({
              service: "indexing",
              msg: `Processed ${
                events.length === 1 ? "1 event" : `${events.length} events`
              } (up to ${formatShortDate(metadata.pageEndsAtTimestamp)})`,
            });
          }

          pageIndex += 1;
        }

        this.emit("eventsProcessed", { toTimestamp });
        this.eventsProcessedToTimestamp = toTimestamp;

        // Note that this happens both here and in the log event indexing function.
        // They must also happen here to handle the case where no events were processed.
        this.common.metrics.ponder_indexing_latest_processed_timestamp.set(
          toTimestamp,
        );
      });
    } catch (error) {
      // Pending locks get cancelled in reset(). This is expected, so it's safe to
      // ignore the error that is thrown when a pending lock is cancelled.
      if (error !== E_CANCELED) throw error;
    }
  };

  private createEventQueue = ({
    indexingFunctions,
  }: {
    indexingFunctions: IndexingFunctions;
  }) => {
    const indexingFunctionWorker: Worker<IndexingFunctionTask> = async ({
      task,
      queue,
    }) => {
      // This is a hack to ensure that the eventsProcessed method is called and updates
      // the UI when using SQLite. It also allows the process to GC and handle SIGINT events.
      // It does, however, slow down event processing a bit.
      await wait(0);

      switch (task.kind) {
        case "SETUP": {
          const event = task.event;

          const fullEventName = `${event.contractName}:setup`;

          const indexingFunction =
            indexingFunctions?.[event.contractName]?.["setup"];
          if (!indexingFunction)
            throw new Error(
              `Internal: Indexing function not found for ${fullEventName}`,
            );

          // This enables contract calls occurring within the
          // user code to use the start block number by default.
          this.currentEventBlockNumber = event.blockNumber;

          try {
            this.common.logger.trace({
              service: "indexing",
              msg: `Started indexing function (event="${fullEventName}", block=${event.blockNumber})`,
            });

            // Running user code here!
            await indexingFunction({
              context: { db: this.db, ...this.contexts[event.chainId] },
            });

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
          } catch (error_) {
            // Remove all remaining tasks from the queue.
            queue.clear();

            this.hasError = true;
            this.common.metrics.ponder_indexing_has_error.set(1);

            this.common.logger.trace({
              service: "indexing",
              msg: `Failed while running indexing function (event="setup")`,
            });

            const error = error_ as Error;
            const trace = getStackTrace(error, this.common.options);

            const message = `Error while processing "setup" event: ${error.message}`;

            const userError = new UserError(message, {
              stack: trace,
              cause: error,
            });

            this.common.logger.error({
              service: "indexing",
              error: userError,
            });
            this.common.errors.submitUserError({ error: userError });
          }

          break;
        }
        case "LOG": {
          const event = task.event;

          const fullEventName = `${event.contractName}:${event.eventName}`;

          const indexingFunction =
            indexingFunctions?.[event.contractName]?.[event.eventName];
          if (!indexingFunction)
            throw new Error(
              `Internal: Indexing function not found for ${fullEventName}`,
            );

          // This enables contract calls occurring within the
          // user code to use the event block number by default.
          this.currentEventBlockNumber = event.block.number;
          this.currentEventTimestamp = Number(event.block.timestamp);

          try {
            this.common.logger.trace({
              service: "indexing",
              msg: `Started indexing function (event="${fullEventName}", block=${event.block.number})`,
            });

            // Running user code here!
            await indexingFunction({
              event: {
                name: event.eventName,
                args: event.args,
                log: event.log,
                transaction: event.transaction,
                block: event.block,
              },
              context: { db: this.db, ...this.contexts[event.chainId] },
            });

            this.common.logger.trace({
              service: "indexing",
              msg: `Completed indexing function (event="${fullEventName}", block=${event.block.number})`,
            });
          } catch (error_) {
            // Remove all remaining tasks from the queue.
            queue.clear();

            this.hasError = true;
            this.common.metrics.ponder_indexing_has_error.set(1);

            this.common.logger.trace({
              service: "indexing",
              msg: `Failed while running indexing function (event="${fullEventName}", block=${event.block.number})`,
            });

            const error = error_ as Error;
            const trace = getStackTrace(error, this.common.options);

            const message = `Error while processing "${fullEventName}" event at block ${Number(
              event.block.number,
            )}: ${error.message}`;

            const metaMessage = `Event args:\n${prettyPrint(event.args)}`;

            const userError = new UserError(message, {
              stack: trace,
              meta: metaMessage,
              cause: error,
            });

            this.common.logger.error({
              service: "indexing",
              error: userError,
            });
            this.common.errors.submitUserError({ error: userError });
          }

          const labels = {
            network: event.networkName,
            contract: event.contractName,
            event: event.eventName,
          };
          this.common.metrics.ponder_indexing_processed_events.inc(labels);
          this.common.metrics.ponder_indexing_latest_processed_timestamp.set(
            this.currentEventTimestamp,
          );

          break;
        }
      }
    };

    const queue = createQueue({
      worker: indexingFunctionWorker,
      context: undefined,
      options: {
        concurrency: 1,
        autoStart: false,
      },
    });

    return queue;
  };
}

const buildContexts = (
  sources: Source[],
  networks: Config["networks"],
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

  Object.entries(networks).forEach(([networkName, network]) => {
    const defaultChain =
      Object.values(chains).find((c) => c.id === network.chainId) ??
      chains.mainnet;

    const client = createClient({
      transport: ponderTransport({ transport: network.transport, syncStore }),
      chain: { ...defaultChain, name: networkName, id: network.chainId },
    });

    contexts[network.chainId] = {
      network: { name: networkName, chainId: network.chainId },
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
          address,
          startBlock: source.startBlock,
          endBlock: source.endBlock,
          maxBlockRange: source.maxBlockRange,
        },
      },
    };
  });

  return contexts;
};
