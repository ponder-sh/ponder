import fastq from "fastq";

import type { Contract } from "@/config/contracts";
import { parseBlock, parseTransaction } from "@/db/cache/utils";
import type { Ponder } from "@/Ponder";

export type BlockBackfillTask = {
  blockHash: string;
  requiredTxnHashes: string[];
  onSuccess: (blockHash: string) => Promise<void>;
};

export type BlockBackfillWorkerContext = {
  ponder: Ponder;
  contract: Contract;
};

export type BlockBackfillQueue = fastq.queueAsPromised<BlockBackfillTask>;

export const createBlockBackfillQueue = ({
  ponder,
  contract,
}: BlockBackfillWorkerContext) => {
  // Queue for fetching historical blocks and transactions.
  const queue = fastq.promise<BlockBackfillWorkerContext, BlockBackfillTask>(
    { ponder, contract },
    blockBackfillWorker,
    10 // TODO: Make this configurable
  );

  queue.error((err, task) => {
    if (err) {
      ponder.emit("backfill_blockTaskFailed", {
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
  const { ponder, contract } = this;
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
    ponder.cacheStore.insertBlock(block),
    ponder.cacheStore.insertTransactions(transactions),
  ]);

  await onSuccess(blockHash);
  ponder.emit("backfill_blockTaskDone", { contract: contract.name });
}
