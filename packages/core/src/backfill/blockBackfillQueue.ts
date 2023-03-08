import fastq from "fastq";
import { Hash } from "viem";

import { MessageKind } from "@/common/LoggerService";
import type { Contract } from "@/config/contracts";
import { parseBlock, parseTransactions } from "@/common/types";

import { BackfillService } from "./BackfillService";

export type BlockBackfillTask = {
  blockHash: Hash;
  requiredTxHashes: Hash[];
  onSuccess: (blockHash: Hash) => Promise<void>;
};

export type BlockBackfillWorkerContext = {
  backfillService: BackfillService;
  contract: Contract;
};

export type BlockBackfillQueue = fastq.queueAsPromised<BlockBackfillTask>;

export const createBlockBackfillQueue = ({
  backfillService,
  contract,
}: BlockBackfillWorkerContext) => {
  // Queue for fetching historical blocks and transactions.
  const queue = fastq.promise<BlockBackfillWorkerContext, BlockBackfillTask>(
    { backfillService, contract },
    blockBackfillWorker,
    10 // TODO: Make this configurable
  );

  queue.error((err, task) => {
    if (err) {
      backfillService.emit("blockTaskFailed", {
        contract: contract.name,
        error: err,
      });
      console.log("failed task:", { task });

      queue.unshift(task);
    }
  });

  return queue;
};

async function blockBackfillWorker(
  this: BlockBackfillWorkerContext,
  { blockHash, requiredTxHashes, onSuccess }: BlockBackfillTask
) {
  const { backfillService, contract } = this;
  const { client } = contract.network;

  const rawBlock = await client.getBlock({
    blockHash: blockHash,
    includeTransactions: true,
  });

  const block = parseBlock<"includeTransactions">(rawBlock);

  // If the log is pending, log a warning.
  if (!block) {
    this.backfillService.resources.logger.logMessage(
      MessageKind.WARNING,
      `Received unexpected pending block (hash: ${blockHash})`
    );
    return;
  }

  const requiredTxHashSet = new Set(requiredTxHashes);

  const allTransactions = parseTransactions(block.transactions);

  // If any pending transactions were present in the block, log a warning.
  if (allTransactions.length !== block.transactions.length) {
    this.backfillService.resources.logger.logMessage(
      MessageKind.WARNING,
      `Received unexpected pending transactions in block (hash: ${blockHash}, count: ${
        block.transactions.length - allTransactions.length
      })`
    );
    return;
  }

  // Filter down to only required transactions (transactions that emitted events we care about).
  const transactions = allTransactions.filter((txn) =>
    requiredTxHashSet.has(txn.hash)
  );

  await Promise.all([
    backfillService.resources.cacheStore.insertBlock(block),
    backfillService.resources.cacheStore.insertTransactions(transactions),
  ]);

  await onSuccess(blockHash);
  backfillService.emit("blockTaskCompleted", { contract: contract.name });
}
