import { Contract as EthersContract } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import { Contract } from "@/config/contracts";
import { CacheStore } from "@/db/cache/cacheStore";
import { EntityStore } from "@/db/entity/entityStore";
import { Schema } from "@/schema/types";
import type { Log } from "@/types";

import { decodeLog } from "./decodeLog";
import { EventHandlerService } from "./EventHandlerService";
import { getStackTraceAndCodeFrame } from "./getStackTrace";
import type { Handlers } from "../reload/readHandlers";

export type HandlerTask = Log;

export type HandlerQueue = fastq.queueAsPromised<HandlerTask>;

export const createHandlerQueue = ({
  eventHandlerService,
  handlers,
  contracts,
  cacheStore,
  entityStore,
  schema,
}: {
  eventHandlerService: EventHandlerService;
  handlers: Handlers;
  contracts: Contract[];
  cacheStore: CacheStore;
  entityStore: EntityStore;
  schema: Schema;
}) => {
  // Build contracts for event handler context.
  const injectedContracts: Record<string, EthersContract | undefined> = {};
  contracts.forEach((contract) => {
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
      get: (id: string) => entityStore.getEntity(entityId, id),
      delete: (id: string) => entityStore.deleteEntity(entityId, id),
      insert: (id: string, obj: Record<string, unknown>) =>
        entityStore.insertEntity(entityId, id, obj),
      update: (id: string, obj: Record<string, unknown>) =>
        entityStore.updateEntity(entityId, id, obj),
      upsert: (id: string, obj: Record<string, unknown>) =>
        entityStore.upsertEntity(entityId, id, obj),
    };
  });

  const handlerContext = {
    contracts: injectedContracts,
    entities: entityModels,
  };

  const contractByAddress = contracts.reduce<
    Record<string, Contract | undefined>
  >((acc, contract) => {
    acc[contract.address] = contract;
    return acc;
  }, {});

  const handlerWorker = async (log: Log) => {
    eventHandlerService.emit("indexer_taskStarted");

    const contract = contractByAddress[log.address];
    if (!contract) {
      logger.warn(`Contract not found for log with address: ${log.address}`);
      return;
    }

    const contractHandlers = handlers[contract.name];
    if (!contractHandlers) {
      logger.warn(`Handlers not found for contract: ${contract.name}`);
      return;
    }

    const decodedLog = decodeLog({ log, abiInterface: contract.abiInterface });
    if (!decodedLog) {
      logger.warn(
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
      logger.trace(
        `Handler not found for event: ${contract.name}-${eventName}`
      );
      return;
    }

    logger.trace(`Handling event: ${contract.name}-${eventName}`);

    // Get block & transaction from the cache store and attach to the event.
    const block = await cacheStore.getBlock(log.blockHash);
    if (!block) {
      throw new Error(`Block with hash not found: ${log.blockHash}`);
    }

    const transaction = await cacheStore.getTransaction(log.transactionHash);
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
    ponder.currentEventBlockTag = block.number;

    // Running user code here!
    await handler({ event, context: handlerContext });

    eventHandlerService.emit("indexer_taskDone", {
      timestamp: block.timestamp,
    });
  };

  const queue = fastq.promise<unknown, HandlerTask>({}, handlerWorker, 1);

  /* TODO use the task arg to provide context to the user about the error. */
  queue.error((error) => {
    if (error) {
      const result = getStackTraceAndCodeFrame(error, options);
      if (result) {
        error.stack = `${result.stackTrace}\n` + result.codeFrame;
      }

      eventHandlerService.emit("dev_error", {
        context: error.message,
        error,
      });
    }
  });

  queue.pause();

  return queue;
};
