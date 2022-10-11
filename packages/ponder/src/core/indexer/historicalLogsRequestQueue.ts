import type { Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { CacheStore } from "@/stores/baseCacheStore";

import type { SourceGroup } from "./reindex";
import { reindexStatistics } from "./reindex";

export type HistoricalLogsRequestTask = {
  contractAddresses: string[];
  fromBlock: number;
  toBlock: number;
};

export type HistoricalLogsRequestWorkerContext = {
  cacheStore: CacheStore;
  sourceGroup: SourceGroup;
  historicalBlockRequestQueue: fastq.queueAsPromised;
};

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
      queue.push(task);
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

  const logs: Log[] = await provider.send("eth_getLogs", [
    {
      address: contractAddresses,
      fromBlock: BigNumber.from(fromBlock).toHexString(),
      toBlock: BigNumber.from(toBlock).toHexString(),
    },
  ]);

  reindexStatistics.logRequestCount += 1;
  const requestCount =
    reindexStatistics.logRequestCount + reindexStatistics.blockRequestCount;
  if (requestCount % 10 === 0) {
    logger.info(
      `\x1b[34m${`${requestCount} RPC requests completed`}\x1b[0m` // blue
    );
  }

  await Promise.all(
    logs.map(async (log) => {
      await cacheStore.upsertLog(log);
    })
  );

  for (const contractAddress of contractAddresses) {
    const foundContractMetadata = await cacheStore.getContractMetadata(
      contractAddress
    );

    if (foundContractMetadata) {
      await cacheStore.upsertContractMetadata({
        contractAddress,
        startBlock: Math.min(foundContractMetadata.startBlock, fromBlock),
        endBlock: Math.max(foundContractMetadata.endBlock, toBlock),
      });
    } else {
      await cacheStore.upsertContractMetadata({
        contractAddress,
        startBlock: fromBlock,
        endBlock: toBlock,
      });
    }
  }

  // Enqueue requests to fetch the block & transaction associated with each log.
  const uniqueBlockHashes = [...new Set(logs.map((l) => l.blockHash))];
  uniqueBlockHashes.forEach((blockHash) => {
    historicalBlockRequestQueue.push({
      blockHash,
      provider,
    });
  });
}
