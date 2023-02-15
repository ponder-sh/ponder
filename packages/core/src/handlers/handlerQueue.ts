import { Contract as EthersContract } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import { Contract } from "@/config/contracts";
import type { Ponder } from "@/Ponder";
import type { Log } from "@/types";

import { decodeLog } from "./decodeLog";
import { getStackTraceAndCodeFrame } from "./getStackTrace";
import type { Handlers } from "./readHandlers";

export type HandlerTask = Log;

export type HandlerQueue = fastq.queueAsPromised<HandlerTask>;

export const createHandlerQueue = ({
  ponder,
  handlers,
}: {
  ponder: Ponder;
  handlers: Handlers;
}) => {
  // Can't build handler queue without schema.
  if (!ponder.schema) return null;

  // Build contracts for event handler context.
  const contracts: Record<string, EthersContract | undefined> = {};
  ponder.contracts.forEach((contract) => {
    contracts[contract.name] = new EthersContract(
      contract.address,
      contract.abiInterface,
      contract.network.provider
    );
  });

  // Build entity models for event handler context.
  const entityModels: Record<string, unknown> = {};
  ponder.schema.entities.forEach((entity) => {
    const entityName = entity.name;
    const entityModel = {
      get: (id: string) => ponder.entityStore.getEntity(entityName, id),
      delete: (id: string) => ponder.entityStore.deleteEntity(entityName, id),
      insert: (id: string, obj: Record<string, unknown>) =>
        ponder.entityStore.insertEntity(entityName, id, obj),
      update: (id: string, obj: Record<string, unknown>) =>
        ponder.entityStore.updateEntity(entityName, id, obj),
      upsert: (id: string, obj: Record<string, unknown>) =>
        ponder.entityStore.upsertEntity(entityName, id, obj),
    };

    entityModels[entityName] = entityModel;
  });

  const handlerContext = {
    contracts: contracts,
    entities: entityModels,
  };

  const contractByAddress = ponder.contracts.reduce<
    Record<string, Contract | undefined>
  >((acc, contract) => {
    acc[contract.address] = contract;
    return acc;
  }, {});

  const handlerWorker = async (log: Log) => {
    ponder.emit("indexer_taskStarted");

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
        `Event log not found in ABI, data: ${log.data} topics: ${log.topics}`
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
    const block = await ponder.cacheStore.getBlock(log.blockHash);
    if (!block) {
      throw new Error(`Block with hash not found: ${log.blockHash}`);
    }

    const transaction = await ponder.cacheStore.getTransaction(
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
    ponder.currentEventBlockTag = block.number;

    // Running user code here!
    await handler({ event, context: handlerContext });

    ponder.emit("indexer_taskDone", { timestamp: block.timestamp });
  };

  const queue = fastq.promise<unknown, HandlerTask>({}, handlerWorker, 1);

  /* TODO use the task arg to provide context to the user about the error. */
  queue.error((error) => {
    if (error) {
      const result = getStackTraceAndCodeFrame(error, ponder);
      if (result) {
        error.stack = `${result.stackTrace}\n` + result.codeFrame;
      }

      ponder.emit("dev_error", {
        context: `Handler file error: ${error.message}`,
        error,
      });
    }
  });

  queue.pause();

  return queue;
};
