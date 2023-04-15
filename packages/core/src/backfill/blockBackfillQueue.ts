import { Hash, Transaction as ViemTransaction } from "viem";

import { createQueue, Queue, Worker } from "@/common/createQueue";
import { MessageKind } from "@/common/LoggerService";
import { parseBlock, parseTransactions } from "@/common/types";
import { LogFilter } from "@/config/logFilters";
import { QueueError } from "@/errors/queue";

import { BackfillService } from "./BackfillService";

export type BlockBackfillTask = {
  blockNumberToCacheFrom: number;
  blockNumber: number;
  requiredTxHashes: Set<Hash>;
};

export type BlockBackfillWorkerContext = {
  backfillService: BackfillService;
  logFilter: LogFilter;
};

export type BlockBackfillQueue = Queue<BlockBackfillTask>;

export const createBlockBackfillQueue = (
  context: BlockBackfillWorkerContext
) => {
  const queue = createQueue({
    worker: blockBackfillWorker,
    context,
    options: {
      concurrency: 10,
    },
  });

  // Pass queue events on to service layer.
  queue.on("add", () => {
    context.backfillService.emit("blockTasksAdded", {
      name: context.logFilter.name,
      count: 1,
    });
  });

  queue.on("error", ({ error }) => {
    context.backfillService.emit("blockTaskFailed", {
      name: context.logFilter.name,
      error,
    });
  });

  queue.on("completed", () => {
    context.backfillService.emit("blockTaskCompleted", {
      name: context.logFilter.name,
    });
  });

  // Default to a simple retry.
  queue.on("error", ({ task, error }) => {
    const queueError = new QueueError({
      queueName: "Block backfill queue",
      task: task,
      cause: error,
    });
    context.backfillService.resources.logger.logMessage(
      MessageKind.ERROR,
      queueError.message
    );

    queue.addTask(task);
  });

  return queue;
};

const blockBackfillWorker: Worker<
  BlockBackfillTask,
  BlockBackfillWorkerContext
> = async ({ task, context }) => {
  const { blockNumber, requiredTxHashes, blockNumberToCacheFrom } = task;
  const { backfillService, logFilter } = context;
  const { client } = logFilter.network;

  const rawBlock = await client.getBlock({
    blockNumber: BigInt(blockNumber),
    includeTransactions: true,
  });

  const block = parseBlock(rawBlock);

  // If the log is pending, log a warning.
  if (!block) {
    backfillService.resources.logger.logMessage(
      MessageKind.WARNING,
      `Received unexpected pending block (blockNumber: ${blockNumber})`
    );
    return;
  }

  const allTransactions = parseTransactions(
    block.transactions as ViemTransaction[]
  );

  // If any pending transactions were present in the block, log a warning.
  if (allTransactions.length !== block.transactions.length) {
    backfillService.resources.logger.logMessage(
      MessageKind.WARNING,
      `Received unexpected pending transactions in block (blockNumber: ${blockNumber}, count: ${
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
    backfillService.resources.cacheStore.insertBlock(block),
    backfillService.resources.cacheStore.insertTransactions(transactions),
    backfillService.resources.cacheStore.insertLogFilterCachedRange({
      range: {
        filterKey: logFilter.filter.key,
        startBlock: blockNumberToCacheFrom,
        endBlock: blockNumber,
        endBlockTimestamp: Number(block.timestamp),
      },
    }),
  ]);

  backfillService.emit("eventsAdded");
};
