import type { Block, JsonRpcProvider } from "@ethersproject/providers";
import type { Transaction } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";

import { cacheStore } from "./cacheStore";

export interface BlockWithTransactions extends Omit<Block, "transactions"> {
  transactions: Transaction[];
}

export interface TransactionWithHash extends Omit<Transaction, "hash"> {
  hash: string;
}

export type BlockRequest = {
  blockHash: string;
  provider: JsonRpcProvider;
};

let blockRequestCount = 0;

export const blockRequestWorker = async ({
  blockHash,
  provider,
}: BlockRequest) => {
  const cachedBlock = await cacheStore.getBlock(blockHash);
  if (cachedBlock) return;

  const block: BlockWithTransactions = await provider.send(
    "eth_getBlockByHash",
    [blockHash, true]
  );

  blockRequestCount += 1;
  if (blockRequestCount % 10 === 0) {
    logger.info(`\x1b[33m${`FETCHED ${blockRequestCount} BLOCKS`}\x1b[0m`); // magenta
  }

  const transactions = block.transactions.filter(
    (txn): txn is TransactionWithHash => !!txn.hash
  );

  const blockWithoutTransactions: Block = {
    ...block,
    transactions: transactions.map((txn) => txn.hash),
  };

  await cacheStore.insertBlock(blockWithoutTransactions);

  await cacheStore.insertTransactions(transactions);
};

// Create a queue for fetching historical blocks & transactions.
export const blockRequestQueue = fastq.promise<unknown, BlockRequest>(
  blockRequestWorker,
  1
);
