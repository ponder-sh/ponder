import type { Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { CacheStore } from "@/stores/baseCacheStore";

import type { HistoricalBlockRequestQueue } from "./historicalBlockRequestQueue";
import type { SourceGroup } from "./reindex";
import { stats } from "./stats";
import { hexStringToNumber } from "./utils";

export type HistoricalLogsRequestTask = {
  contractAddresses: string[];
  fromBlock: number;
  toBlock: number;
};

export type HistoricalLogsRequestWorkerContext = {
  cacheStore: CacheStore;
  sourceGroup: SourceGroup;
  historicalBlockRequestQueue: HistoricalBlockRequestQueue;
};

export type HistoricalLogsRequestQueue =
  fastq.queueAsPromised<HistoricalLogsRequestTask>;

export const createHistoricalLogsRequestQueue = ({
  cacheStore,
  sourceGroup,
  historicalBlockRequestQueue,
}: HistoricalLogsRequestWorkerContext) => {
  // Queue for fetching historical blocks and transactions.
  const queue = fastq.promise<
    HistoricalLogsRequestWorkerContext,
    HistoricalLogsRequestTask
  >(
    { cacheStore, sourceGroup, historicalBlockRequestQueue },
    historicalLogsRequestWorker,
    10 // TODO: Make this configurable
  );

  queue.error((err, task) => {
    if (err) {
      logger.error("error in historical log worker, retrying...:");
      logger.error({ task, err });
      queue.unshift(task);
    }
  });

  return queue;
};

async function historicalLogsRequestWorker(
  this: HistoricalLogsRequestWorkerContext,
  { contractAddresses, fromBlock, toBlock }: HistoricalLogsRequestTask
) {
  const { cacheStore, sourceGroup, historicalBlockRequestQueue } = this;
  const { provider } = sourceGroup;

  const rawLogs: Log[] = await provider.send("eth_getLogs", [
    {
      address: contractAddresses,
      fromBlock: BigNumber.from(fromBlock).toHexString(),
      toBlock: BigNumber.from(toBlock).toHexString(),
    },
  ]);

  // For MOST methods, ethers returns block numbers as hex strings (despite them being typed as 'number').
  // This codebase treats them as decimals, so it's easiest to just convert immediately after fetching.
  const logs = rawLogs.map((log) => ({
    ...log,
    blockNumber: hexStringToNumber(log.blockNumber),
  }));

  await Promise.all(logs.map((log) => cacheStore.upsertLog(log)));

  const requiredBlockHashes = new Set(logs.map((l) => l.blockHash));

  // The block request worker calls this callback when it finishes. This serves as
  // a hacky way to run some code when all "child" jobs are done. In this case,
  // we want to update the contract metadata to store that this block range has been cached.
  const onSuccess = async (blockHash: string) => {
    requiredBlockHashes.delete(blockHash);

    if (requiredBlockHashes.size === 0) {
      // TODO: move this to a helper that accepts (source, fromBlock, toBlock)
      // and magically updates the contract metadata accordingly, merging ranges accordingly?
      for (const contractAddress of contractAddresses) {
        const metadata = await cacheStore.getContractMetadata(contractAddress);

        if (metadata) {
          await cacheStore.upsertContractMetadata({
            contractAddress,
            startBlock: Math.min(metadata.startBlock, fromBlock),
            endBlock: Math.max(metadata.endBlock, toBlock),
          });
        } else {
          await cacheStore.upsertContractMetadata({
            contractAddress,
            startBlock: fromBlock,
            endBlock: toBlock,
          });
        }
      }
    }
  };

  [...requiredBlockHashes].forEach((blockHash) => {
    historicalBlockRequestQueue.push({ blockHash, onSuccess });
  });

  stats.progressBar.increment();
  stats.progressBar.setTotal(
    stats.progressBar.getTotal() + requiredBlockHashes.size
  );
}
