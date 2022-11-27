import fastq from "fastq";

import { logger } from "@/common/logger";
import { parseBlock, parseTransaction } from "@/db/cache/utils";
import type { Ponder } from "@/Ponder";
import type { Source } from "@/sources/base";

export type BlockBackfillTask = {
  blockHash: string;
  requiredTxnHashes: string[];
  onSuccess: (blockHash: string) => Promise<void>;
};

export type BlockBackfillWorkerContext = {
  ponder: Ponder;
  source: Source;
};

export type BlockBackfillQueue = fastq.queueAsPromised<BlockBackfillTask>;

export const createBlockBackfillQueue = ({
  ponder,
  source,
}: BlockBackfillWorkerContext) => {
  // Queue for fetching historical blocks and transactions.
  const queue = fastq.promise<BlockBackfillWorkerContext, BlockBackfillTask>(
    { ponder, source },
    blockBackfillWorker,
    10 // TODO: Make this configurable
  );

  queue.error((err, task) => {
    if (err) {
      logger.error("Error in block backfill worker, retrying...:");
      logger.error({ task, err });
      queue.unshift(task);
    }
  });

  return queue;
};

async function blockBackfillWorker(
  this: BlockBackfillWorkerContext,
  { blockHash, requiredTxnHashes, onSuccess }: BlockBackfillTask
) {
  const { ponder, source } = this;
  const { provider } = source.network;

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
  ponder.emit("backfillTaskCompleted");
}
