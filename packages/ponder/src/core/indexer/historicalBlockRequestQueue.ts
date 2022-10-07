import type { Block, JsonRpcProvider } from "@ethersproject/providers";
import type { Transaction } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { CacheStore } from "@/stores/baseCacheStore";

import { reindexStatistics } from "./reindex";

export interface BlockWithTransactions extends Omit<Block, "transactions"> {
  transactions: Transaction[];
}

export interface TransactionWithHash extends Omit<Transaction, "hash"> {
  hash: string;
}

export type HistoricalBlockRequestTask = {
  blockHash: string;
  provider: JsonRpcProvider;
};

export type HistoricalBlockRequestWorkerContext = { cacheStore: CacheStore };

export const createHistoricalBlockRequestQueue = ({
  cacheStore,
}: HistoricalBlockRequestWorkerContext) => {
  // Queue for fetching historical blocks and transactions.
  const queue = fastq.promise<
    HistoricalBlockRequestWorkerContext,
    HistoricalBlockRequestTask
  >({ cacheStore }, historicalBlockRequestWorker, 1);

  queue.error((err, task) => {
    if (err) {
      logger.error("error in historical block worker:", { err, task });
    }
  });

  return queue;
};

async function historicalBlockRequestWorker(
  this: HistoricalBlockRequestWorkerContext,
  { blockHash, provider }: HistoricalBlockRequestTask
) {
  const { cacheStore } = this;

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
    logger.debug(`${requestCount} RPC requests completed`);
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
