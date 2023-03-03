import { EventEmitter } from "@/common/EventEmitter";
import { Handlers } from "@/reload/readHandlers";
import { Contract as EthersContract, utils } from "ethers";
import fastq from "fastq";
import { Contract } from "@/config/contracts";
import { Schema } from "@/schema/types";
import { getStackTraceAndCodeFrame } from "./getStackTrace";
import { Resources } from "@/Ponder";
import { decodeLog } from "./decodeLog";
import type { Log } from "@/types";

type EventHandlerServiceEvents = {
  taskStarted: () => void;
  taskCompleted: (arg: { timestamp: number }) => void;

  eventsAdded: (arg: {
    handledCount: number;
    totalCount: number;
    fromTimestamp: number;
    toTimestamp: number;
  }) => void;
  eventsProcessed: (arg: { count: number; toTimestamp: number }) => void;
};

type HandlerTask = Log;
type HandlerQueue = fastq.queueAsPromised<HandlerTask>;

export class EventHandlerService extends EventEmitter<EventHandlerServiceEvents> {
  resources: Resources;

  private handlers?: Handlers;
  private schema?: Schema;
  private queue?: HandlerQueue;

  private isProcessingEvents = false;
  private currentLogEventBlockNumber = 0;
  private eventsHandledToTimestamp = 0;

  constructor({ resources }: { resources: Resources }) {
    super();
    this.resources = resources;
  }

  killQueue() {
    this.queue?.kill();
    delete this.queue;
  }

  async resetEventQueue({
    handlers: newHandlers,
    schema: newSchema,
  }: {
    handlers?: Handlers;
    schema?: Schema;
  }) {
    if (newHandlers) this.handlers = newHandlers;
    if (newSchema) this.schema = newSchema;

    if (!this.handlers || !this.schema) return;

    if (this.queue) {
      this.queue.kill();
      delete this.queue;
      this.isProcessingEvents = false;
    }

    const queue = this.createEventQueue({
      handlers: this.handlers,
      schema: this.schema,
    });

    this.queue = queue;
  }

  async processNewEvents() {
    if (
      !this.queue ||
      this.isProcessingEvents ||
      this.resources.errors.isHandlerError
    ) {
      return;
    }
    this.isProcessingEvents = true;

    const { hasNewLogs, toTimestamp, logs, totalLogCount } =
      await this.getNewEvents({
        fromTimestamp: this.eventsHandledToTimestamp,
      });

    if (!hasNewLogs) {
      this.isProcessingEvents = false;
      return;
    }

    // Add new events to the queue.
    for (const log of logs) {
      this.queue.push(log);
    }

    this.emit("eventsAdded", {
      handledCount: logs.length,
      totalCount: totalLogCount ?? logs.length,
      fromTimestamp: this.eventsHandledToTimestamp,
      toTimestamp: toTimestamp,
    });

    // Process new events that were added to the queue.
    this.queue.resume();
    if (!this.queue.idle()) {
      await this.queue.drained();
    }
    this.queue.pause();

    this.eventsHandledToTimestamp = toTimestamp;
    this.isProcessingEvents = false;

    this.emit("eventsProcessed", {
      count: logs.length,
      toTimestamp: toTimestamp,
    });

    // // If, after this batch of logs, logsAddedToTimestamp is greater than the latest
    // // frontfill network timestamp AND the backfill is complete, log processing is complete.
    // const latestBackfillTimestamp = Math.max(
    //   ...this.frontfillNetworks.map(
    //     ({ latestBlockNumber }) => latestBlockNumber
    //   )
    // );
    // if (
    //   !this.isLogProcessingComplete &&
    //   this.logsAddedToTimestamp >= latestBackfillTimestamp &&
    //   this.isBackfillComplete
    // ) {
    //   this.logMessage(
    //     MessageKind.INDEXER,
    //     "backfill event processing complete"
    //   );
    //   this.isLogProcessingComplete = true;
    // }
  }

  private createEventQueue({
    handlers,
    schema,
  }: {
    handlers: Handlers;
    schema: Schema;
  }) {
    // Build contracts for event handler context.
    const injectedContracts: Record<string, EthersContract | undefined> = {};
    this.resources.contracts.forEach((contract) => {
      injectedContracts[contract.name] = new EthersContract(
        contract.address,
        contract.abiInterface,
        contract.network.provider
      );
    });

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

    const handlerContext = {
      contracts: injectedContracts,
      entities: entityModels,
    };

    const contractByAddress = this.resources.contracts.reduce<
      Record<string, Contract | undefined>
    >((acc, contract) => {
      acc[contract.address] = contract;
      return acc;
    }, {});

    const handlerWorker = async (log: HandlerTask) => {
      this.emit("taskStarted");

      const contract = contractByAddress[log.address];
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

      const decodedLog = decodeLog({
        log,
        abiInterface: contract.abiInterface,
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
      const { eventName, params } = decodedLog;

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
        params: params,
        log: log,
        block,
        transaction,
      };

      // This enables contract calls occurring within the
      // handler code to use the event block number by default.
      this.currentLogEventBlockNumber = block.number;

      // Running user code here!
      await handler({ event, context: handlerContext });

      this.emit("taskCompleted", { timestamp: block.timestamp });
    };

    const queue = fastq.promise<unknown, Log>({}, handlerWorker, 1);

    /* TODO use the task arg to provide context to the user about the error. */
    queue.error((error) => {
      if (error) {
        const result = getStackTraceAndCodeFrame(error, this.resources.options);
        if (result) {
          error.stack = `${result.stackTrace}\n` + result.codeFrame;
        }

        this.resources.errors.submitHandlerError(error);
      }
    });

    queue.pause();

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

        const eventSigHashes = eventNames
          .map((eventName) => {
            try {
              const fragment = contract.abiInterface.getEvent(eventName);
              const signature = fragment.format();
              const hash = utils.solidityKeccak256(["string"], [signature]);
              return hash;
            } catch (err) {
              this.resources.logger.error(
                `Unable to generate event sig hash for event: ${eventName}`
              );
            }
          })
          .filter((hash): hash is string => !!hash);

        const [logs, totalLogs] = await Promise.all([
          this.resources.cacheStore.getLogs(
            contract.address,
            fromTimestamp,
            toTimestamp,
            eventSigHashes
          ),
          this.resources.cacheStore.getLogs(
            contract.address,
            fromTimestamp,
            toTimestamp
          ),
        ]);

        totalLogCount += totalLogs.length;

        return logs;
      })
    );

    const logs = rawLogs.flat().sort((a, b) => a.logSortKey - b.logSortKey);

    return { hasNewLogs: true, toTimestamp, logs, totalLogCount };
  }
}
