import { Hash, Transaction as ViemTransaction } from "viem";

import { createQueue, Queue, Worker } from "@/common/createQueue";
import { MessageKind } from "@/common/LoggerService";
import { parseBlock, parseTransactions } from "@/common/types";

import { FrontfillService, LogFilterGroup } from "./FrontfillService";

export type BlockFrontfillTask = {
  blockNumberToCacheFrom: number;
  blockNumber: number;
  requiredTxHashes: Set<Hash>;
};

export type BlockFrontfillWorkerContext = {
  frontfillService: FrontfillService;
  group: LogFilterGroup;
};

export type BlockFrontfillQueue = Queue<BlockFrontfillTask>;

export const createBlockFrontfillQueue = (
  context: BlockFrontfillWorkerContext
) => {
  const queue = createQueue({
    worker: blockFrontfillWorker,
    context,
    options: {
      concurrency: 1,
    },
  });

  // Pass queue events on to service layer.
  queue.on("add", () => {
    context.frontfillService.emit("blockTasksAdded", {
      network: context.group.network.name,
      count: 1,
    });
  });

  queue.on("error", ({ error }) => {
    context.frontfillService.emit("blockTaskFailed", {
      network: context.group.network.name,
      error,
    });
  });

  queue.on("completed", () => {
    context.frontfillService.emit("blockTaskCompleted", {
      network: context.group.network.name,
    });
  });

  // Default to a simple retry.
  queue.on("error", ({ task }) => {
    queue.addTask(task);
  });

  return queue;
};

const blockFrontfillWorker: Worker<
  BlockFrontfillTask,
  BlockFrontfillWorkerContext
> = async ({ task, context }) => {
  const { blockNumber, requiredTxHashes, blockNumberToCacheFrom } = task;
  const { frontfillService, group } = context;
  const { client } = group.network;

  const rawBlock = await client.getBlock({
    blockNumber: BigInt(blockNumber),
    includeTransactions: true,
  });

  const block = parseBlock(rawBlock);

  // If the block is pending, log a warning.
  if (!block) {
    frontfillService.resources.logger.logMessage(
      MessageKind.WARNING,
      `Received unexpected pending block (number: ${blockNumber})`
    );
    return;
  }

  const allTransactions = parseTransactions(
    block.transactions as ViemTransaction[]
  );

  // If any pending transactions were present in the block, log a warning.
  if (allTransactions.length !== block.transactions.length) {
    frontfillService.resources.logger.logMessage(
      MessageKind.WARNING,
      `Received unexpected pending transactions in block (number: ${blockNumber}, count: ${
        block.transactions.length - allTransactions.length
      })`
    );
    return;
  }

  // Filter down to only required transactions (transactions that emitted events we care about).
  const transactions = allTransactions.filter((tx) =>
    requiredTxHashes.has(tx.hash)
  );

  await Promise.all([
    frontfillService.resources.cacheStore.insertBlock(block),
    frontfillService.resources.cacheStore.insertTransactions(transactions),
    ...group.filterKeys.map((filterKey) =>
      frontfillService.resources.cacheStore.insertLogFilterCachedRange({
        range: {
          filterKey,
          startBlock: blockNumberToCacheFrom,
          endBlock: blockNumber,
          endBlockTimestamp: Number(block.timestamp),
        },
      })
    ),
  ]);

  context.frontfillService.emit("eventsAdded");
};
