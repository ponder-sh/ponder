import type { JsonRpcProvider, Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import fastq from "fastq";

import { endBenchmark, startBenchmark } from "@/common/utils";

import { cacheStore } from "./cacheStore";
import { blockRequestQueue } from "./fetchBlock";

type LogRequest = {
  contractAddresses: string[];
  fromBlock: number;
  toBlock: number;
  provider: JsonRpcProvider;
};

export const logRequestWorker = async ({
  contractAddresses,
  fromBlock,
  toBlock,
  provider,
}: LogRequest) => {
  const hrt = startBenchmark();

  const logs: Log[] = await provider.send("eth_getLogs", [
    {
      address: contractAddresses,
      fromBlock: BigNumber.from(fromBlock).toHexString(),
      toBlock: BigNumber.from(toBlock).toHexString(),
    },
  ]);
  const logDiff = endBenchmark(hrt);
  console.log({ logDiff });

  await Promise.all(
    logs.map(async (log) => {
      await cacheStore.insertLog(log);
    })
  );

  // Enqueue requests to fetch the block & transaction associated with each log.
  const uniqueBlockHashes = [...new Set(logs.map((l) => l.blockHash))];
  uniqueBlockHashes.forEach((blockHash) => {
    blockRequestQueue.push({
      blockHash,
      provider,
    });
  });
};

// Create a queue for fetching historical blocks & transactions.
export const logRequestQueue = fastq.promise<unknown, LogRequest>(
  logRequestWorker,
  1
);
