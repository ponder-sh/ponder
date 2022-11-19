import { Contract } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { EventLog } from "@/common/types";
import { EntityModel } from "@/db/entity/utils";
import type { Ponder } from "@/Ponder";

// import { stats } from "../indexer/stats";
import type { Handlers } from "./readHandlers";

export type HandlerTask = {
  log: EventLog;
};

export type HandlerQueue = fastq.queueAsPromised<HandlerTask>;

export const createHandlerQueue = ({
  ponder,
  handlers,
}: {
  ponder: Ponder;
  handlers: Handlers;
}): HandlerQueue => {
  // Build contracts for event handler context.
  const contracts: Record<string, Contract | undefined> = {};
  ponder.sources.forEach((source) => {
    contracts[source.name] = new Contract(
      source.address,
      source.abiInterface,
      source.network.provider
    );
  });

  if (!ponder.schema) {
    throw new Error(`Cannot create handler queue before building schema.`);
  }

  // Build entity models for event handler context.
  const entityModels: Record<string, EntityModel> = {};
  ponder.schema.entities.forEach((entity) => {
    const entityName = entity.name;
    const entityModel: EntityModel = {
      get: async (id) => ponder.entityStore.getEntity(entityName, id),
      insert: async (obj) => ponder.entityStore.insertEntity(entityName, obj),
      update: async (obj) => ponder.entityStore.updateEntity(entityName, obj),
      delete: async (id) => ponder.entityStore.deleteEntity(entityName, id),
    };

    entityModels[entityName] = entityModel;
  });

  const handlerContext = {
    contracts: contracts,
    entities: entityModels,
  };

  const handlerWorker = async ({ log }: HandlerTask) => {
    ponder.emit("handlerTaskStarted");

    const source = ponder.sources.find(
      (source) => source.address === log.address
    );
    if (!source) {
      logger.warn(`Source not found for log with address: ${log.address}`);
      return;
    }

    const sourceHandlers = handlers[source.name];
    if (!sourceHandlers) {
      logger.warn(`Handlers not found for source: ${source.name}`);
      return;
    }

    const parsedLog = source.abiInterface.parseLog({
      data: log.data,
      topics: JSON.parse(log.topics),
    });

    const params = parsedLog.eventFragment.inputs.reduce<
      Record<string, unknown>
    >((acc, input, index) => {
      acc[input.name] = parsedLog.args[index];
      return acc;
    }, {});

    const handler = sourceHandlers[parsedLog.name];
    if (!handler) {
      logger.trace(
        `Handler not found for event: ${source.name}-${parsedLog.name}`
      );
      return;
    }

    logger.trace(`Handling event: ${source.name}-${parsedLog.name}`);

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
      ...log,
      name: parsedLog.name,
      params: params,
      block,
      transaction,
    };

    try {
      // Running user code here!
      await handler(event, handlerContext);
    } catch (err) {
      logger.error("Error in handler:", err);
    }
  };

  const queue = fastq.promise<HandlerTask>(handlerWorker, 1);

  queue.error((err, task) => {
    if (err) {
      logger.error("error in log worker, retrying...:");
      logger.error({ task, err });
      queue.unshift(task);
    }
  });

  return queue;
};
