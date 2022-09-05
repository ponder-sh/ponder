import type { Log } from "@ethersproject/providers";
import { BigNumber, Contract } from "ethers";

import { logger } from "@/common/logger";
import { PonderSchema } from "@/core/schema/types";
import { Source } from "@/sources/base";
import { Store } from "@/stores/base";

import { EntityModel, Handlers } from "./readHandlers";

export type LogWorker = (log: Log) => Promise<void>;

export const buildLogWorker = (
  store: Store,
  sources: Source[],
  schema: PonderSchema,
  userHandlers: Handlers
): LogWorker => {
  const entityModels: Record<string, EntityModel> = {};
  schema.entities.forEach((entity) => {
    const entityName = entity.name;
    const entityModel: EntityModel = {
      get: async (id) => store.getEntity(entityName, id),
      insert: async (obj) => store.insertEntity(entityName, obj),
      upsert: async (obj) => store.upsertEntity(entityName, obj),
      delete: async (id) => store.deleteEntity(entityName, id),
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
  const worker: LogWorker = async (log) => {
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
      logger.warn(
        `Handler not found for event: ${source.name}-${parsedLog.name}`
      );
      return;
    }

    const logBlockNumber = BigNumber.from(log.blockNumber).toNumber();
    logger.debug(`Processing ${parsedLog.name} from block ${logBlockNumber}`);

    // TOOD: Add more shit to the event here?
    const event = { ...parsedLog, params: params };

    // YAY: We're running user code here!
    try {
      await handler(event, handlerContext);
    } catch (err) {
      console.log("error in handler:", err);
    }
  };

  return worker;
};
