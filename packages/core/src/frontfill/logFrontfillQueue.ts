import fastq from "fastq";
import { Hash, Log as ViemLog } from "viem";

import { MessageKind } from "@/common/LoggerService";
import { Block, parseLogs } from "@/common/types";
import { Network } from "@/config/contracts";

import { BlockFrontfillQueue } from "./blockFrontfillQueue";
import { FrontfillService } from "./FrontfillService";

export type FrontfillTask = {
  logs: ViemLog[];
};

export type LogFrontfillWorkerContext = {
  frontfillService: FrontfillService;
  network: Network;
  contractAddresses: Hash[];
  blockFrontfillQueue: BlockFrontfillQueue;
};

export type LogFrontfillQueue = fastq.queueAsPromised<FrontfillTask>;

export const createLogFrontfillQueue = ({
  frontfillService,
  network,
  contractAddresses,
  blockFrontfillQueue,
}: LogFrontfillWorkerContext) => {
  const queue = fastq.promise<LogFrontfillWorkerContext, FrontfillTask>(
    { frontfillService, network, contractAddresses, blockFrontfillQueue },
    logFrontfillWorker,
    1
  );

  queue.error((err, task) => {
    if (err) {
      frontfillService.emit("logTaskFailed", {
        network: network.name,
        error: err,
      });
      queue.unshift(task);
    }
  });

  return queue;
};

// This worker stores the new logs recieved from `eth_getFilterChanges`,
// then enqueues tasks to fetch the block (and transaction) for each log.
async function logFrontfillWorker(
  this: LogFrontfillWorkerContext,
  { logs: rawLogs }: FrontfillTask
) {
  const { frontfillService, network, contractAddresses, blockFrontfillQueue } =
    this;

  const logs = parseLogs(rawLogs);

  // If any pending logs were present in the response, log a warning.
  if (logs.length !== rawLogs.length) {
    this.frontfillService.resources.logger.logMessage(
      MessageKind.WARNING,
      `Received unexpected pending logs (count: ${
        logs.length - rawLogs.length
      })`
    );
  }

  await frontfillService.resources.cacheStore.insertLogs(logs);

  const requiredBlockHashes = [...new Set(logs.map((l) => l.blockHash))];
  const txHashesByBlockHash = logs.reduce<Record<Hash, Set<Hash>>>(
    (acc, log) => {
      acc[log.blockHash] ||= new Set<Hash>();
      acc[log.blockHash].add(log.transactionHash);
      return acc;
    },
    {}
  );

  // The block request worker calls the `onSuccess` callback when it finishes. This serves as
  // a hacky way to run some code when all "child" jobs are done. In this case,
  // we want to update the contract metadata to store that this block range has been cached.
  const completedBlocks: Block[] = [];

  const onSuccess = async ({ block }: { block: Block }) => {
    completedBlocks.push(block);

    if (completedBlocks.length === requiredBlockHashes.length) {
      const endBlock = completedBlocks.sort((a, b) =>
        a.number < b.number ? -1 : a.number > b.number ? 1 : 0
      )[completedBlocks.length - 1];

      // Get the previous endBlock and set this as the startBlock for caching.
      const fromBlockNumber = this.frontfillService.liveNetworks.find(
        (n) => n.network.name === network.name
      )!.currentBlockNumber;

      await Promise.all(
        contractAddresses.map((contractAddress) =>
          frontfillService.resources.cacheStore.insertCachedInterval({
            contractAddress,
            startBlock: fromBlockNumber,
            endBlock: Number(endBlock.number),
            endBlockTimestamp: Number(endBlock.timestamp),
          })
        )
      );

      // Set new current block number to the endBlock from this batch.
      this.frontfillService.liveNetworks[
        this.frontfillService.liveNetworks.findIndex(
          (n) => n.network.name === network.name
        )
      ].currentBlockNumber = Number(endBlock.number);

      // Send an event to process the logs fetched in this batch.
      frontfillService.emit("eventsAdded", { count: logs.length });
    }
  };

  requiredBlockHashes.forEach((blockHash) => {
    blockFrontfillQueue.push({
      blockHash,
      requiredTxHashes: txHashesByBlockHash[blockHash],
      onSuccess,
    });
  });

  frontfillService.emit("blockTasksAdded", {
    network: network.name,
    count: requiredBlockHashes.length,
  });

  // Wait for the child tasks to be completed before returning from this task
  // and allowing the next log frontfill task to begin. This must be done because
  // the onSuccess callback relies on the shared `currentBlockNumber` state for the
  // network. If the next task starts before that value has been properly updated,
  // the insertCachedInterval call above will be borked. TODO: improve.
  if (!blockFrontfillQueue.idle()) {
    await blockFrontfillQueue.drained();
  }

  // This is a mapping of block number -> contract address -> log count
  // that is used for logging the number of events in this batch.
  const logData = logs.reduce<Record<number, Record<string, number>>>(
    (acc, log) => {
      acc[Number(log.blockNumber)] ||= {};
      acc[Number(log.blockNumber)][log.address] ||= 0;
      acc[Number(log.blockNumber)][log.address] += 1;
      return acc;
    },
    {}
  );

  frontfillService.emit("logTaskCompleted", {
    network: network.name,
    logData,
  });
}
