import { BigNumber } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import { parseBlock, parseLog, parseTransaction } from "@/db/cache/utils";
import type { Network } from "@/networks/base";
import type { Ponder } from "@/Ponder";

export type BlockFrontfillTask = {
  blockNumber: number;
};

export type BlockFrontfillWorkerContext = {
  ponder: Ponder;
  network: Network;
  contractAddresses: string[];
};

export type BlockFrontfillQueue = fastq.queueAsPromised<BlockFrontfillTask>;

export const createBlockFrontfillQueue = ({
  ponder,
  network,
  contractAddresses,
}: BlockFrontfillWorkerContext) => {
  // Queue for fetching live blocks, transactions, and.
  const queue = fastq.promise<BlockFrontfillWorkerContext, BlockFrontfillTask>(
    { ponder, network, contractAddresses },
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
  const { ponder, network, contractAddresses } = this;
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
  const logs = (rawLogs as unknown[]).map(parseLog);

  const requiredTxnHashSet = new Set(logs.map((l) => l.transactionHash));

  // Filter out pending transactions (this might not be necessary?).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transactions = (rawBlock.transactions as any[])
    .filter((txn) => !!txn.hash)
    .filter((txn) => requiredTxnHashSet.has(txn.hash))
    .map(parseTransaction);

  await Promise.all([
    ponder.cacheStore.insertLogs(logs),
    ponder.cacheStore.insertTransactions(transactions),
  ]);

  // Must insert the block AFTER the logs to make sure log.blockTimestamp gets updated.
  await ponder.cacheStore.insertBlock(block);

  await Promise.all(
    contractAddresses.map((contractAddress) =>
      ponder.cacheStore.insertCachedInterval({
        contractAddress,
        startBlock: block.number,
        endBlock: block.number,
        endBlockTimestamp: block.timestamp,
      })
    )
  );

  ponder.emit("newFrontfillLogs", {
    network: network.name,
    blockNumber: block.number,
    blockTimestamp: block.timestamp,
    blockTxnCount: rawBlock.transactions.length,
    matchedLogCount: logs.length,
  });
}
