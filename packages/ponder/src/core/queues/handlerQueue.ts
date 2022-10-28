import { Contract } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { EventLog } from "@/common/types";
import type { CacheStore } from "@/db/cacheStore";
import type { Source } from "@/sources/base";

import { stats } from "../indexer/stats";
import type { Handlers } from "../readHandlers";

export type HandlerTask = {
  log: EventLog;
};

export type HandlerQueue = fastq.queueAsPromised<HandlerTask>;

export const createHandlerQueue = ({
  cacheStore,
  sources,
  handlers,
  pluginHandlerContext,
}: {
  cacheStore: CacheStore;
  sources: Source[];
  handlers: Handlers;
  pluginHandlerContext: Record<string, unknown>;
}): HandlerQueue => {
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

  const handlerWorker = async ({ log }: HandlerTask) => {
    const source = sources.find((source) => source.address === log.address);
    if (!source) {
      logger.warn(`Source not found for log with address: ${log.address}`);
      stats.processingProgressBar.setTotal(
        stats.processingProgressBar.getTotal() - 1
      );
      return;
    }

    if (!stats.sourceStats[source.name]) {
      stats.sourceStats[source.name] = {
        matchedLogCount: 0,
        handledLogCount: 0,
      };
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
      name: parsedLog.name,
      params: { ...parsedLog.args },
      block,
      transaction,
    };

    try {
      // Running user code here!
      await handler(event, handlerContext);
    } catch (err) {
      logger.error("Error in handler:", err);
    }

    stats.processingProgressBar.increment();
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
