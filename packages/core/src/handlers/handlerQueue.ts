import { Contract } from "ethers";
import fastq from "fastq";
import pico from "picocolors";

import { logger } from "@/common/logger";
import type { Ponder } from "@/Ponder";
import { Source } from "@/sources/base";
import type { Log } from "@/types";

import { decodeLog } from "./decodeLog";
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
  const contracts: Record<string, Contract | undefined> = {};
  ponder.sources.forEach((source) => {
    contracts[source.name] = new Contract(
      source.address,
      source.abiInterface,
      source.network.provider
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

  const sourceByAddress = ponder.sources.reduce<
    Record<string, Source | undefined>
  >((acc, source) => {
    acc[source.address] = source;
    return acc;
  }, {});

  const handlerWorker = async (log: Log) => {
    ponder.emit("indexer_taskStarted");

    const source = sourceByAddress[log.address];
    if (!source) {
      logger.warn(`Source not found for log with address: ${log.address}`);
      return;
    }

    const sourceHandlers = handlers[source.name];
    if (!sourceHandlers) {
      logger.warn(`Handlers not found for source: ${source.name}`);
      return;
    }

    const decodedLog = decodeLog({ log, abiInterface: source.abiInterface });
    if (!decodedLog) {
      logger.warn(
        `Event log not found in ABI, data: ${log.data} topics: ${log.topics}`
      );
      return;
    }
    const { eventName, params } = decodedLog;

    const handler = sourceHandlers[eventName];
    if (!handler) {
      logger.trace(`Handler not found for event: ${source.name}-${eventName}`);
      return;
    }

    logger.trace(`Handling event: ${source.name}-${eventName}`);

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

  queue.error(
    (
      error /* TODO use the task arg to provide context to the user about the error. */
    ) => {
      if (error) {
        ponder.emit("dev_error", {
          context: "handler file error: " + pico.bold(error.message),
          error,
        });
      }
    }
  );

  queue.pause();

  return queue;
};
