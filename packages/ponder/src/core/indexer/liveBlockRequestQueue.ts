import { BigNumber } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { CacheStore } from "@/db/cacheStore";
import { parseBlock, parseLog, parseTransaction } from "@/db/utils";
import type { Network } from "@/networks/base";

import type { LogQueue } from "./logQueue";

export type LiveBlockRequestTask = {
  blockNumber: number;
};

export type LiveBlockRequestWorkerContext = {
  cacheStore: CacheStore;
  network: Network;
  contractAddresses: string[];
  logQueue: LogQueue;
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
// It then enqueues a task to process any matched logs from the block.
async function liveBlockRequestWorker(
  this: LiveBlockRequestWorkerContext,
  { blockNumber }: LiveBlockRequestTask
) {
  const { cacheStore, network, contractAddresses, logQueue } = this;
  const { provider } = network;

  const [rawLogs, rawBlock] = await Promise.all([
    provider.send("eth_getLogs", [
      {
        address: contractAddresses,
        fromBlock: BigNumber.from(blockNumber).toHexString(),
        toBlock: BigNumber.from(blockNumber).toHexString(),
      },
    ]),
    provider.send("eth_getBlockByNumber", [
      BigNumber.from(blockNumber).toHexString(),
      true,
    ]),
  ]);

  const block = parseBlock(rawBlock);

  // Filter out pending transactions (this might not be necessary?).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transactions = (rawBlock.transactions as any[])
    .filter((txn) => !!txn.hash)
    .map(parseTransaction);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const logs = (rawLogs as any[]).map(parseLog);

  await Promise.all([
    cacheStore.insertBlock(block),
    cacheStore.insertTransactions(transactions),
    cacheStore.insertLogs(logs),
  ]);

  await Promise.all(
    contractAddresses.map((contractAddress) =>
      cacheStore.insertCachedInterval({
        contractAddress,
        startBlock: block.number,
        endBlock: block.number,
      })
    )
  );

  logger.info(
    `\x1b[33m${`Matched ${logs.length} logs from block ${blockNumber} (${transactions.length} txns)`}\x1b[0m` // blue
  );

  const sortedLogs = logs.sort((a, b) => a.logSortKey - b.logSortKey);

  for (const log of sortedLogs) {
    logQueue.push({ log });
  }
}
