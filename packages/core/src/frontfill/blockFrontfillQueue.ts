import { utils } from "ethers";
import fastq from "fastq";

import { Network } from "@/config/contracts";
import { parseBlock, parseLog, parseTransaction } from "@/db/cache/utils";

import { FrontfillService } from "./FrontfillService";

export type BlockFrontfillTask = {
  blockNumber: number;
};

export type BlockFrontfillWorkerContext = {
  frontfillService: FrontfillService;
  network: Network;
  contractAddresses: string[];
};

export type BlockFrontfillQueue = fastq.queueAsPromised<BlockFrontfillTask>;

export const createBlockFrontfillQueue = ({
  frontfillService,
  network,
  contractAddresses,
}: BlockFrontfillWorkerContext) => {
  // Queue for fetching live blocks, transactions, and.
  const queue = fastq.promise<BlockFrontfillWorkerContext, BlockFrontfillTask>(
    { frontfillService, network, contractAddresses },
    blockFrontfillWorker,
    1
  );

  queue.error((err, task) => {
    if (err) {
      frontfillService.emit("taskFailed", {
        network: network.name,
        error: err,
      });
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
  const { frontfillService, network, contractAddresses } = this;
  const { provider } = network;

  const [rawLogs, rawBlock] = await Promise.all([
    provider.send("eth_getLogs", [
      {
        address: contractAddresses,
        fromBlock: utils.hexValue(blockNumber),
        toBlock: utils.hexValue(blockNumber),
      },
    ]),
    provider.send("eth_getBlockByNumber", [utils.hexValue(blockNumber), true]),
  ]);

  const block = parseBlock(rawBlock);
  const logs = (rawLogs as unknown[]).map(parseLog);

  const requiredTxnHashSet = new Set(logs.map((l) => l.transactionHash));

  // Filter out pending transactions (this might not be necessary?).
  const transactions = (rawBlock.transactions as any[])
    .filter((txn) => !!txn.hash)
    .filter((txn) => requiredTxnHashSet.has(txn.hash))
    .map(parseTransaction);

  await Promise.all([
    frontfillService.resources.cacheStore.insertLogs(logs),
    frontfillService.resources.cacheStore.insertTransactions(transactions),
  ]);

  // Must insert the block AFTER the logs to make sure log.blockTimestamp gets updated.
  await frontfillService.resources.cacheStore.insertBlock(block);

  await Promise.all(
    contractAddresses.map((contractAddress) =>
      frontfillService.resources.cacheStore.insertCachedInterval({
        contractAddress,
        startBlock: block.number,
        endBlock: block.number,
        endBlockTimestamp: block.timestamp,
      })
    )
  );

  frontfillService.emit("newEventsAdded", {
    network: network.name,
    blockNumber: block.number,
    blockTimestamp: block.timestamp,
    blockTxnCount: rawBlock.transactions.length,
    matchedLogCount: logs.length,
  });
}
