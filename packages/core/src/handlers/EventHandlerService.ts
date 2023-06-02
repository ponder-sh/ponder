/* eslint-disable @typescript-eslint/ban-ts-comment */
import { E_CANCELED, Mutex } from "async-mutex";
import Emittery from "emittery";
import { encodeEventTopics } from "viem";

import type { Contract } from "@/config/contracts";
import { LogFilter } from "@/config/logFilters";
import { EventHandlerError } from "@/errors/eventHandler";
import type {
  EventAggregatorService,
  LogEvent,
} from "@/event-aggregator/service";
import type { EventStore } from "@/event-store/store";
import type { Resources } from "@/Ponder";
import type { Handlers } from "@/reload/readHandlers";
import type { Schema } from "@/schema/types";
import type { Model } from "@/types/model";
import { Prettify } from "@/types/utils";
import type { ModelInstance, UserStore } from "@/user-store/store";
import { createQueue, Queue, Worker } from "@/utils/queue";

import {
  type ReadOnlyContract,
  buildInjectedContract,
} from "./buildInjectedContract";
import { getStackTraceAndCodeFrame } from "./getStackTrace";

type EventHandlerEvents = {
  reset: undefined;
  eventsProcessed: { count: number; toTimestamp: number };
  taskCompleted: undefined;
};

type EventHandlerMetrics = {
  error: boolean;

  eventsAddedToQueue: number;
  eventsProcessedFromQueue: number;
  totalMatchedEvents: number;

  latestHandledEventTimestamp: number;
};

type SetupTask = { kind: "SETUP" };
type LogEventTask = {
  kind: "LOG";
  event: LogEvent;
};
type EventHandlerTask = SetupTask | LogEventTask;
type EventHandlerQueue = Queue<EventHandlerTask>;

export class EventHandlerService extends Emittery<EventHandlerEvents> {
  private resources: Resources;
  eventStore: EventStore;
  private userStore: UserStore;
  private eventAggregatorService: EventAggregatorService;

  private logFilters: LogFilter[];
  private contracts: Contract[];

  metrics: EventHandlerMetrics = {
    error: false,
    eventsAddedToQueue: 0,
    eventsProcessedFromQueue: 0,
    totalMatchedEvents: 0,
    latestHandledEventTimestamp: 0,
  };

  private handlers?: Handlers;
  private handledLogFilters: Prettify<
    Pick<LogFilter["filter"], "chainId" | "address" | "topics">
  >[] = [];

  private schema?: Schema;
  private queue?: EventHandlerQueue;

  private injectedContracts: Record<string, ReadOnlyContract | undefined> = {};

  isBackfillStarted = false;
  backfillCutoffTimestamp = Number.POSITIVE_INFINITY;

  private eventProcessingMutex: Mutex;
  private eventsHandledToTimestamp = 0;

  currentLogEventBlockNumber = 0n;

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
    this.eventStore = eventStore;
    this.userStore = userStore;
    this.eventAggregatorService = eventAggregatorService;
    this.contracts = contracts;
    this.logFilters = logFilters;

    // Build the injected contract objects. They depend only on contract config,
    // so they can't be hot reloaded.
    this.contracts.forEach((contract) => {
      this.injectedContracts[contract.name] = {};
      // buildInjectedContract({
      //   contract,
      //   eventHandlerService: this,
      // });
    });

    // Setup the event processing mutex.
    this.eventProcessingMutex = new Mutex();
  }

  killQueue = () => {
    this.queue?.clear();
  };

  reset = ({
    handlers: newHandlers,
    schema: newSchema,
  }: {
    handlers?: Handlers;
    schema?: Schema;
  } = {}) => {
    if (newSchema) {
      this.schema = newSchema;
    }

    if (newHandlers) {
      this.handlers = newHandlers;
      this.handledLogFilters = [];

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
          return topics[0];
        });

        if (handledEventSignatureTopics.length > 0) {
          this.handledLogFilters.push({
            chainId: logFilter.filter.chainId,
            address: logFilter.filter.address,
            topics: [handledEventSignatureTopics],
          });
        }
      });
    }

    if (!this.handlers || !this.schema) return;

    this.eventProcessingMutex.cancel();
    this.eventProcessingMutex = new Mutex();
    this.eventsHandledToTimestamp = 0;

    this.metrics = {
      error: false,
      eventsAddedToQueue: 0,
      eventsProcessedFromQueue: 0,
      totalMatchedEvents: 0,
      latestHandledEventTimestamp: 0,
    };

    this.queue = this.createEventQueue({
      handlers: this.handlers,
      schema: this.schema,
    });

    this.emit("reset");

    // If the setup handler is present, add the setup event.
    if (this.handlers.setup) {
      this.queue.addTask({ kind: "SETUP" });
    }

    if (this.eventAggregatorService.checkpoint > 0) {
      this.processEvents({
        toTimestamp: this.eventAggregatorService.checkpoint,
      });
    }
  };

  processEvents = async ({ toTimestamp }: { toTimestamp: number }) => {
    if (this.resources.errors.isHandlerError) return;

    try {
      await this.eventProcessingMutex.runExclusive(async () => {
        if (!this.queue) return;

        const { handledEvents, matchedEventCount } =
          await this.eventAggregatorService.getEvents({
            fromTimestamp: this.eventsHandledToTimestamp,
            toTimestamp,
            handledLogFilters: this.handledLogFilters,
          });

        this.metrics.eventsAddedToQueue += handledEvents.length;
        this.metrics.totalMatchedEvents += matchedEventCount;

        // Add new events to the queue.
        for (const event of handledEvents) {
          this.queue.addTask({
            kind: "LOG",
            event,
          });
        }

        // Process new events that were added to the queue.
        this.queue.start();
        await this.queue.onIdle();
        this.queue.pause();

        this.eventsHandledToTimestamp = toTimestamp;

        this.emit("eventsProcessed", {
          count: handledEvents.length,
          toTimestamp: toTimestamp,
        });
      });
    } catch (error) {
      // Pending locks get cancelled in resetEventQueue. This is expected, so it's safe to
      // ignore the error that is thrown when a pending lock is cancelled.
      if (error !== E_CANCELED) throw error;
    }
  };

  private createEventQueue = ({
    handlers,
    schema,
  }: {
    handlers: Handlers;
    schema: Schema;
  }) => {
    const context = this.buildContext({ schema });

    const eventHandlerWorker: Worker<EventHandlerTask> = async ({
      task,
      queue,
    }) => {
      switch (task.kind) {
        case "SETUP": {
          const setupHandler = handlers["setup"];
          if (!setupHandler) {
            return;
          }

          try {
            // Running user code here!
            await setupHandler({ context });
          } catch (error_) {
            // Remove all remaining tasks from the queue.
            queue.clear();

            const error = error_ as Error;
            const { stackTrace, codeFrame } = getStackTraceAndCodeFrame(
              error,
              this.resources.options
            );
            this.resources.errors.submitHandlerError({
              error: new EventHandlerError({
                eventName: "setup",
                stackTrace: stackTrace,
                codeFrame: codeFrame,
                cause: error,
              }),
            });
          }

          this.emit("taskCompleted");

          break;
        }
        case "LOG": {
          const event = task.event;

          const handler = handlers[event.logFilterName]?.[event.eventName];
          if (!handler) {
            return;
          }

          // This enables contract calls occurring within the
          // handler code to use the event block number by default.
          this.currentLogEventBlockNumber = event.block.number;

          try {
            // Running user code here!
            await handler({
              event: {
                ...event,
                name: event.eventName,
              },
              context,
            });
          } catch (error_) {
            // Remove all remaining tasks from the queue.
            queue.clear();

            this.metrics.error = true;

            const error = error_ as Error;
            const { stackTrace, codeFrame } = getStackTraceAndCodeFrame(
              error,
              this.resources.options
            );
            this.resources.errors.submitHandlerError({
              error: new EventHandlerError({
                stackTrace: stackTrace,
                codeFrame: codeFrame,
                cause: error,
                eventName: event.eventName,
                blockNumber: event.block.number,
                params: event.params,
              }),
            });
          }

          this.metrics.latestHandledEventTimestamp = Number(
            event.block.timestamp
          );

          this.emit("taskCompleted");

          break;
        }
      }

      this.metrics.eventsProcessedFromQueue += 1;
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

  private buildContext({ schema }: { schema: Schema }) {
    // Build entity models for event handler context.
    const models: Record<string, Model<ModelInstance>> = {};
    schema.entities.forEach((entity) => {
      const modelName = entity.name;

      models[modelName] = {
        findUnique: ({ id }) => this.userStore.findUnique({ modelName, id }),
        create: ({ id, data }) =>
          this.userStore.create({ modelName, id, data }),
        update: ({ id, data }) =>
          this.userStore.update({ modelName, id, data }),
        upsert: ({ id, create, update }) =>
          this.userStore.upsert({
            modelName,
            id,
            create,
            update,
          }),
        delete: ({ id }) => this.userStore.delete({ modelName, id }),
      };
    });

    return {
      contracts: this.injectedContracts,
      entities: models,
    };
  }
}
