import type { Block, Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { CacheStore } from "@/stores/baseCacheStore";

import type {
  BlockWithTransactions,
  TransactionWithHash,
} from "./historicalBlockRequestQueue";
import type { SourceGroup } from "./reindex";

export type LiveBlockRequestTask = {
  sourceGroup: SourceGroup;
  blockNumber: number;
};

export type LiveBlockRequestWorkerContext = {
  cacheStore: CacheStore;
  logQueue: fastq.queueAsPromised;
};

export const createLiveBlockRequestQueue = ({
  cacheStore,
  logQueue,
}: LiveBlockRequestWorkerContext) => {
  // Queue for fetching historical blocks and transactions.
  return fastq.promise<LiveBlockRequestWorkerContext, LiveBlockRequestTask>(
    { cacheStore, logQueue },
    liveBlockRequestWorker,
    1
  );
};

// This worker is responsible for ensuring that the block, its transactions, and any
// logs for the logGroup within that block are written to the cacheStore.
// It then enqueues a task to process the block (using user handler code).
async function liveBlockRequestWorker(
  this: LiveBlockRequestWorkerContext,
  { sourceGroup, blockNumber }: LiveBlockRequestTask
) {
  const { cacheStore, logQueue } = this;
  const { provider, chainId, contracts } = sourceGroup;

  const [logs, block] = await Promise.all([
    provider.send("eth_getLogs", [
      {
        address: contracts,
        fromBlock: BigNumber.from(blockNumber).toHexString(),
        toBlock: BigNumber.from(blockNumber).toHexString(),
      },
    ]) as Promise<Log[]>,
    provider.send("eth_getBlockByNumber", [
      BigNumber.from(blockNumber).toHexString(),
      true,
    ]) as Promise<BlockWithTransactions>,
  ]);

  logger.debug({
    chainId,
    blockNumber,
    matchedLogCount: logs.length,
    blockTransactionCount: block.transactions.length,
  });

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
    `\x1b[34m${`FETCHED ${logs.length} LOGS FROM BLOCK ${blockNumber}`}\x1b[0m` // blue
  );

  const getLogIndex = (log: Log) =>
    Number(log.blockNumber) * 10000 + Number(log.logIndex);
  const sortedLogs = logs.sort((a, b) => getLogIndex(a) - getLogIndex(b));

  // Add the logs and update metadata.
  await Promise.all(
    sortedLogs.map(async (log) => {
      await cacheStore.upsertLog(log);
    })
  );

  for (const contractAddress of contracts) {
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

  // Add the logs to the log queue.
  for (let i = sortedLogs.length - 1; i >= 0; i--) {
    const log = sortedLogs[i];
    logQueue.unshift(log);
  }
}
