import type { Log } from "@ethersproject/providers";
import { BigNumber, Contract } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { PonderSchema } from "@/core/schema/types";
import type { Source } from "@/sources/base";
import type { CacheStore } from "@/stores/baseCacheStore";
import type { EntityStore } from "@/stores/baseEntityStore";

import type { EntityModel, Handlers } from "../readHandlers";

export type LogTask = {
  log: Log;
};

export const createLogQueue = ({
  cacheStore,
  entityStore,
  sources,
  schema,
  userHandlers,
}: {
  cacheStore: CacheStore;
  entityStore: EntityStore;
  sources: Source[];
  schema: PonderSchema;
  userHandlers: Handlers;
}) => {
  const entityModels: Record<string, EntityModel> = {};
  schema.entities.forEach((entity) => {
    const entityName = entity.name;
    const entityModel: EntityModel = {
      get: async (id) => entityStore.getEntity(entityName, id),
      insert: async (obj) => entityStore.insertEntity(entityName, obj),
      upsert: async (obj) => entityStore.upsertEntity(entityName, obj),
      delete: async (id) => entityStore.deleteEntity(entityName, id),
    };

    entityModels[entityName] = entityModel;
  });

  const contracts: Record<string, Contract | undefined> = {};
  sources.forEach((source) => {
    contracts[source.name] = source.contract;
  });

  const handlerContext = {
    entities: entityModels,
    contracts: contracts,
  };

  // NOTE: This function should probably come as a standalone param.
  const logWorker = async (log: Log) => {
    const source = sources.find((source) => source.address === log.address);
    if (!source) {
      logger.warn(`Source not found for log with address: ${log.address}`);
      return;
    }

    const parsedLog = source.abiInterface.parseLog(log);
    const params = { ...parsedLog.args };

    const sourceHandlers = userHandlers[source.name];
    if (!sourceHandlers) {
      logger.warn(`Handlers not found for source: ${source.name}`);
      return;
    }

    const handler = sourceHandlers[parsedLog.name];
    if (!handler) {
      logger.debug(
        `Handler not found for event: ${source.name}-${parsedLog.name}`
      );
      return;
    }

    const logBlockNumber = BigNumber.from(log.blockNumber).toNumber();
    logger.debug(`Processing ${parsedLog.name} from block ${logBlockNumber}`);

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

    const event = { ...parsedLog, params: params, block, transaction };

    // YAY: We're running user code here!
    try {
      await handler(event, handlerContext);
    } catch (err) {
      logger.error("Error in handler:", err);
    }
  };

  return fastq.promise<LogTask>(logWorker, 1);
};
