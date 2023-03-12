import fastq from "fastq";
import { Hash, Transaction as ViemTransaction } from "viem";

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

export type BlockFrontfillQueue = fastq.queueAsPromised<BlockFrontfillTask>;

export const createBlockFrontfillQueue = ({
  frontfillService,
  network,
}: BlockFrontfillWorkerContext) => {
  const queue = fastq.promise<BlockFrontfillWorkerContext, BlockFrontfillTask>(
    { frontfillService, network },
    blockFrontfillWorker,
    10 // TODO: Make this configurable
  );

  queue.error((err, task) => {
    if (err) {
      frontfillService.emit("blockTaskFailed", {
        network: network.name,
        error: err,
      });
      queue.unshift(task);
    }
  });

  return queue;
};

async function blockFrontfillWorker(
  this: BlockFrontfillWorkerContext,
  { blockHash, requiredTxHashes, onSuccess }: BlockFrontfillTask
) {
  const { frontfillService, network } = this;
  const { client } = network;

  const rawBlock = await client.getBlock({
    blockHash: blockHash,
    includeTransactions: true,
  });

  const block = parseBlock(rawBlock);

  // If the block is pending, log a warning.
  if (!block) {
    this.frontfillService.resources.logger.logMessage(
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
    this.frontfillService.resources.logger.logMessage(
      MessageKind.WARNING,
      `Received unexpected pending transactions in block (hash: ${blockHash}, count: ${
        block.transactions.length - allTransactions.length
      })`
    );
    return;
  }

  // Filter down to only required transactions (transactions that emitted events we care about).
  const transactions = allTransactions.filter((txn) =>
    requiredTxHashes.has(txn.hash)
  );

  await Promise.all([
    frontfillService.resources.cacheStore.insertBlock(block),
    frontfillService.resources.cacheStore.insertTransactions(transactions),
  ]);

  frontfillService.emit("blockTaskCompleted", { network: network.name });

  await onSuccess({ block });
}
