import type { Block, Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import type fastq from "fastq";

import { logger } from "@/common/logger";
import { CacheStore } from "@/stores/baseCacheStore";

import { LogGroup } from "./executeLogs";
import { BlockWithTransactions, TransactionWithHash } from "./fetchBlock";

export const createNewFilter = async (
  cacheStore: CacheStore,
  logGroup: LogGroup,
  logQueue: fastq.queueAsPromised
) => {
  const { provider, contracts, chainId } = logGroup;

  const latestBlock = await provider.getBlock("latest");
  const filterStartBlock = latestBlock.number;

  const filterId: string = await provider.send("eth_newFilter", [
    {
      fromBlock: BigNumber.from(filterStartBlock).toHexString(),
      address: contracts,
    },
  ]);

  // TODO: Fix suspected issue where if the user starts and then stops using a given provider/chainId
  // during hot reloading, the stale provider's listeners never get un-registered.
  provider.removeAllListeners("block");

  const blockHandler = async (blockNumber: number) => {
    const [logs, block] = await Promise.all([
      provider.send("eth_getFilterChanges", [filterId]) as Promise<Log[]>,
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

    logs.forEach(logQueue.push);

    // Add the logs and update metadata.
    await Promise.all(
      logs.map(async (log) => {
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
  };

  provider.on("block", blockHandler);

  return { filterStartBlock };
};
