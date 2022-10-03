import type { Block, Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import type fastq from "fastq";

import { logger } from "@/common/logger";

import { cacheStore } from "./cacheStore";
import { LogGroup } from "./executeLogs";
import { BlockWithTransactions, TransactionWithHash } from "./fetchBlock";

// const blockHandlers: { [key: string]: () => Promise<void> | undefined } = {};

export const createNewFilter = async (
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

  const blockHandler = async (blockNumber: number) => {
    const [logs, block] = await Promise.all([
      provider.send("eth_getFilterChanges", [filterId]) as Promise<Log[]>,
      provider.send("eth_getBlockByNumber", [
        BigNumber.from(blockNumber).toHexString(),
        true,
      ]) as Promise<BlockWithTransactions>,
    ]);

    logger.warn({
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

    logs.forEach(logQueue.push);
  };

  provider.on("block", blockHandler);

  return { filterStartBlock };
};
