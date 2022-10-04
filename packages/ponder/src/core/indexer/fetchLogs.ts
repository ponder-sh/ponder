import type { JsonRpcProvider, Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";

import type { LogRequestWorkerContext } from "./executeLogs";
import { reindexStatistics } from "./reindex";

export type LogRequest = {
  contractAddresses: string[];
  fromBlock: number;
  toBlock: number;
  provider: JsonRpcProvider;
};

export async function logRequestWorker(
  this: LogRequestWorkerContext,
  { contractAddresses, fromBlock, toBlock, provider }: LogRequest
) {
  const { cacheStore, blockRequestQueue } = this;

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
    blockRequestQueue.push({
      blockHash,
      provider,
    });
  });
}
