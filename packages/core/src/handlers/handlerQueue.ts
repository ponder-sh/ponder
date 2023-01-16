import { Contract } from "ethers";
import pico from "picocolors";

import { logger } from "@/common/logger";
import type { Ponder } from "@/Ponder";
import { Source } from "@/sources/base";
import type { EventLog } from "@/types";

import { decodeLog } from "./decodeLog";
import type { Handlers } from "./readHandlers";

export function createNotSoFastQueue<T>(
  worker: (task: T) => Promise<any> | any,
  errorHandler: (err: Error) => any
) {
  let tasks: T[] = [];

  return {
    push: async (newTasks: T[]) => {
      tasks = tasks.concat(newTasks);
    },
    process: async () => {
      while (tasks.length > 0) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          await worker(tasks.shift()!);
        } catch (err) {
          errorHandler(err as Error);
        }
      }
    },
    kill: () => {
      tasks = [];
    },
  };
}

export type HandlerQueue<T = any> = {
  push: (newTasks: T[]) => Promise<void>;
  process: () => Promise<void>;
  kill: () => void;
};

export const createHandlerQueue = ({
  ponder,
  handlers,
}: {
  ponder: Ponder;
  handlers: Handlers;
}): HandlerQueue | null => {
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

  const handlerWorker = async (log: EventLog) => {
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
      ...log,
      name: eventName,
      params: params,
      block,
      transaction,
    };

    // This enables contract calls occurring within the
    // handler code to use the event block number by default.
    ponder.currentEventBlockTag = block.number;

    // Running user code here!
    await handler(event, handlerContext);

    ponder.emit("indexer_taskDone", { timestamp: block.timestamp });
  };

  const queue = createNotSoFastQueue(handlerWorker, (error) => {
    if (error) {
      ponder.emit("dev_error", {
        context: "handler file error: " + pico.bold(error.message),
        error,
      });
    }
  });

  return queue;
};
