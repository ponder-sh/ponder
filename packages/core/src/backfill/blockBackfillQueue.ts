import { Hash, Transaction as ViemTransaction } from "viem";

import { createQueue, Queue } from "@/common/createQueue";
import { MessageKind } from "@/common/LoggerService";
import { parseBlock, parseTransactions } from "@/common/types";
import type { Contract } from "@/config/contracts";

import { BackfillService } from "./BackfillService";

export type BlockBackfillTask = {
  blockHash: Hash;
  requiredTxHashes: Set<Hash>;
  onSuccess: (arg: { blockHash: Hash }) => Promise<void>;
};

export type BlockBackfillWorkerContext = {
  backfillService: BackfillService;
  contract: Contract;
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
      contract: context.contract.name,
      count: 1,
    });
  });

  queue.on("error", ({ error }) => {
    context.backfillService.emit("blockTaskFailed", {
      contract: context.contract.name,
      error,
    });
  });

  queue.on("completed", () => {
    context.backfillService.emit("blockTaskCompleted", {
      contract: context.contract.name,
    });
  });

  // Default to a simple retry.
  queue.on("error", ({ task }) => {
    queue.addTask(task);
  });

  return queue;
};

async function blockBackfillWorker({
  task,
  context,
}: {
  task: BlockBackfillTask;
  context: BlockBackfillWorkerContext;
}) {
  const { blockHash, requiredTxHashes, onSuccess } = task;
  const { backfillService, contract } = context;
  const { client } = contract.network;

  const rawBlock = await client.getBlock({
    blockHash: blockHash,
    includeTransactions: true,
  });

  const block = parseBlock(rawBlock);

  // If the log is pending, log a warning.
  if (!block) {
    backfillService.resources.logger.logMessage(
      MessageKind.WARNING,
      `Received unexpected pending block (hash: ${blockHash})`
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
      `Received unexpected pending transactions in block (hash: ${blockHash}, count: ${
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
  ]);

  await onSuccess({ blockHash });
}
