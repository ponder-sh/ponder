import { E_CANCELED, Mutex } from "async-mutex";
import Emittery from "emittery";
import { decodeEventLog, encodeEventTopics, Hex } from "viem";

import { createQueue, Queue, Worker } from "@/common/queue";
import type { Log, Model } from "@/common/types";
import { EntityInstance } from "@/database/entity/entityStore";
import { EventHandlerError } from "@/errors/eventHandler";
import { Resources } from "@/Ponder";
import { Handlers } from "@/reload/readHandlers";
import { Schema } from "@/schema/types";

import {
  buildInjectedContract,
  ReadOnlyContract,
} from "./buildInjectedContract";
import { getStackTraceAndCodeFrame } from "./getStackTrace";

type EventHandlerServiceEvents = {
  taskStarted: undefined;
  taskCompleted: { timestamp?: number };

  eventsAdded: {
    handledCount: number;
    totalCount: number;
    fromTimestamp: number;
    toTimestamp: number;
  };
  eventsProcessed: { count: number; toTimestamp: number };
  eventQueueReset: undefined;
};

type SetupTask = { kind: "SETUP" };
type LogTask = { kind: "LOG"; logFilterName: string; log: Log };
type EventHandlerTask = SetupTask | LogTask;
type EventHandlerQueue = Queue<EventHandlerTask>;

export class EventHandlerService extends Emittery<EventHandlerServiceEvents> {
  resources: Resources;

  private handlers?: Handlers;
  private schema?: Schema;
  private queue?: EventHandlerQueue;

  private injectedContracts: Record<string, ReadOnlyContract | undefined> = {};

  isBackfillStarted = false;
  backfillCutoffTimestamp = Number.POSITIVE_INFINITY;

  private eventProcessingMutex: Mutex;
  private eventsHandledToTimestamp = 0;

  currentLogEventBlockNumber = 0n;

  constructor({ resources }: { resources: Resources }) {
    super();
    this.resources = resources;

    // Build the injected contract objects. They depend only on contract config,
    // so they can't be hot reloaded.
    this.resources.contracts.forEach((contract) => {
      this.injectedContracts[contract.name] = buildInjectedContract({
        contract,
        eventHandlerService: this,
      });
    });

    // Setup the event processing mutex.
    this.eventProcessingMutex = new Mutex();
  }

  killQueue() {
    this.queue?.clear();
  }

  resetEventQueue({
    handlers: newHandlers,
    schema: newSchema,
  }: {
    handlers?: Handlers;
    schema?: Schema;
  } = {}) {
    if (newHandlers) this.handlers = newHandlers;
    if (newSchema) this.schema = newSchema;

    if (!this.handlers || !this.schema) return;

    this.eventProcessingMutex.cancel();
    this.eventProcessingMutex = new Mutex();
    this.eventsHandledToTimestamp = 0;

    this.queue = this.createEventQueue({
      handlers: this.handlers,
      schema: this.schema,
    });

    this.emit("eventQueueReset");

    // If the setup handler is present, add the setup event.
    if (this.handlers.setup) {
      this.queue.addTask({ kind: "SETUP" });
      this.emit("eventsAdded", {
        handledCount: 1,
        totalCount: 1,
        fromTimestamp: this.eventsHandledToTimestamp,
        toTimestamp: this.eventsHandledToTimestamp,
      });
    }
  }

  async processEvents() {
    if (!this.isBackfillStarted) return;
    if (this.resources.errors.isHandlerError) return;

    try {
      await this.eventProcessingMutex.runExclusive(async () => {
        if (!this.queue) return;

        const { hasNewLogs, toTimestamp, events, totalLogCount } =
          await this.getNewEvents({
            fromTimestamp: this.eventsHandledToTimestamp,
          });

        if (!hasNewLogs) return;

        // Add new events to the queue.
        for (const event of events) {
          this.queue.addTask({
            kind: "LOG",
            logFilterName: event.logFilterName,
            log: event.log,
          });
        }

        this.emit("eventsAdded", {
          handledCount: events.length,
          totalCount: totalLogCount ?? events.length,
          fromTimestamp: this.eventsHandledToTimestamp,
          toTimestamp: toTimestamp,
        });

        // Process new events that were added to the queue.
        this.queue.start();
        await this.queue.onEmpty();
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
  }

  private createEventQueue({
    handlers,
    schema,
  }: {
    handlers: Handlers;
    schema: Schema;
  }) {
    const context = this.buildContext({ schema });

    const eventHandlerWorker: Worker<EventHandlerTask> = async ({
      task,
      queue,
    }) => {
      this.emit("taskStarted");

      switch (task.kind) {
        case "SETUP": {
          const setupHandler = handlers["setup"];
          if (!setupHandler) {
            this.resources.logger.warn(`Handler not found for event: setup`);
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

          this.emit("taskCompleted", {});

          break;
        }
        case "LOG": {
          const { logFilterName, log } = task;

          const logFilter = this.resources.logFilters.find(
            (f) => f.name === logFilterName
          );
          if (!logFilter) {
            this.resources.logger.warn(
              `Filter not found for log with address: ${log.address}`
            );
            return;
          }

          const decodedLog = decodeEventLog({
            // TODO: Remove this filter once viem is fixed.
            abi: logFilter.abi.filter((item) => item.type !== "constructor"),
            data: log.data,
            topics: [log.topic0, log.topic1, log.topic2, log.topic3].filter(
              (t) => !!t
            ) as [signature: Hex, ...args: Hex[]] | [],
          });

          if (!decodedLog) {
            this.resources.logger.warn(
              `Event log not found in ABI, data: ${log.data} topics: ${[
                log.topic0,
                log.topic1,
                log.topic2,
                log.topic3,
              ]}`
            );
            return;
          }
          const { eventName, args } = decodedLog;
          const params = args as any;

          const handler = handlers[logFilterName]?.[eventName];
          if (!handler) {
            this.resources.logger.warn(
              `Handler not found for log event: ${logFilterName}:${eventName}`
            );
            return;
          }

          this.resources.logger.trace(
            `Handling event: ${logFilterName}:${eventName}`
          );

          // Get block & transaction from the cache store and attach to the event.
          const block = await this.resources.cacheStore.getBlock(log.blockHash);
          if (!block) {
            throw new Error(`Block with hash not found: ${log.blockHash}`);
          }

          const transaction = await this.resources.cacheStore.getTransaction(
            log.transactionHash
          );
          if (!transaction) {
            throw new Error(
              `Transaction with hash not found: ${log.transactionHash}`
            );
          }

          const event = { name: eventName, params, log, block, transaction };

          // This enables contract calls occurring within the
          // handler code to use the event block number by default.
          this.currentLogEventBlockNumber = event.block.number;

          try {
            // Running user code here!
            await handler({ event, context });
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
                stackTrace: stackTrace,
                codeFrame: codeFrame,
                cause: error,
                eventName: event.name,
                blockNumber: event.block.number,
                params: event.params,
              }),
            });
          }

          this.emit("taskCompleted", {
            timestamp: Number(event.block.timestamp),
          });

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
  }

  private async getNewEvents({ fromTimestamp }: { fromTimestamp: number }) {
    // Check the cached metadata for all filters. If the minimum cached block across
    // all filters is greater than the lastHandledLogTimestamp, fetch the newly available
    // logs and add them to the queue.
    const cachedToTimestamps = await Promise.all(
      this.resources.logFilters.map(async (logFilter) => {
        const cachedRanges =
          await this.resources.cacheStore.getLogFilterCachedRanges({
            filterKey: logFilter.filter.key,
          });

        // Find the cached interval that includes the filter's startBlock.
        const startingCachedRange = cachedRanges.find(
          (range) =>
            range.startBlock <= logFilter.startBlock &&
            range.endBlock >= logFilter.startBlock
        );

        // If there is no cached data that includes the start block, return -1.
        if (!startingCachedRange) return -1;

        return startingCachedRange.endBlockTimestamp;
      })
    );

    // If any of the filters have no cached data yet, return early
    if (cachedToTimestamps.includes(-1)) {
      return { hasNewLogs: false, events: [], toTimestamp: fromTimestamp };
    }

    // If we've reached beyond cutoff timestamp already then
    // we can safely process all block
    let toTimestamp = Math.min(...cachedToTimestamps);
    if (toTimestamp >= this.backfillCutoffTimestamp) {
      toTimestamp = Math.max(...cachedToTimestamps);
    }

    // If the minimum cached timestamp across all filters is less than the
    // latest processed timestamp, we can't process any new logs.
    if (toTimestamp <= fromTimestamp) {
      return { hasNewLogs: false, events: [], toTimestamp: fromTimestamp };
    }

    // For UI/reporting purposes, also keep track of the total number of logs
    // found (not just those being handled)
    let totalLogCount = 0;

    // NOTE: cacheStore.getLogs is exclusive to the left and inclusive to the right.
    // This is fine because this.latestProcessedTimestamp starts at zero.
    const events = await Promise.all(
      this.resources.logFilters.map(async (logFilter) => {
        const handledEventNames = Object.keys(
          (this.handlers ?? {})[logFilter.name] ?? {}
        );
        const handledTopics = handledEventNames.map((eventName) => {
          // TODO: Disambiguate overloaded ABI event signatures BEFORE getting here.
          const topics = encodeEventTopics({
            abi: logFilter.abi,
            eventName,
          });
          return topics[0];
        });

        const [handledLogs, totalLogs] = await Promise.all([
          this.resources.cacheStore.getLogs({
            fromBlockTimestamp: fromTimestamp,
            toBlockTimestamp: toTimestamp,
            chainId: logFilter.network.chainId,
            address: logFilter.filter.address,
            topics: [handledTopics],
          }),
          this.resources.cacheStore.getLogs({
            fromBlockTimestamp: fromTimestamp,
            toBlockTimestamp: toTimestamp,
            chainId: logFilter.network.chainId,
            address: logFilter.filter.address,
            topics: logFilter.filter.topics,
          }),
        ]);

        totalLogCount += totalLogs.length;

        return handledLogs.map((log) => ({
          logFilterName: logFilter.name,
          log,
        }));
      })
    );

    const sortedEvents = events
      .flat()
      .sort((a, b) =>
        a.log.logSortKey < b.log.logSortKey
          ? -1
          : a.log.logSortKey > b.log.logSortKey
          ? 1
          : 0
      );

    return {
      hasNewLogs: true,
      toTimestamp,
      events: sortedEvents,
      totalLogCount,
    };
  }

  private buildContext({ schema }: { schema: Schema }) {
    // Build entity models for event handler context.
    const entityModels: Record<string, Model<EntityInstance>> = {};
    schema.entities.forEach((entity) => {
      const entityName = entity.name;

      entityModels[entityName] = {
        findUnique: ({ id }) =>
          this.resources.entityStore.findUniqueEntity({ entityName, id }),
        create: ({ id, data }) =>
          this.resources.entityStore.createEntity({ entityName, id, data }),
        update: ({ id, data }) =>
          this.resources.entityStore.updateEntity({ entityName, id, data }),
        upsert: ({ id, create, update }) =>
          this.resources.entityStore.upsertEntity({
            entityName,
            id,
            create,
            update,
          }),
        delete: ({ id }) =>
          this.resources.entityStore.deleteEntity({ entityName, id }),
      };
    });

    return {
      contracts: this.injectedContracts,
      entities: entityModels,
    };
  }
}
