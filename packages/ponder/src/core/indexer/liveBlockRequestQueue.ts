import type { Block, Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import { Network } from "@/networks/base";
import type { CacheStore } from "@/stores/baseCacheStore";

import type {
  BlockWithTransactions,
  TransactionWithHash,
} from "./historicalBlockRequestQueue";
import { getLogIndex, hexStringToNumber } from "./utils";

export type LiveBlockRequestTask = {
  blockNumber: number;
};

export type LiveBlockRequestWorkerContext = {
  cacheStore: CacheStore;
  network: Network;
  contractAddresses: string[];
  logQueue: fastq.queueAsPromised;
};

export type LiveBlockRequestQueue = fastq.queueAsPromised<LiveBlockRequestTask>;

export const createLiveBlockRequestQueue = ({
  cacheStore,
  network,
  contractAddresses,
  logQueue,
}: LiveBlockRequestWorkerContext) => {
  // Queue for fetching historical blocks and transactions.
  const queue = fastq.promise<
    LiveBlockRequestWorkerContext,
    LiveBlockRequestTask
  >(
    { cacheStore, network, contractAddresses, logQueue },
    liveBlockRequestWorker,
    1
  );

  queue.error((err, task) => {
    if (err) {
      logger.error("error in live block worker, retrying...:");
      logger.error({ task, err });
      queue.unshift(task);
    }
  });

  return queue;
};

// This worker is responsible for ensuring that the block, its transactions, and any
// logs for the logGroup within that block are written to the cacheStore.
// It then enqueues a task to process the block (using user handler code).
async function liveBlockRequestWorker(
  this: LiveBlockRequestWorkerContext,
  { blockNumber }: LiveBlockRequestTask
) {
  const { cacheStore, network, contractAddresses, logQueue } = this;
  const { provider } = network;

  const [rawLogs, block] = await Promise.all([
    provider.send("eth_getLogs", [
      {
        address: contractAddresses,
        fromBlock: BigNumber.from(blockNumber).toHexString(),
        toBlock: BigNumber.from(blockNumber).toHexString(),
      },
    ]) as Promise<Log[]>,
    provider.send("eth_getBlockByNumber", [
      BigNumber.from(blockNumber).toHexString(),
      true,
    ]) as Promise<BlockWithTransactions>,
  ]);

  // For MOST methods, ethers returns block numbers as hex strings (despite them being typed as 'number').
  // This codebase treats them as decimals, so it's easiest to just convert immediately after fetching.
  block.number = hexStringToNumber(block.number);
  const logs = rawLogs.map((log) => ({
    ...log,
    blockNumber: hexStringToNumber(log.blockNumber),
  }));

  const transactions = block.transactions.filter(
    (txn): txn is TransactionWithHash => !!txn.hash
  );

  const blockWithoutTransactions: Block = {
    ...block,
    transactions: transactions.map((txn) => txn.hash),
  };

  const cachedBlock = await cacheStore.getBlock(block.hash);
  if (!cachedBlock) {
    await Promise.all([
      cacheStore.insertBlock(blockWithoutTransactions),
      cacheStore.insertTransactions(transactions),
    ]);
  }

  logger.info(
    `\x1b[33m${`Matched ${logs.length} logs from block ${blockNumber} (${block.transactions.length} txns)`}\x1b[0m` // blue
  );

  const sortedLogs = logs.sort((a, b) => getLogIndex(a) - getLogIndex(b));

  // Add the logs and update metadata.
  await Promise.all(sortedLogs.map((log) => cacheStore.upsertLog(log)));

  for (const contractAddress of contractAddresses) {
    const foundContractMetadata = await cacheStore.getContractMetadata(
      contractAddress
    );

    if (foundContractMetadata) {
      await cacheStore.upsertContractMetadata({
        ...foundContractMetadata,
        endBlock: block.number,
      });
    } else {
      await cacheStore.upsertContractMetadata({
        contractAddress,
        startBlock: block.number,
        endBlock: block.number,
      });
    }
  }

  for (const log of sortedLogs) {
    logQueue.push(log);
  }
}
