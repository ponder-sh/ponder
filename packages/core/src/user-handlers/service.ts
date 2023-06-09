/* eslint-disable @typescript-eslint/ban-ts-comment */
import { AbiEvent } from "abitype";
import { E_CANCELED, Mutex } from "async-mutex";
import Emittery from "emittery";
import { encodeEventTopics, getAbiItem, Hex } from "viem";

import type { Contract } from "@/config/contracts";
import type { LogFilter } from "@/config/logFilters";
import { EventHandlerError } from "@/errors/eventHandler";
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
import { type Queue, type Worker, createQueue } from "@/utils/queue";

import { getInjectedContract } from "./contract";
import { getStackTraceAndCodeFrame } from "./trace";

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
  private userStore: UserStore;
  private eventAggregatorService: EventAggregatorService;
  private logFilters: LogFilter[];

  metrics: EventHandlerMetrics = {
    error: false,
    eventsAddedToQueue: 0,
    eventsProcessedFromQueue: 0,
    totalMatchedEvents: 0,
    latestHandledEventTimestamp: 0,
  };

  private handlers?: Handlers;
  private handledLogFilters: Record<
    string,
    {
      eventName: string;
      topic0: Hex;
      abiItem: AbiEvent;
    }[]
  > = {};

  private schema?: Schema;
  private queue?: EventHandlerQueue;

  private injectedContracts: Record<string, ReadOnlyContract> = {};

  private eventProcessingMutex: Mutex;
  private eventsHandledToTimestamp = 0;

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

    // Build the injected contract objects. They depend only on contract config,
    // so they can't be hot reloaded.
    contracts.forEach((contract) => {
      this.injectedContracts[contract.name] = getInjectedContract({
        contract,
        getCurrentBlockNumber: () => this.currentEventBlockNumber,
        eventStore,
      });
    });

    // Setup the event processing mutex.
    this.eventProcessingMutex = new Mutex();
  }

  kill = () => {
    this.queue?.clear();
    this.eventProcessingMutex.cancel();
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

    this.resetEventQueue();

    await this.userStore.reload({ schema: this.schema });
    this.eventsHandledToTimestamp = 0;
    this.metrics.latestHandledEventTimestamp = 0;

    await this.processEvents({
      toTimestamp: this.eventAggregatorService.checkpoint,
    });
  };

  handleReorg = async ({
    commonAncestorTimestamp,
  }: {
    commonAncestorTimestamp: number;
  }) => {
    this.resetEventQueue();

    await this.userStore.revert({ safeTimestamp: commonAncestorTimestamp });
    this.eventsHandledToTimestamp = commonAncestorTimestamp;
    this.metrics.latestHandledEventTimestamp = commonAncestorTimestamp;

    await this.processEvents({
      toTimestamp: this.eventAggregatorService.checkpoint,
    });
  };

  processEvents = async ({ toTimestamp }: { toTimestamp: number }) => {
    if (this.resources.errors.isHandlerError) return;
    if (toTimestamp === 0) return;

    try {
      await this.eventProcessingMutex.runExclusive(async () => {
        if (!this.queue) return;

        const { events, totalEventCount } =
          await this.eventAggregatorService.getEvents({
            fromTimestamp: this.eventsHandledToTimestamp,
            toTimestamp,
            handledLogFilters: this.handledLogFilters,
          });

        this.metrics.eventsAddedToQueue += events.length;
        this.metrics.totalMatchedEvents += totalEventCount;

        // If no events have been handled, add the setup event
        if (this.eventsHandledToTimestamp === 0 && this.handlers?.setup) {
          this.queue.addTask({ kind: "SETUP" });
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
        this.queue.pause();

        this.eventsHandledToTimestamp = toTimestamp;

        this.emit("eventsProcessed", {
          count: events.length,
          toTimestamp: toTimestamp,
        });
      });
    } catch (error) {
      // Pending locks get cancelled in resetEventQueue. This is expected, so it's safe to
      // ignore the error that is thrown when a pending lock is cancelled.
      if (error !== E_CANCELED) throw error;
    }
  };

  private resetEventQueue = () => {
    if (!this.handlers || !this.schema) return;

    this.eventProcessingMutex.cancel();
    this.eventProcessingMutex = new Mutex();

    this.metrics = {
      ...this.metrics,
      error: false,
      eventsAddedToQueue: 0,
      eventsProcessedFromQueue: 0,
      totalMatchedEvents: 0,
    };

    this.queue = this.createEventQueue({
      handlers: this.handlers,
      schema: this.schema,
    });

    this.emit("reset");
  };

  private createEventQueue = ({
    handlers,
    schema,
  }: {
    handlers: Handlers;
    schema: Schema;
  }) => {
    // Build entity models for event handler context.
    const models = schema.entities.reduce<Record<string, Model<ModelInstance>>>(
      (acc, { name: modelName }) => {
        acc[modelName] = {
          findUnique: ({ id }) => {
            return this.userStore.findUnique({
              modelName,
              timestamp: this.currentEventTimestamp,
              id,
            });
          },
          create: ({ id, data }) => {
            return this.userStore.create({
              modelName,
              timestamp: this.currentEventTimestamp,
              id,
              data,
            });
          },
          update: ({ id, data }) => {
            return this.userStore.update({
              modelName,
              timestamp: this.currentEventTimestamp,
              id,
              data,
            });
          },
          upsert: ({ id, create, update }) => {
            return this.userStore.upsert({
              modelName,
              timestamp: this.currentEventTimestamp,
              id,
              create,
              update,
            });
          },
          delete: ({ id }) => {
            return this.userStore.delete({
              modelName,
              timestamp: this.currentEventTimestamp,
              id,
            });
          },
        };
        return acc;
      },
      {}
    );

    const context = { contracts: this.injectedContracts, entities: models };

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

          this.metrics.latestHandledEventTimestamp = this.currentEventTimestamp;

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
}
