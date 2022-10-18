import { Contract } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { PonderSchema } from "@/core/schema/types";
import type { Source } from "@/sources/base";
import type { CacheStore } from "@/stores/baseCacheStore";
import type { EntityStore } from "@/stores/baseEntityStore";
import type { CachedLog } from "@/stores/utils";

import type { EntityModel, Handlers } from "../readHandlers";
import { stats } from "./stats";

export type LogTask = {
  log: CachedLog;
};

export type LogQueue = fastq.queueAsPromised<LogTask>;

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
}): LogQueue => {
  const entityModels: Record<string, EntityModel> = {};
  schema.entities.forEach((entity) => {
    const entityName = entity.name;
    const entityModel: EntityModel = {
      get: async (id) => entityStore.getEntity(entityName, id),
      insert: async (obj) => entityStore.insertEntity(entityName, obj),
      update: async (obj) => entityStore.updateEntity(entityName, obj),
      delete: async (id) => entityStore.deleteEntity(entityName, id),
    };

    entityModels[entityName] = entityModel;
  });

  const contracts: Record<string, Contract | undefined> = {};
  sources.forEach((source) => {
    contracts[source.name] = new Contract(
      source.address,
      source.abiInterface,
      source.network.provider
    );
  });

  const handlerContext = {
    entities: entityModels,
    contracts: contracts,
  };

  const logWorker = async ({ log }: LogTask) => {
    const source = sources.find((source) => source.address === log.address);
    if (!source) {
      logger.warn(`Source not found for log with address: ${log.address}`);
      stats.processingProgressBar.setTotal(
        stats.processingProgressBar.getTotal() - 1
      );
      return;
    }

    stats.sourceStats[source.name].matchedLogCount += 1;

    const sourceHandlers = userHandlers[source.name];
    if (!sourceHandlers) {
      logger.warn(`Handlers not found for source: ${source.name}`);
      stats.processingProgressBar.setTotal(
        stats.processingProgressBar.getTotal() - 1
      );
      return;
    }

    const parsedLog = source.abiInterface.parseLog({
      data: log.data,
      topics: JSON.parse(log.topics),
    });

    const handler = sourceHandlers[parsedLog.name];
    if (!handler) {
      logger.trace(
        `Handler not found for event: ${source.name}-${parsedLog.name}`
      );
      stats.processingProgressBar.setTotal(
        stats.processingProgressBar.getTotal() - 1
      );
      return;
    }

    stats.sourceStats[source.name].handledLogCount += 1;

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
      ...log,
      params: { ...parsedLog.args },
      block,
      transaction,
    };

    // YAY: We're running user code here!
    try {
      await handler(event, handlerContext);
    } catch (err) {
      logger.error("Error in handler:", err);
    }

    stats.processingProgressBar.increment();
  };

  return fastq.promise<LogTask>(logWorker, 1);
};
