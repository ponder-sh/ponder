import { BigNumber } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { CacheStore } from "@/db/cacheStore";
import { parseBlock, parseLog, parseTransaction } from "@/db/utils";
import type { Network } from "@/networks/base";

import type { HandlerQueue } from "./handlerQueue";

export type BlockFrontfillTask = {
  blockNumber: number;
};

export type BlockFrontfillWorkerContext = {
  cacheStore: CacheStore;
  network: Network;
  contractAddresses: string[];
  handlerQueue: HandlerQueue;
};

export type BlockFrontfillQueue = fastq.queueAsPromised<BlockFrontfillTask>;

export const createBlockFrontfillQueue = ({
  cacheStore,
  network,
  contractAddresses,
  handlerQueue,
}: BlockFrontfillWorkerContext) => {
  // Queue for fetching live blocks, transactions, and.
  const queue = fastq.promise<BlockFrontfillWorkerContext, BlockFrontfillTask>(
    { cacheStore, network, contractAddresses, handlerQueue },
    blockFrontfillWorker,
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
async function blockFrontfillWorker(
  this: BlockFrontfillWorkerContext,
  { blockNumber }: BlockFrontfillTask
) {
  const { cacheStore, network, contractAddresses, handlerQueue } = this;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const logs = (rawLogs as any[]).map(parseLog);

  const requiredTxnHashSet = new Set(logs.map((l) => l.transactionHash));

  // Filter out pending transactions (this might not be necessary?).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transactions = (rawBlock.transactions as any[])
    .filter((txn) => !!txn.hash)
    .filter((txn) => requiredTxnHashSet.has(txn.to))
    .map(parseTransaction);

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
    handlerQueue.push({ log });
  }
}
