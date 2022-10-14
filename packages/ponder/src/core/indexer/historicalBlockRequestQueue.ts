import type { Block } from "@ethersproject/providers";
import type { Transaction } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { CacheStore } from "@/stores/baseCacheStore";

import type { SourceGroup } from "./reindex";
import { reindexStatistics } from "./reindex";

export interface BlockWithTransactions extends Omit<Block, "transactions"> {
  transactions: Transaction[];
}

export interface TransactionWithHash extends Omit<Transaction, "hash"> {
  hash: string;
}

export type HistoricalBlockRequestTask = {
  blockHash: string;
};

export type HistoricalBlockRequestWorkerContext = {
  cacheStore: CacheStore;
  sourceGroup: SourceGroup;
};

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
  { blockHash }: HistoricalBlockRequestTask
) {
  const { cacheStore, sourceGroup } = this;
  const { provider } = sourceGroup;

  const cachedBlock = await cacheStore.getBlock(blockHash);
  if (cachedBlock) {
    return;
  }

  const block: BlockWithTransactions = await provider.send(
    "eth_getBlockByHash",
    [blockHash, true]
  );

  reindexStatistics.blockRequestCount += 1;
  const requestCount =
    reindexStatistics.logRequestCount + reindexStatistics.blockRequestCount;
  if (requestCount % 10 === 0) {
    logger.info(
      `\x1b[34m${`${requestCount} RPC requests completed`}\x1b[0m` // blue
    );
  }

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
}
