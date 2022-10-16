import type { Block } from "@ethersproject/providers";
import type { Transaction } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { CacheStore } from "@/stores/baseCacheStore";

import type { SourceGroup } from "./reindex";
import { stats } from "./stats";
import { hexStringToNumber } from "./utils";

export interface BlockWithTransactions extends Omit<Block, "transactions"> {
  transactions: Transaction[];
}

export interface TransactionWithHash extends Omit<Transaction, "hash"> {
  hash: string;
}

export type HistoricalBlockRequestTask = {
  blockHash: string;
  onSuccess: (blockHash: string) => Promise<void>;
};

export type HistoricalBlockRequestWorkerContext = {
  cacheStore: CacheStore;
  sourceGroup: SourceGroup;
};

export type HistoricalBlockRequestQueue =
  fastq.queueAsPromised<HistoricalBlockRequestTask>;

export const createHistoricalBlockRequestQueue = ({
  cacheStore,
  sourceGroup,
}: HistoricalBlockRequestWorkerContext) => {
  // Queue for fetching historical blocks and transactions.
  const queue = fastq.promise<
    HistoricalBlockRequestWorkerContext,
    HistoricalBlockRequestTask
  >(
    { cacheStore, sourceGroup },
    historicalBlockRequestWorker,
    10 // TODO: Make this configurable
  );

  queue.error((err, task) => {
    if (err) {
      logger.error("error in historical block worker, retrying...:");
      logger.error({ task, err });
      queue.unshift(task);
    }
  });

  return queue;
};

async function historicalBlockRequestWorker(
  this: HistoricalBlockRequestWorkerContext,
  { blockHash, onSuccess }: HistoricalBlockRequestTask
) {
  const { cacheStore, sourceGroup } = this;
  const { provider } = sourceGroup;

  const cachedBlock = await cacheStore.getBlock(blockHash);
  if (cachedBlock) {
    await onSuccess(blockHash);
    stats.progressBar.increment();
    return;
  }

  const block: BlockWithTransactions = await provider.send(
    "eth_getBlockByHash",
    [blockHash, true]
  );

  // For MOST methods, ethers returns block numbers as hex strings (despite them being typed as 'number').
  // This codebase treats them as decimals, so it's easiest to just convert immediately after fetching.
  block.number = hexStringToNumber(block.number);

  const transactions = block.transactions.filter(
    (txn): txn is TransactionWithHash => !!txn.hash
  );

  const blockWithoutTransactions: Block = {
    ...block,
    transactions: transactions.map((txn) => txn.hash),
  };

  await Promise.all([
    cacheStore.insertBlock(blockWithoutTransactions),
    cacheStore.insertTransactions(transactions),
  ]);
  await onSuccess(blockHash);

  stats.progressBar.increment();
}
