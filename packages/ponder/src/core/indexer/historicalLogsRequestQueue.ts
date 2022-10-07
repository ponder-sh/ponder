import type { JsonRpcProvider, Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import fastq from "fastq";

import { CacheStore } from "@/stores/baseCacheStore";

import { reindexStatistics } from "./reindex";

export type HistoricalLogsRequestTask = {
  contractAddresses: string[];
  fromBlock: number;
  toBlock: number;
  provider: JsonRpcProvider;
};

export type HistoricalLogsRequestWorkerContext = {
  cacheStore: CacheStore;
  historicalBlockRequestQueue: fastq.queueAsPromised;
};

export const createHistoricalLogsRequestQueue = ({
  cacheStore,
  historicalBlockRequestQueue,
}: HistoricalLogsRequestWorkerContext) => {
  // Queue for fetching historical blocks and transactions.
  return fastq.promise<
    HistoricalLogsRequestWorkerContext,
    HistoricalLogsRequestTask
  >(
    { cacheStore, historicalBlockRequestQueue },
    historicalLogsRequestWorker,
    1
  );
};

async function historicalLogsRequestWorker(
  this: HistoricalLogsRequestWorkerContext,
  { contractAddresses, fromBlock, toBlock, provider }: HistoricalLogsRequestTask
) {
  const { cacheStore, historicalBlockRequestQueue } = this;

  const logs: Log[] = await provider.send("eth_getLogs", [
    {
      address: contractAddresses,
      fromBlock: BigNumber.from(fromBlock).toHexString(),
      toBlock: BigNumber.from(toBlock).toHexString(),
    },
  ]);

  reindexStatistics.logRequestCount += 1;

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
