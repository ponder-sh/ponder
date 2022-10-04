import type { Block, JsonRpcProvider } from "@ethersproject/providers";
import type { Transaction } from "ethers";

import type { BlockRequestWorkerContext } from "./executeLogs";
import { reindexStatistics } from "./reindex";

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

export async function blockRequestWorker(
  this: BlockRequestWorkerContext,
  { blockHash, provider }: BlockRequest
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
