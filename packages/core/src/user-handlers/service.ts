import { E_CANCELED, Mutex } from "async-mutex";
import Emittery from "emittery";

import type { HandlerFunctions } from "@/build/handlers";
import type { Contract } from "@/config/contracts";
import type { LogEventMetadata, LogFilter } from "@/config/logFilters";
import { UserError } from "@/errors/user";
import type {
  EventAggregatorService,
  LogEvent,
} from "@/event-aggregator/service";
import type { EventStore } from "@/event-store/store";
import type { Common } from "@/Ponder";
import type { Schema } from "@/schema/types";
import type { ReadOnlyContract } from "@/types/contract";
import type { Model } from "@/types/model";
import type { ModelInstance, UserStore } from "@/user-store/store";
import { prettyPrint } from "@/utils/print";
import { type Queue, type Worker, createQueue } from "@/utils/queue";
import { wait } from "@/utils/wait";

import { buildReadOnlyContracts } from "./contract";
import { buildModels } from "./model";
import { getStackTrace } from "./trace";

type SetupTask = { kind: "SETUP" };
type LogEventTask = { kind: "LOG"; event: LogEvent };
type EventHandlerTask = SetupTask | LogEventTask;
type EventHandlerQueue = Queue<EventHandlerTask>;

type EventHandlerEvents = {
  /**
   * Emitted when all historical events have been processed.
   */
  historicalEventProcessingCompleted: undefined;
};

export class EventHandlerService extends Emittery<EventHandlerEvents> {
  private common: Common;
  private userStore: UserStore;
  private eventAggregatorService: EventAggregatorService;
  private logFilters: LogFilter[];

  private readOnlyContracts: Record<string, ReadOnlyContract> = {};

  private schema?: Schema;
  private models: Record<string, Model<ModelInstance>> = {};

  private handlers?: HandlerFunctions;
  private includeLogFilterEvents: HandlerFunctions["logFilters"] = {};

  private eventProcessingMutex: Mutex;
  private queue?: EventHandlerQueue;

  private eventsProcessedToBlockNumber = 0;
  private currentEventBlockNumber = 0;
  private isHistoricalEventProcessingCompleted = false;
  private hasError = false;

  constructor({
    common,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  }: {
    common: Common;
    eventStore: EventStore;
    userStore: UserStore;
    eventAggregatorService: EventAggregatorService;
    contracts: Contract[];
    logFilters: LogFilter[];
  }) {
    super();
    this.common = common;
    this.userStore = userStore;
    this.eventAggregatorService = eventAggregatorService;
    this.logFilters = logFilters;

    // The read-only contract objects only depend on config, so they can
    // be built in the constructor (they can't be hot-reloaded).
    this.readOnlyContracts = buildReadOnlyContracts({
      contracts,
      getCurrentBlockNumber: () => this.currentEventBlockNumber,
      eventStore,
    });

    this.eventProcessingMutex = new Mutex();
  }

  kill = () => {
    this.queue?.clear();
    this.eventProcessingMutex.cancel();

    this.common.logger.debug({
      service: "handlers",
      msg: `Killed user handler service`,
    });
  };

  /**
   * Registers a new set of handler functions and/or a new schema, cancels
   * the current event processing mutex & event queue, drops and re-creates
   * all tables from the user store, and resets eventsProcessedToTimestamp to zero.
   *
   * Note: Caller should (probably) immediately call processEvents after this method.
   */
  reset = async ({
    handlers: newHandlers,
    schema: newSchema,
  }: {
    handlers?: HandlerFunctions;
    schema?: Schema;
  } = {}) => {
    if (newSchema) {
      this.schema = newSchema;
      this.models = buildModels({
        common: this.common,
        userStore: this.userStore,
        schema: this.schema,
        getCurrentBlockNumber: () => this.currentEventBlockNumber,
      });
    }

    if (newHandlers) {
      this.handlers = newHandlers;
      this.includeLogFilterEvents = this.handlers.logFilters;
    }

    // If either the schema or handlers have not been provided yet,
    // we're not ready to process events. Just return early.
    if (!this.schema || !this.handlers) return;

    // Cancel all pending calls to processEvents and reset the mutex.
    this.eventProcessingMutex.cancel();
    this.eventProcessingMutex = new Mutex();

    // Pause the old queue, (maybe) wait for the current event handler to finish,
    // then create a new queue using the new handlers.
    this.queue?.clear();
    this.queue?.pause();
    await this.queue?.onIdle();
    this.queue = this.createEventQueue({ handlers: this.handlers });
    this.common.logger.debug({
      service: "handlers",
      msg: `Paused event queue (versionId=${this.userStore.versionId})`,
    });

    this.hasError = false;
    this.common.metrics.ponder_handlers_has_error.set(0);

    this.common.metrics.ponder_handlers_matched_events.reset();
    this.common.metrics.ponder_handlers_handled_events.reset();
    this.common.metrics.ponder_handlers_processed_events.reset();

    await this.userStore.reload({ schema: this.schema });
    this.common.logger.debug({
      service: "handlers",
      msg: `Reset user store (versionId=${this.userStore.versionId})`,
    });

    // When we call userStore.reload() above, the user store is dropped.
    // Set the latest processed block number to zero accordingly.
    this.eventsProcessedToBlockNumber = 0;
    this.common.metrics.ponder_handlers_latest_processed_block_number.set(0);
  };

  /**
   * This method is triggered when the realtime sync service detects a reorg,
   * which can happen at any time. The event queue and the user store can be
   * in one of several different states that we need to keep in mind:
   *
   * 1) No events have been added to the queue yet.
   * 2) No unsafe events have been processed (eventsProcessedToBlockNumber <= commonAncestorBlockNumber).
   * 3) Unsafe events may have been processed (eventsProcessedToBlockNumber > commonAncestorBlockNumber).
   * 4) The queue has encountered a user error and is waiting for a reload.
   *
   * Note: It's crucial that we acquire a mutex lock while handling the reorg.
   * This will only ever run while the queue is idle, so we can be confident
   * that eventsProcessedToBlockNumber matches the current state of the user store,
   * and that no unsafe events will get processed after handling the reorg.
   *
   * Note: Caller should (probably) immediately call processEvents after this method.
   */
  handleReorg = async ({
    commonAncestorBlockNumber,
  }: {
    commonAncestorBlockNumber: number;
  }) => {
    try {
      await this.eventProcessingMutex.runExclusive(async () => {
        // If there is a user error, the queue & user store will be wiped on reload (case 4).
        if (this.hasError) return;

        if (this.eventsProcessedToBlockNumber <= commonAncestorBlockNumber) {
          // No unsafe events have been processed, so no need to revert (case 1 & case 2).
          this.common.logger.debug({
            service: "handlers",
            msg: `No unsafe events were detected while reconciling a reorg, no-op`,
          });
        } else {
          // Unsafe events have been processed, must revert the user store and update
          // eventsProcessedToTimestamp accordingly (case 3).
          await this.userStore.revert({
            safeBlockNumber: commonAncestorBlockNumber,
          });

          this.eventsProcessedToBlockNumber = commonAncestorBlockNumber;
          this.common.metrics.ponder_handlers_latest_processed_block_number.set(
            commonAncestorBlockNumber
          );

          // Note: There's currently no way to know how many events are "thrown out"
          // during the reorg reconciliation, so the event count metrics
          // (e.g. ponder_handlers_processed_events) will be slightly inflated.
          // This could potentially be returned by the UserStore.revert method.

          this.common.logger.debug({
            service: "handlers",
            msg: `Reverted user store to common ancestor block ${commonAncestorBlockNumber}`,
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
   * from the event aggregator service. Fetches events between previous checkpoint
   * and the new checkpoint, adds them to the queue, then processes them.
   */
  processEvents = async () => {
    try {
      await this.eventProcessingMutex.runExclusive(async () => {
        if (this.hasError || !this.queue) return;

        const eventsAvailableToBlockNumber =
          this.eventAggregatorService.checkpoint;

        // If we have already added events to the queue for the current checkpoint,
        // do nothing and return. This can happen if a number of calls to processEvents
        // "stack up" while one is being processed, and then they all run sequentially
        // but the event aggregator service checkpoint has not moved.
        if (this.eventsProcessedToBlockNumber >= eventsAvailableToBlockNumber) {
          return;
        }

        // The getEvents method is inclusive on both sides, so we need to add 1 here
        // to avoid fetching the same event twice.
        const fromBlockNumber =
          this.eventsProcessedToBlockNumber === 0
            ? 0
            : this.eventsProcessedToBlockNumber + 1;

        const toBlockNumber = eventsAvailableToBlockNumber;

        // If no events have been added yet, add the setup event & associated metrics.
        if (this.eventsProcessedToBlockNumber === 0) {
          this.common.metrics.ponder_handlers_matched_events.inc({
            eventName: "setup",
          });
          if (this.handlers?._meta_.setup) {
            this.queue.addTask({ kind: "SETUP" });
            this.common.metrics.ponder_handlers_handled_events.inc({
              eventName: "setup",
            });
          }
        }

        const iterator = this.eventAggregatorService.getEvents({
          fromBlockNumber,
          toBlockNumber,
          includeLogFilterEvents: this.includeLogFilterEvents,
        });

        let pageIndex = 0;

        for await (const page of iterator) {
          const { events, counts, pageEndsAtBlockNumber } = page;

          // Increment the metrics for the total number of matching & handled events in this timestamp range.
          if (pageIndex === 0) {
            counts.forEach(({ logFilterName, selector, count }) => {
              const safeName = Object.values(
                this.logFilters.find((lf) => lf.name === logFilterName)
                  ?.events || {}
              )
                .filter((m): m is LogEventMetadata => !!m)
                .find((m) => m.selector === selector)?.safeName;
              if (!safeName) return;

              const isHandled =
                !!this.handlers?.logFilters[logFilterName]?.bySelector?.[
                  selector
                ];

              this.common.metrics.ponder_handlers_matched_events.inc(
                { eventName: `${logFilterName}:${safeName}` },
                count
              );
              if (isHandled) {
                this.common.metrics.ponder_handlers_handled_events.inc(
                  { eventName: `${logFilterName}:${safeName}` },
                  count
                );
              }
            });
          }

          // Add new events to the queue.
          for (const event of events) {
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
              service: "handlers",
              msg: `Processed ${
                events.length === 1 ? "1 event" : `${events.length} events`
              } (up to ${pageEndsAtBlockNumber})`,
            });
          }

          pageIndex += 1;
        }

        this.eventsProcessedToBlockNumber = toBlockNumber;

        // Note that this happens both here and in the log event handler function.
        // Must happen here to handle the case where no events were processed.
        this.common.metrics.ponder_handlers_latest_processed_block_number.set(
          toBlockNumber
        );

        // If all historical events have now been processed, emit the event.
        if (
          !this.isHistoricalEventProcessingCompleted &&
          this.eventAggregatorService.isHistoricalSyncComplete &&
          this.eventsProcessedToBlockNumber >=
            this.eventAggregatorService.historicalSyncFinalBlockNumber!
        ) {
          this.emit("historicalEventProcessingCompleted");
          this.isHistoricalEventProcessingCompleted = true;
        }
      });
    } catch (error) {
      // Pending locks get cancelled in reset(). This is expected, so it's safe to
      // ignore the error that is thrown when a pending lock is cancelled.
      if (error !== E_CANCELED) throw error;
    }
  };

  private createEventQueue = ({ handlers }: { handlers: HandlerFunctions }) => {
    const context = {
      contracts: this.readOnlyContracts,
      entities: this.models,
    };

    const eventHandlerWorker: Worker<EventHandlerTask> = async ({
      task,
      queue,
    }) => {
      // This is a hack to ensure that the eventsProcessed handler is called and updates
      // the UI when using SQLite. It also allows the process to GC and handle SIGINT events.
      // It does, however, slow down event processing a bit.
      await wait(0);

      switch (task.kind) {
        case "SETUP": {
          const setupHandler = handlers._meta_.setup?.fn;
          if (!setupHandler) return;

          try {
            this.common.logger.trace({
              service: "handlers",
              msg: `Started handler (event="setup")`,
            });

            // Running user code here!
            await setupHandler({ context });

            this.common.logger.trace({
              service: "handlers",
              msg: `Completed handler (event="setup")`,
            });

            this.common.metrics.ponder_handlers_processed_events.inc({
              eventName: "setup",
            });
          } catch (error_) {
            // Remove all remaining tasks from the queue.
            queue.clear();

            this.hasError = true;
            this.common.metrics.ponder_handlers_has_error.set(1);

            this.common.logger.trace({
              service: "handlers",
              msg: `Failed while running handler (event="setup")`,
            });

            const error = error_ as Error;
            const trace = getStackTrace(error, this.common.options);

            const message = `Error while handling "setup" event: ${error.message}`;

            const userError = new UserError(message, {
              stack: trace,
              cause: error,
            });

            this.common.logger.error({
              service: "handlers",
              error: userError,
            });
            this.common.errors.submitUserError({ error: userError });
          }

          break;
        }
        case "LOG": {
          const event = task.event;

          const handlerData =
            this.handlers?.logFilters[event.logFilterName].bySafeName[
              event.eventName
            ];
          if (!handlerData)
            throw new Error(
              `Internal: Handler not found for log from log filter ${event.logFilterName}`
            );

          // This enables contract calls occurring within the
          // handler code to use the event block number by default.
          this.currentEventBlockNumber = Number(event.block.number);

          try {
            this.common.logger.trace({
              service: "handlers",
              msg: `Started handler (event="${event.logFilterName}:${event.eventName}", block=${event.block.number})`,
            });

            // Running user code here!
            await handlerData.fn({
              event: {
                ...event,
                name: event.eventName,
              },
              context,
            });

            this.common.logger.trace({
              service: "handlers",
              msg: `Completed handler (event="${event.logFilterName}:${event.eventName}", block=${event.block.number})`,
            });
          } catch (error_) {
            // Remove all remaining tasks from the queue.
            queue.clear();

            this.hasError = true;
            this.common.metrics.ponder_handlers_has_error.set(1);

            this.common.logger.trace({
              service: "handlers",
              msg: `Failed while running handler (event="${event.logFilterName}:${event.eventName}", block=${event.block.number})`,
            });

            const error = error_ as Error;
            const trace = getStackTrace(error, this.common.options);

            const message = `Error while handling "${event.logFilterName}:${
              event.eventName
            }" event at block ${Number(event.block.number)}: ${error.message}`;

            const metaMessage = `Event params:\n${prettyPrint(event.params)}`;

            const userError = new UserError(message, {
              stack: trace,
              meta: metaMessage,
              cause: error,
            });

            this.common.logger.error({
              service: "handlers",
              error: userError,
            });
            this.common.errors.submitUserError({ error: userError });
          }

          this.common.metrics.ponder_handlers_processed_events.inc({
            eventName: `${event.logFilterName}:${event.eventName}`,
          });
          this.common.metrics.ponder_handlers_latest_processed_block_number.set(
            this.currentEventBlockNumber
          );

          break;
        }
      }
    };

    const queue = createQueue({
      worker: eventHandlerWorker,
      context: undefined,
      options: {
        concurrency: 1,
        autoStart: false,
      },
    });

    return queue;
  };
}
