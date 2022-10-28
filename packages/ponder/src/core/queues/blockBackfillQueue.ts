import fastq from "fastq";

import { logger } from "@/common/logger";
import type { CacheStore } from "@/db/cacheStore";
import { parseBlock, parseTransaction } from "@/db/utils";
import type { Source } from "@/sources/base";

import { stats } from "../tasks/stats";

export type BlockBackfillTask = {
  blockHash: string;
  onSuccess: (blockHash: string) => Promise<void>;
};

export type BlockBackfillWorkerContext = {
  cacheStore: CacheStore;
  source: Source;
};

export type BlockBackfillQueue = fastq.queueAsPromised<BlockBackfillTask>;

export const createBlockBackfillQueue = ({
  cacheStore,
  source,
}: BlockBackfillWorkerContext) => {
  // Queue for fetching historical blocks and transactions.
  const queue = fastq.promise<BlockBackfillWorkerContext, BlockBackfillTask>(
    { cacheStore, source },
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
  { blockHash, onSuccess }: BlockBackfillTask
) {
  const { cacheStore, source } = this;
  const { provider } = source.network;

  const cachedBlock = await cacheStore.getBlock(blockHash);
  if (cachedBlock) {
    await onSuccess(blockHash);
    stats.syncProgressBar.increment();
    return;
  }

  const rawBlock = await provider.send("eth_getBlockByHash", [blockHash, true]);

  const block = parseBlock(rawBlock);

  // Filter out pending transactions (this might not be necessary?).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transactions = (rawBlock.transactions as any[])
    .filter((txn) => !!txn.hash)
    .map(parseTransaction);

  await Promise.all([
    cacheStore.insertBlock(block),
    cacheStore.insertTransactions(transactions),
  ]);

  await onSuccess(blockHash);

  stats.syncProgressBar.increment();
}
