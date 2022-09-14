import type { JsonRpcProvider, Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";

import { cacheStore } from "./cacheStore";
import { blockRequestQueue } from "./fetchBlock";

type LogRequest = {
  contractAddresses: string[];
  fromBlock: number;
  toBlock: number;
  provider: JsonRpcProvider;
};

let logRequestCount = 0;

export const logRequestWorker = async ({
  contractAddresses,
  fromBlock,
  toBlock,
  provider,
}: LogRequest) => {
  const logs: Log[] = await provider.send("eth_getLogs", [
    {
      address: contractAddresses,
      fromBlock: BigNumber.from(fromBlock).toHexString(),
      toBlock: BigNumber.from(toBlock).toHexString(),
    },
  ]);

  logRequestCount += 1;
  if (logRequestCount % 10 === 0) {
    logger.info(`\x1b[33m${`FETCHED ${logRequestCount} BLOCKS`}\x1b[0m`); // magenta
  }

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
