/* eslint-disable @typescript-eslint/ban-ts-comment */
import { AbiEvent } from "abitype";
import { E_CANCELED, Mutex } from "async-mutex";
import Emittery from "emittery";
import { encodeEventTopics, getAbiItem, Hex } from "viem";

import type { Contract } from "@/config/contracts";
import type { LogFilter } from "@/config/logFilters";
import { UserError } from "@/errors/user";
import type {
  EventAggregatorService,
  LogEvent,
} from "@/event-aggregator/service";
import type { EventStore } from "@/event-store/store";
import type { Resources } from "@/Ponder";
import type { Handlers } from "@/reload/readHandlers";
import type { Schema } from "@/schema/types";
import type { ReadOnlyContract } from "@/types/contract";
import type { Model } from "@/types/model";
import type { ModelInstance, UserStore } from "@/user-store/store";
import { prettyPrint } from "@/utils/print";
import { type Queue, type Worker, createQueue } from "@/utils/queue";

import { buildReadOnlyContracts } from "./contract";
import { buildModels } from "./model";
import { getStackTrace } from "./trace";

type EventHandlerEvents = {
  eventsProcessed: { toTimestamp: number };
};

type SetupTask = { kind: "SETUP" };
type LogEventTask = { kind: "LOG"; event: LogEvent };
type EventHandlerTask = SetupTask | LogEventTask;
type EventHandlerQueue = Queue<EventHandlerTask>;

export class EventHandlerService extends Emittery<EventHandlerEvents> {
  private resources: Resources;
  private userStore: UserStore;
  private eventAggregatorService: EventAggregatorService;
  private logFilters: LogFilter[];

  private readOnlyContracts: Record<string, ReadOnlyContract> = {};

  private schema?: Schema;
  private models: Record<string, Model<ModelInstance>> = {};

  private handlers?: Handlers;
  private handledLogFilters: Record<
    string,
    {
      eventName: string;
      topic0: Hex;
      abiItem: AbiEvent;
    }[]
  > = {};

  private eventProcessingMutex: Mutex;
  private queue?: EventHandlerQueue;

  private eventsProcessedToTimestamp = 0;
  private hasError = false;

  private currentEventBlockNumber = 0n;
  private currentEventTimestamp = 0;

  constructor({
    resources,
    eventStore,
    userStore,
    eventAggregatorService,
    contracts,
    logFilters,
  }: {
    resources: Resources;
    eventStore: EventStore;
    userStore: UserStore;
    eventAggregatorService: EventAggregatorService;
    contracts: Contract[];
    logFilters: LogFilter[];
  }) {
    super();
    this.resources = resources;
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

    this.resources.logger.debug({
      service: "handlers",
      msg: `Killed user handler service`,
    });
  };

  reset = async ({
    handlers: newHandlers,
    schema: newSchema,
  }: {
    handlers?: Handlers;
    schema?: Schema;
  } = {}) => {
    if (newSchema) {
      this.schema = newSchema;
      this.models = buildModels({
        userStore: this.userStore,
        schema: this.schema,
        getCurrentEventTimestamp: () => this.currentEventTimestamp,
      });
    }

    if (newHandlers) {
      this.handlers = newHandlers;
      this.handledLogFilters = {};

      // Get the set of events that the user has provided a handler for.
      this.logFilters.forEach((logFilter) => {
        const handledEventSignatureTopics = Object.keys(
          (this.handlers ?? {})[logFilter.name] ?? {}
        ).map((eventName) => {
          // TODO: Disambiguate overloaded ABI event signatures BEFORE getting here.
          const topics = encodeEventTopics({
            abi: logFilter.abi,
            eventName,
          });

          const abiItem = getAbiItem({
            abi: logFilter.abi,
            name: eventName,
          }) as AbiEvent;

          return { eventName, topic0: topics[0], abiItem };
        });

        this.handledLogFilters[logFilter.name] = handledEventSignatureTopics;
      });
    }

    // If either the schema or handlers have not been provided yet,
    // we're not ready to process events. Just return early.
    if (!this.schema || !this.handlers) return;

    // Cancel all pending calls to processEvents, reset the mutex, and create
    // a new queue using the latest available handlers and schema.
    this.eventProcessingMutex.cancel();
    this.eventProcessingMutex = new Mutex();
    this.queue = this.createEventQueue({ handlers: this.handlers });

    this.hasError = false;
    this.resources.metrics.ponder_handlers_has_error.set(0);

    this.resources.metrics.ponder_handlers_matched_events.reset();
    this.resources.metrics.ponder_handlers_handled_events.reset();
    this.resources.metrics.ponder_handlers_processed_events.reset();

    await this.userStore.reload({ schema: this.schema });
    this.resources.logger.debug({
      service: "handlers",
      msg: `Reset user store (versionId=${this.userStore.versionId})`,
    });

    // When we call userStore.reload() above, the user store is dropped.
    // Set the latest processed timestamp to zero accordingly.
    this.eventsProcessedToTimestamp = 0;
    this.resources.metrics.ponder_handlers_latest_processed_timestamp.set(0);

    await this.processEvents();
  };

  handleReorg = async ({
    commonAncestorTimestamp,
  }: {
    commonAncestorTimestamp: number;
  }) => {
    /**
     * This method is triggered by the realtime sync service detecting a reorg,
     * which can happen at any time. The event queue and the user store can be
     * in one of several different states that we need to keep in mind:
     *
     * 1) No events have been added to the queue yet.
     * 2) No unsafe events have been processed (eventsProcessedToTimestamp <= commonAncestorTimestamp).
     * 3) Unsafe events may have been processed (eventsProcessedToTimestamp > commonAncestorTimestamp).
     * 4) The queue has encountered a user error and is waiting for a reload.
     *
     * Note: It's crucial that we acquire a mutex lock while handling the reorg.
     * This will only ever run while the queue is idle, so we can be confident
     * that eventsProcessedToTimestamp matches the current state of the user store,
     * and that no unsafe events will get processed after handling the reorg.
     */

    try {
      await this.eventProcessingMutex.runExclusive(async () => {
        // If there is a user error, the queue & user store will be wiped on reload (case 4).
        if (this.hasError) return;

        if (this.eventsProcessedToTimestamp <= commonAncestorTimestamp) {
          // No unsafe events have been processed, so no need to revert (case 1 & case 2).
          this.resources.logger.debug({
            service: "handlers",
            msg: `No unsafe events were detected while reconciling a reorg, no-op`,
          });
        } else {
          // Unsafe events have been processed, must revert the user store and update
          // eventsProcessedToTimestamp accordingly (case 3).
          await this.userStore.revert({
            safeTimestamp: commonAncestorTimestamp,
          });

          this.eventsProcessedToTimestamp = commonAncestorTimestamp;
          this.resources.metrics.ponder_handlers_latest_processed_timestamp.set(
            commonAncestorTimestamp
          );

          // Note: There's currently no way to know how many events are "thrown out"
          // during the reorg reconciliation, so the event count metrics
          // (e.g. ponder_handlers_processed_events) will be slightly inflated.

          this.resources.logger.debug({
            service: "handlers",
            msg: `Reverted user store to safe timestamp ${commonAncestorTimestamp}`,
          });
        }
      });
    } catch (error) {
      // Pending locks get cancelled in reset(). This is expected, so it's safe to
      // ignore the error that is thrown when a pending lock is cancelled.
      if (error !== E_CANCELED) throw error;
    }

    await this.processEvents();
  };

  /**
   * Processes all newly available events.
   *
   * Acquires a lock on the event processing mutex, then gets the latest checkpoint
   * from the event aggregator service. Fetches events between previous checkpoint
   * and the new checkpoint, adds them to the queue, then processes them.
   *
   */
  processEvents = async () => {
    try {
      await this.eventProcessingMutex.runExclusive(async () => {
        if (this.hasError || !this.queue) return;

        const eventsAvailableTo = this.eventAggregatorService.checkpoint;

        // If we have already added events to the queue for the current checkpoint,
        // do nothing and return. This can happen if a number of calls to processEvents
        // "stack up" while one is being processed, and then they all run sequentially
        // but the event aggregator service checkpoint has not moved.
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

        const { events, totalEventCount } =
          await this.eventAggregatorService.getEvents({
            fromTimestamp,
            toTimestamp,
            handledLogFilters: this.handledLogFilters,
          });

        // TODO: Add the "eventName" label here by updating getEvents
        // implementation to return a count for each event name rather
        // than all lumped together.
        this.resources.metrics.ponder_handlers_matched_events.inc(
          totalEventCount
        );

        // If no events have been added yet, add the setup event.
        if (this.eventsProcessedToTimestamp === 0 && this.handlers?.setup) {
          this.queue.addTask({ kind: "SETUP" });
          this.resources.metrics.ponder_handlers_handled_events.inc({
            eventName: "setup",
          });
        }

        // Add new events to the queue.
        for (const event of events) {
          this.queue.addTask({
            kind: "LOG",
            event,
          });
          this.resources.metrics.ponder_handlers_handled_events.inc({
            eventName: `${event.logFilterName}:${event.eventName}`,
          });
        }

        // Process new events that were added to the queue.
        this.queue.start();
        await this.queue.onIdle();
        this.queue.pause();

        this.eventsProcessedToTimestamp = toTimestamp;

        this.emit("eventsProcessed", { toTimestamp });

        this.resources.metrics.ponder_handlers_latest_processed_timestamp.set(
          toTimestamp
        );

        if (events.length > 0) {
          this.resources.logger.info({
            service: "handlers",
            msg: `Processed ${
              events.length === 1 ? "1 event" : `${events.length} events`
            }`,
          });
        }
      });
    } catch (error) {
      // Pending locks get cancelled in reset(). This is expected, so it's safe to
      // ignore the error that is thrown when a pending lock is cancelled.
      if (error !== E_CANCELED) throw error;
    }
  };

  private createEventQueue = ({ handlers }: { handlers: Handlers }) => {
    const context = {
      contracts: this.readOnlyContracts,
      entities: this.models,
    };

    const eventHandlerWorker: Worker<EventHandlerTask> = async ({
      task,
      queue,
    }) => {
      switch (task.kind) {
        case "SETUP": {
          const setupHandler = handlers["setup"];
          if (!setupHandler) return;

          try {
            // Running user code here!
            await setupHandler({ context });

            this.resources.metrics.ponder_handlers_processed_events.inc({
              eventName: "setup",
            });
          } catch (error_) {
            // Remove all remaining tasks from the queue.
            queue.clear();

            this.hasError = true;
            this.resources.metrics.ponder_handlers_has_error.set(1);

            const error = error_ as Error;
            const trace = getStackTrace(error, this.resources.options);

            const message = `Error while handling "setup" event: ${error.message}`;

            const userError = new UserError(message, {
              stack: trace,
              cause: error,
            });

            this.resources.logger.error({
              service: "handlers",
              error: userError,
            });
            this.resources.errors.submitUserError({ error: userError });
          }

          break;
        }
        case "LOG": {
          const event = task.event;

          const handler = handlers[event.logFilterName]?.[event.eventName];
          if (!handler) return;

          // This enables contract calls occurring within the
          // handler code to use the event block number by default.
          this.currentEventBlockNumber = event.block.number;
          this.currentEventTimestamp = Number(event.block.timestamp);

          try {
            // Running user code here!
            await handler({
              event: {
                ...event,
                name: event.eventName,
              },
              context,
            });

            this.resources.metrics.ponder_handlers_processed_events.inc({
              eventName: `${event.logFilterName}:${event.eventName}`,
            });
          } catch (error_) {
            // Remove all remaining tasks from the queue.
            queue.clear();

            this.hasError = true;
            this.resources.metrics.ponder_handlers_has_error.set(1);

            const error = error_ as Error;
            const trace = getStackTrace(error, this.resources.options);

            const message = `Error while handling "${event.logFilterName}:${
              event.eventName
            }" event at block ${Number(event.block.number)}: ${error.message}`;

            const metaMessage = `Event params:\n${prettyPrint(event.params)}`;

            const userError = new UserError(message, {
              stack: trace,
              meta: metaMessage,
              cause: error,
            });

            this.resources.logger.error({
              service: "handlers",
              error: userError,
            });
            this.resources.errors.submitUserError({ error: userError });
          }

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
