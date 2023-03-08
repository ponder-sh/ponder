import fastq from "fastq";
import { Hash } from "viem";

import { MessageKind } from "@/common/LoggerService";
import { Network } from "@/config/contracts";
import { parseBlock, parseLogs, parseTransactions } from "@/common/types";

import { FrontfillService } from "./FrontfillService";

export type BlockFrontfillTask = {
  blockNumber: number;
};

export type BlockFrontfillWorkerContext = {
  frontfillService: FrontfillService;
  network: Network;
  contractAddresses: Hash[];
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
  const { client } = network;

  const [rawLogs, rawBlock] = await Promise.all([
    client.getLogs({
      address: contractAddresses,
      fromBlock: BigInt(blockNumber),
      toBlock: BigInt(blockNumber),
    }),
    client.getBlock({
      blockNumber: BigInt(blockNumber),
      includeTransactions: true,
    }),
  ]);

  const block = parseBlock<"includeTransactions">(rawBlock);
  const logs = parseLogs(rawLogs);

  // If the log is pending, log a warning.
  if (!block) {
    this.frontfillService.resources.logger.logMessage(
      MessageKind.WARNING,
      `Received unexpected pending block (number: ${blockNumber})`
    );
    return;
  }

  // If any pending logs were present in the response, log a warning.
  if (logs.length !== rawLogs.length) {
    this.frontfillService.resources.logger.logMessage(
      MessageKind.WARNING,
      `Received unexpected pending logs (count: ${
        logs.length - rawLogs.length
      })`
    );
  }

  const requiredTxHashSet = new Set(logs.map((l) => l.transactionHash));

  const allTransactions = parseTransactions(block.transactions);

  // If any pending transactions were present in the block, log a warning.
  if (allTransactions.length !== block.transactions.length) {
    this.frontfillService.resources.logger.logMessage(
      MessageKind.WARNING,
      `Received unexpected pending transactions in block (number: ${blockNumber}, count: ${
        block.transactions.length - allTransactions.length
      })`
    );
    return;
  }

  // Filter down to only required transactions (transactions that emitted events we care about).
  const transactions = allTransactions.filter((txn) =>
    requiredTxHashSet.has(txn.hash)
  );

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
        startBlock: Number(block.number),
        endBlock: Number(block.number),
        endBlockTimestamp: Number(block.timestamp),
      })
    )
  );

  frontfillService.emit("taskCompleted", {
    network: network.name,
    blockNumber: Number(block.number),
    blockTimestamp: Number(block.timestamp),
    blockTxCount: allTransactions.length,
    matchedLogCount: logs.length,
  });

  if (logs.length > 0) {
    frontfillService.emit("eventsAdded", {
      count: logs.length,
    });
  }
}
