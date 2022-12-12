import { Contract } from "ethers";

import { logger } from "@/common/logger";
import type { EventLog } from "@/common/types";
import type { Ponder } from "@/Ponder";

import type { Handlers } from "./readHandlers";

export function createNotSoFastQueue<T>(
  worker: (task: T) => Promise<any> | any,
  errorHandler: (err: unknown) => any
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
          errorHandler(err);
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

  const handlerWorker = async (log: EventLog) => {
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
      let value = parsedLog.args[index];
      if (typeof value === "object" && value._isIndexed) {
        value = value.hash;
      }
      acc[input.name] = value;
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

    // Running user code here!
    await handler(event, handlerContext);
  };

  const queue = createNotSoFastQueue(handlerWorker, (err) => {
    if (err) {
      ponder.emit("handlerTaskError", err);
    }
  });

  return queue;
};
