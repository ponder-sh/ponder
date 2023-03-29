import { Hash, Log as ViemLog } from "viem";

import { createQueue, Queue, Worker } from "@/common/createQueue";
import { MessageKind } from "@/common/LoggerService";
import { Block, parseLogs } from "@/common/types";
import { Network } from "@/config/contracts";

import { BlockFrontfillQueue } from "./blockFrontfillQueue";
import { FrontfillService } from "./FrontfillService";

export type LogFrontfillTask = {
  logs: ViemLog[];
};

type LogFrontfillTaskResult = Record<number, Record<string, number>>;

export type LogFrontfillWorkerContext = {
  frontfillService: FrontfillService;
  network: Network;
  contractAddresses: Hash[];
  blockFrontfillQueue: BlockFrontfillQueue;
};

export type LogFrontfillQueue = Queue<LogFrontfillTask, LogFrontfillTaskResult>;

export const createLogFrontfillQueue = (context: LogFrontfillWorkerContext) => {
  const queue = createQueue({
    worker: logFrontfillWorker,
    context,
    options: {
      concurrency: 1,
    },
  });

  // Pass queue events on to service layer.
  queue.on("add", () => {
    context.frontfillService.emit("logTasksAdded", {
      network: context.network.name,
      count: 1,
    });
  });

  queue.on("error", ({ error }) => {
    context.frontfillService.emit("logTaskFailed", {
      network: context.network.name,
      error,
    });
  });

  queue.on("completed", ({ result }) => {
    context.frontfillService.emit("logTaskCompleted", {
      network: context.network.name,
      logData: result,
    });
  });

  // Default to a simple retry.
  queue.on("error", ({ task }) => {
    queue.addTask(task);
  });

  return queue;
};

// This worker stores the new logs recieved from `eth_getFilterChanges`,
// then enqueues tasks to fetch the block (and transaction) for each log.
const logFrontfillWorker: Worker<
  LogFrontfillTask,
  LogFrontfillWorkerContext,
  LogFrontfillTaskResult
> = async ({ task, context }) => {
  const { logs: rawLogs } = task;
  const { frontfillService, network, contractAddresses, blockFrontfillQueue } =
    context;

  const logs = parseLogs(rawLogs);

  // If any pending logs were present in the response, log a warning.
  if (logs.length !== rawLogs.length) {
    frontfillService.resources.logger.logMessage(
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
      const fromBlockNumber = frontfillService.liveNetworks.find(
        (n) => n.network.name === network.name
      )!.currentBlockNumber;

      await Promise.all(
        contractAddresses.map((contractAddress) =>
          frontfillService.resources.cacheStore.insertLogCacheMetadata({
            metadata: {
              filterKey: `${network.chainId}-${contractAddress}-${""}`,
              startBlock: fromBlockNumber,
              endBlock: Number(endBlock.number),
              endBlockTimestamp: Number(endBlock.timestamp),
            },
          })
        )
      );

      // Set new current block number to the endBlock from this batch.
      frontfillService.liveNetworks[
        frontfillService.liveNetworks.findIndex(
          (n) => n.network.name === network.name
        )
      ].currentBlockNumber = Number(endBlock.number);

      // Send an event to process the logs fetched in this batch.
      frontfillService.emit("eventsAdded", { count: logs.length });
    }
  };

  const blockTasks = requiredBlockHashes.map((blockHash) => ({
    blockHash,
    requiredTxHashes: txHashesByBlockHash[blockHash],
    onSuccess,
  }));
  blockFrontfillQueue.addTasks(blockTasks);

  // Wait for the child tasks to be completed before returning from this task
  // and allowing the next log frontfill task to begin. This must be done because
  // the onSuccess callback relies on the shared `currentBlockNumber` state for the
  // network. If the next task starts before that value has been properly updated,
  // the insertCachedInterval call above will be borked. TODO: improve.
  await blockFrontfillQueue.onIdle();

  // This is a mapping of block number -> contract address -> log count
  // that is used for logging the number of events in this batch.
  return logs.reduce<Record<number, Record<string, number>>>((acc, log) => {
    acc[Number(log.blockNumber)] ||= {};
    acc[Number(log.blockNumber)][log.address] ||= 0;
    acc[Number(log.blockNumber)][log.address] += 1;
    return acc;
  }, {});
};
