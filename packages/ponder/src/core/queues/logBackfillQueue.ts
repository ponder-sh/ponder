import { BigNumber } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { CacheStore } from "@/db/cacheStore";
import { parseLog } from "@/db/utils";
import type { Source } from "@/sources/base";

import { stats } from "../indexer/stats";
import type { BlockBackfillQueue } from "./blockBackfillQueue";

export type LogBackfillTask = {
  contractAddresses: string[];
  fromBlock: number;
  toBlock: number;
};

export type LogBackfillWorkerContext = {
  cacheStore: CacheStore;
  source: Source;
  blockBackfillQueue: BlockBackfillQueue;
};

export type LogBackfillQueue = fastq.queueAsPromised<LogBackfillTask>;

export const createLogBackfillQueue = ({
  cacheStore,
  source,
  blockBackfillQueue,
}: LogBackfillWorkerContext) => {
  // Queue for fetching historical blocks and transactions.
  const queue = fastq.promise<LogBackfillWorkerContext, LogBackfillTask>(
    { cacheStore, source, blockBackfillQueue },
    logBackfillWorker,
    10 // TODO: Make this configurable
  );

  queue.error((err, task) => {
    if (err) {
      logger.error("Error in log backfill worker, retrying...:");
      logger.error({ task, err });
      queue.unshift(task);
    }
  });

  return queue;
};

async function logBackfillWorker(
  this: LogBackfillWorkerContext,
  { contractAddresses, fromBlock, toBlock }: LogBackfillTask
) {
  const { cacheStore, source, blockBackfillQueue } = this;
  const { provider } = source.network;

  const rawLogs = await provider.send("eth_getLogs", [
    {
      address: contractAddresses,
      fromBlock: BigNumber.from(fromBlock).toHexString(),
      toBlock: BigNumber.from(toBlock).toHexString(),
    },
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const logs = (rawLogs as any[]).map(parseLog);

  await cacheStore.insertLogs(logs);

  const requiredBlockHashSet = new Set(logs.map((l) => l.blockHash));
  const requiredBlockHashes = [...requiredBlockHashSet];

  // The block request worker calls this callback when it finishes. This serves as
  // a hacky way to run some code when all "child" jobs are done. In this case,
  // we want to update the contract metadata to store that this block range has been cached.
  const onSuccess = async (blockHash?: string) => {
    if (blockHash) requiredBlockHashSet.delete(blockHash);

    if (requiredBlockHashSet.size === 0) {
      await Promise.all(
        contractAddresses.map((contractAddress) =>
          cacheStore.insertCachedInterval({
            contractAddress,
            startBlock: fromBlock,
            endBlock: toBlock,
          })
        )
      );
    }
  };

  // If there are no required blocks, call the batch success callback manually
  // so we make sure to update the contract metadata accordingly.
  if (requiredBlockHashes.length === 0) {
    onSuccess();
  }

  requiredBlockHashes.forEach((blockHash) => {
    blockBackfillQueue.push({ blockHash, onSuccess });
  });

  stats.syncProgressBar.increment();
  stats.syncProgressBar.setTotal(
    stats.syncProgressBar.getTotal() + requiredBlockHashes.length
  );
}
