import fastq from "fastq";

import type { Contract } from "@/config/contracts";
import { parseBlock, parseTransaction } from "@/db/cache/utils";

import { BackfillService } from "./BackfillService";

export type BlockBackfillTask = {
  blockHash: string;
  requiredTxnHashes: string[];
  onSuccess: (blockHash: string) => Promise<void>;
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
      backfillService.emit("backfill_blockTaskFailed", {
        contract: contract.name,
        error: err,
      });
      queue.unshift(task);
    }
  });

  return queue;
};

async function blockBackfillWorker(
  this: BlockBackfillWorkerContext,
  { blockHash, requiredTxnHashes, onSuccess }: BlockBackfillTask
) {
  const { backfillService, contract } = this;
  const { provider } = contract.network;

  const rawBlock = await provider.send("eth_getBlockByHash", [blockHash, true]);

  const block = parseBlock(rawBlock);

  const requiredTxnHashesSet = new Set(requiredTxnHashes);

  // Filter out pending transactions (this might not be necessary?).
  const transactions = (rawBlock.transactions as any[])
    .filter((txn) => !!txn.hash)
    .filter((txn) => requiredTxnHashesSet.has(txn.hash))
    .map(parseTransaction);

  await Promise.all([
    backfillService.resources.cacheStore.insertBlock(block),
    backfillService.resources.cacheStore.insertTransactions(transactions),
  ]);

  await onSuccess(blockHash);
  backfillService.emit("backfill_blockTaskDone", { contract: contract.name });
}
