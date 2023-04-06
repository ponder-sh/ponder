import { Hash, Log as ViemLog } from "viem";

import { createQueue, Queue, Worker } from "@/common/createQueue";
import { MessageKind } from "@/common/LoggerService";
import { parseLogs } from "@/common/types";

import { BlockFrontfillQueue, BlockFrontfillTask } from "./blockFrontfillQueue";
import { FrontfillService, LogFilterGroup } from "./FrontfillService";

export type LogFrontfillTask = {
  logs: ViemLog[];
};

type LogFrontfillTaskResult = Record<number, Record<string, number>>;

export type LogFrontfillWorkerContext = {
  frontfillService: FrontfillService;
  group: LogFilterGroup;
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
      network: context.group.network.name,
      count: 1,
    });
  });

  queue.on("error", ({ error }) => {
    context.frontfillService.emit("logTaskFailed", {
      network: context.group.network.name,
      error,
    });
  });

  queue.on("completed", ({ result }) => {
    context.frontfillService.emit("logTaskCompleted", {
      network: context.group.network.name,
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
  const { frontfillService, group, blockFrontfillQueue } = context;

  const logs = parseLogs(rawLogs, { chainId: group.network.chainId });

  // If any pending logs were present in the response, log a warning.
  if (logs.length !== rawLogs.length) {
    frontfillService.resources.logger.logMessage(
      MessageKind.WARNING,
      `Received unexpected pending logs (count: ${
        logs.length - rawLogs.length
      })`
    );
  }

  // If there are no new logs, return early.
  if (logs.length === 0) return {};

  await frontfillService.resources.cacheStore.insertLogs(logs);

  const requiredBlockNumbers = [
    ...new Set(logs.map((l) => Number(l.blockNumber))),
  ];
  const txHashesByBlockNumber = logs.reduce<Record<number, Set<Hash>>>(
    (acc, log) => {
      acc[Number(log.blockNumber)] ||= new Set<Hash>();
      acc[Number(log.blockNumber)].add(log.transactionHash);
      return acc;
    },
    {}
  );

  // Get the latest block number for this log group.
  const fromBlock = frontfillService.currentBlockNumbers[group.id];

  const blockFrontfillTasks = requiredBlockNumbers.reduce<BlockFrontfillTask[]>(
    (acc, blockNumber, index) => {
      acc.push({
        blockNumber,
        previousBlockNumber:
          index === 0 ? fromBlock : acc[index - 1].blockNumber + 1,
        requiredTxHashes: txHashesByBlockNumber[blockNumber],
      });
      return acc;
    },
    []
  );

  // Wait for child tasks to be done.
  await blockFrontfillQueue.addTasks(blockFrontfillTasks);

  // Set the new current block number for this log group equal to to highest
  // block number from the new set of logs.
  const newLatestBlock = Math.max(...logs.map((l) => Number(l.blockNumber)));
  frontfillService.currentBlockNumbers[group.id] = newLatestBlock;

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
