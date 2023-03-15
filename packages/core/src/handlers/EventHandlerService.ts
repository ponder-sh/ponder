import Emittery from "emittery";
import { decodeEventLog, encodeEventTopics, Hex } from "viem";

import { createQueue, Queue, Worker } from "@/common/createQueue";
import { MessageKind } from "@/common/LoggerService";
import type { Log } from "@/common/types";
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
  taskCompleted: { timestamp: number };

  eventsAdded: {
    handledCount: number;
    totalCount: number;
    fromTimestamp: number;
    toTimestamp: number;
  };
  eventsProcessed: { count: number; toTimestamp: number };
  eventQueueReset: undefined;
};

type EventHandlerTask = { log: Log };
type EventHandlerQueue = Queue<EventHandlerTask>;

export class EventHandlerService extends Emittery<EventHandlerServiceEvents> {
  resources: Resources;

  private handlers?: Handlers;
  private schema?: Schema;
  private queue?: EventHandlerQueue;

  private injectedContracts: Record<string, ReadOnlyContract | undefined> = {};

  isBackfillStarted = false;

  private eventProcessingPromise?: Promise<void>;
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

    this.queue = this.createEventQueue({
      handlers: this.handlers,
      schema: this.schema,
    });
    this.eventProcessingPromise = undefined;
    this.eventsHandledToTimestamp = 0;

    this.emit("eventQueueReset");
  }

  async processEvents() {
    if (!this.isBackfillStarted) return;
    if (this.resources.errors.isHandlerError) return;

    // If there is already a call to processEvents() in progress, wait for that to be
    // complete before kicking off another. This is likely buggy.
    if (this.eventProcessingPromise) {
      await this.eventProcessingPromise;
    }

    const eventProcessingPromise = async () => {
      if (!this.queue) return;

      const { hasNewLogs, toTimestamp, logs, totalLogCount } =
        await this.getNewEvents({
          fromTimestamp: this.eventsHandledToTimestamp,
        });

      if (!hasNewLogs) return;

      // Add new events to the queue.
      for (const log of logs) {
        this.queue.addTask({ log });
      }

      this.emit("eventsAdded", {
        handledCount: logs.length,
        totalCount: totalLogCount ?? logs.length,
        fromTimestamp: this.eventsHandledToTimestamp,
        toTimestamp: toTimestamp,
      });

      // Process new events that were added to the queue.
      this.queue.start();
      await this.queue.onEmpty();
      this.queue.pause();

      this.eventsHandledToTimestamp = toTimestamp;

      this.emit("eventsProcessed", {
        count: logs.length,
        toTimestamp: toTimestamp,
      });
    };

    const promise = eventProcessingPromise();
    this.eventProcessingPromise = promise;
    await promise;
  }

  private createEventQueue({
    handlers,
    schema,
  }: {
    handlers: Handlers;
    schema: Schema;
  }) {
    // Build entity models for event handler context.
    const entityModels: Record<string, unknown> = {};
    schema.entities.forEach((entity) => {
      const { id: entityId, name: entityName } = entity;

      entityModels[entityName] = {
        get: (id: string) => this.resources.entityStore.getEntity(entityId, id),
        delete: (id: string) =>
          this.resources.entityStore.deleteEntity(entityId, id),
        insert: (id: string, obj: Record<string, unknown>) =>
          this.resources.entityStore.insertEntity(entityId, id, obj),
        update: (id: string, obj: Record<string, unknown>) =>
          this.resources.entityStore.updateEntity(entityId, id, obj),
        upsert: (id: string, obj: Record<string, unknown>) =>
          this.resources.entityStore.upsertEntity(entityId, id, obj),
      };
    });

    const injectedContext = {
      contracts: this.injectedContracts,
      entities: entityModels,
    };

    const eventHandlerWorker: Worker<EventHandlerTask> = async ({
      task,
      queue,
    }) => {
      this.emit("taskStarted");

      const { log } = task;

      const contract = this.resources.contracts.find(
        (contract) => contract.address === log.address
      );
      if (!contract) {
        this.resources.logger.warn(
          `Contract not found for log with address: ${log.address}`
        );
        return;
      }

      const contractHandlers = handlers[contract.name];
      if (!contractHandlers) {
        this.resources.logger.warn(
          `Handlers not found for contract: ${contract.name}`
        );
        return;
      }

      const decodedLog = decodeEventLog({
        // TODO: Remove this filter once viem is fixed.
        abi: contract.abi.filter((item) => item.type !== "constructor"),
        data: log.data,
        topics: [log.topic0 as Hex, log.topic1, log.topic2, log.topic3],
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

      const handler = contractHandlers[eventName];
      if (!handler) {
        this.resources.logger.trace(
          `Handler not found for event: ${contract.name}-${eventName}`
        );
        return;
      }

      this.resources.logger.trace(
        `Handling event: ${contract.name}-${eventName}`
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

      const event = {
        name: eventName,
        params: args as any,
        log: log,
        block,
        transaction,
      };

      // This enables contract calls occurring within the
      // handler code to use the event block number by default.
      this.currentLogEventBlockNumber = block.number;

      try {
        // Running user code here!
        await handler({ event, context: injectedContext });
      } catch (error_) {
        // Remove all remaining tasks from the queue.
        queue.clear();

        // Log stack trace and message.
        const error = error_ as Error;
        const result = getStackTraceAndCodeFrame(error, this.resources.options);
        if (result) {
          error.stack = `${result.stackTrace}\n` + result.codeFrame;
        }

        // TODO: Use the task arg to provide context to the user about the error.
        this.resources.logger.logMessage(
          MessageKind.ERROR,
          "running event handlers" + ": " + error.message + `\n` + error.stack
        );
      }

      this.emit("taskCompleted", { timestamp: Number(block.timestamp) });
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
    const contracts = this.resources.contracts.filter(
      (contract) => contract.isIndexed
    );

    // Check the cached metadata for all contracts. If the minimum cached block across
    // all contracts is greater than the lastHandledLogTimestamp, fetch the newly available
    // logs and add them to the queue.
    const cachedToTimestamps = await Promise.all(
      contracts.map(async (contract) => {
        const cachedIntervals =
          await this.resources.cacheStore.getCachedIntervals(contract.address);

        // Find the cached interval that includes the contract's startBlock.
        const startingCachedInterval = cachedIntervals.find(
          (interval) =>
            interval.startBlock <= contract.startBlock &&
            interval.endBlock >= contract.startBlock
        );

        // If there is no cached data that includes the start block, return -1.
        if (!startingCachedInterval) return -1;

        return startingCachedInterval.endBlockTimestamp;
      })
    );

    // If any of the contracts have no cached data yet, return early
    if (cachedToTimestamps.includes(-1)) {
      return { hasNewLogs: false, logs: [], toTimestamp: fromTimestamp };
    }

    // If the minimum cached timestamp across all contracts is less than the
    // latest processed timestamp, we can't process any new logs.
    const toTimestamp = Math.min(...cachedToTimestamps);
    if (toTimestamp <= fromTimestamp) {
      return { hasNewLogs: false, logs: [], toTimestamp: fromTimestamp };
    }

    // For UI/reporting purposes, also keep track of the total number of logs
    // found (not just those being handled)
    let totalLogCount = 0;

    // NOTE: cacheStore.getLogs is exclusive to the left and inclusive to the right.
    // This is fine because this.latestProcessedTimestamp starts at zero.
    const rawLogs = await Promise.all(
      contracts.map(async (contract) => {
        const handlers = this.handlers ?? {};

        const contractHandlers = handlers[contract.name] ?? {};
        const eventNames = Object.keys(contractHandlers);

        const eventSigHashes = eventNames.map((eventName) => {
          // TODO: Disambiguate overloaded ABI event signatures BEFORE getting here.
          const eventTopics = encodeEventTopics({
            abi: contract.abi,
            eventName,
          });
          const eventSignatureTopic = eventTopics[0];
          return eventSignatureTopic;
        });

        const [logs, totalLogs] = await Promise.all([
          this.resources.cacheStore.getLogs({
            contractAddress: contract.address,
            fromBlockTimestamp: fromTimestamp,
            toBlockTimestamp: toTimestamp,
            eventSigHashes,
          }),
          this.resources.cacheStore.getLogs({
            contractAddress: contract.address,
            fromBlockTimestamp: fromTimestamp,
            toBlockTimestamp: toTimestamp,
          }),
        ]);

        totalLogCount += totalLogs.length;

        return logs;
      })
    );

    const logs = rawLogs
      .flat()
      .sort((a, b) =>
        a.logSortKey < b.logSortKey ? -1 : a.logSortKey > b.logSortKey ? 1 : 0
      );

    return { hasNewLogs: true, toTimestamp, logs, totalLogCount };
  }
}
