import { Contract } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { EventLog } from "@/common/types";
import type { CacheStore } from "@/db/cacheStore";
import type { Source } from "@/sources/base";

import type { Handlers } from "../readHandlers";
import { stats } from "./stats";

export type LogTask = {
  log: EventLog;
};

export type LogQueue = fastq.queueAsPromised<LogTask>;

export const createLogQueue = ({
  cacheStore,
  sources,
  handlers,
  pluginHandlerContext,
}: {
  cacheStore: CacheStore;
  sources: Source[];
  handlers: Handlers;
  pluginHandlerContext: Record<string, unknown>;
}): LogQueue => {
  const contracts: Record<string, Contract | undefined> = {};
  sources.forEach((source) => {
    contracts[source.name] = new Contract(
      source.address,
      source.abiInterface,
      source.network.provider
    );
  });

  const handlerContext = {
    contracts: contracts,
    ...pluginHandlerContext,
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

    const sourceHandlers = handlers[source.name];
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

  const queue = fastq.promise<LogTask>(logWorker, 1);

  queue.error((err, task) => {
    if (err) {
      logger.error("error in log worker, retrying...:");
      logger.error({ task, err });
      queue.unshift(task);
    }
  });

  return queue;
};
