import { Hash, Transaction as ViemTransaction } from "viem";

import { createQueue, Queue } from "@/common/createQueue";
import { MessageKind } from "@/common/LoggerService";
import { Block, parseBlock, parseTransactions } from "@/common/types";
import type { Network } from "@/config/contracts";

import { FrontfillService } from "./FrontfillService";

export type BlockFrontfillTask = {
  blockHash: Hash;
  requiredTxHashes: Set<Hash>;
  onSuccess: (args: { block: Block }) => Promise<void>;
};

export type BlockFrontfillWorkerContext = {
  frontfillService: FrontfillService;
  network: Network;
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
      network: context.network.name,
      count: 1,
    });
  });

  queue.on("error", ({ error }: { error: Error }) => {
    context.frontfillService.emit("blockTaskFailed", {
      network: context.network.name,
      error,
    });
  });

  queue.on("completed", () => {
    context.frontfillService.emit("blockTaskCompleted", {
      network: context.network.name,
    });
  });

  // Default to a simple retry.
  queue.on("error", ({ task }: { task: BlockFrontfillTask }) => {
    queue.addTask(task);
  });

  return queue;
};

async function blockFrontfillWorker({
  task,
  context,
}: {
  task: BlockFrontfillTask;
  context: BlockFrontfillWorkerContext;
}) {
  const { blockHash, requiredTxHashes, onSuccess } = task;
  const { frontfillService, network } = context;
  const { client } = network;

  const rawBlock = await client.getBlock({
    blockHash: blockHash,
    includeTransactions: true,
  });

  const block = parseBlock(rawBlock);

  // If the block is pending, log a warning.
  if (!block) {
    frontfillService.resources.logger.logMessage(
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
    frontfillService.resources.logger.logMessage(
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
    frontfillService.resources.cacheStore.insertBlock(block),
    frontfillService.resources.cacheStore.insertTransactions(transactions),
  ]);

  await onSuccess({ block });
}
