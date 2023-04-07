import { Hash, HttpRequestError, InvalidParamsRpcError } from "viem";

import { createQueue, Queue, Worker } from "@/common/createQueue";
import { MessageKind } from "@/common/LoggerService";
import { parseLogs } from "@/common/types";
import { LogFilter } from "@/config/logFilters";
import { QueueError } from "@/errors/queue";

import { BackfillService } from "./BackfillService";
import type {
  BlockBackfillQueue,
  BlockBackfillTask,
} from "./blockBackfillQueue";

export type LogBackfillTask = {
  fromBlock: number;
  toBlock: number;
  isRetry: boolean;
};

export type LogBackfillWorkerContext = {
  backfillService: BackfillService;
  logFilter: LogFilter;
  blockBackfillQueue: BlockBackfillQueue;
};

export type LogBackfillQueue = Queue<LogBackfillTask>;

export const createLogBackfillQueue = (
  context: LogBackfillWorkerContext
): LogBackfillQueue => {
  const queue = createQueue({
    worker: logBackfillWorker,
    context,
    options: {
      concurrency: 10,
    },
  });

  // Pass queue events on to service layer.
  queue.on("add", () => {
    context.backfillService.emit("logTasksAdded", {
      name: context.logFilter.name,
      count: 1,
    });
  });

  queue.on("error", ({ error }) => {
    context.backfillService.emit("logTaskFailed", {
      name: context.logFilter.name,
      error,
    });
  });

  queue.on("completed", () => {
    context.backfillService.emit("logTaskCompleted", {
      name: context.logFilter.name,
    });
  });

  queue.on("error", ({ error, task }) => {
    // Handle Alchemy response size error.
    if (
      error instanceof InvalidParamsRpcError &&
      error.details.startsWith("Log response size exceeded.")
    ) {
      const safe = error.details.split("this block range should work: ")[1];
      const safeStart = Number(safe.split(", ")[0].slice(1));
      const safeEnd = Number(safe.split(", ")[1].slice(0, -1));

      queue.addTask({
        fromBlock: safeStart,
        toBlock: safeEnd,
        isRetry: true,
      });
      queue.addTask({
        fromBlock: safeEnd,
        toBlock: task.toBlock,
        isRetry: true,
      });

      return;
    }

    // Handle Quicknode block range limit error (should never happen).
    if (
      error instanceof HttpRequestError &&
      error.details.includes(
        "eth_getLogs and eth_newFilter are limited to a 10,000 blocks range"
      )
    ) {
      const midpoint = Math.floor(
        (task.toBlock - task.fromBlock) / 2 + task.fromBlock
      );
      queue.addTask({
        fromBlock: task.fromBlock,
        toBlock: midpoint,
        isRetry: true,
      });
      queue.addTask({
        fromBlock: midpoint + 1,
        toBlock: task.toBlock,
        isRetry: true,
      });

      return;
    }

    const queueError = new QueueError({
      queueName: "Log backfill queue",
      task: task,
      cause: error,
    });
    context.backfillService.resources.logger.logMessage(
      MessageKind.ERROR,
      queueError.message
    );

    // Default to a simple retry.
    queue.addTask(task);
  });

  return queue;
};

const logBackfillWorker: Worker<
  LogBackfillTask,
  LogBackfillWorkerContext
> = async ({ task, context }) => {
  const { fromBlock, toBlock, isRetry } = task;
  const { backfillService, logFilter, blockBackfillQueue } = context;
  const { client } = logFilter.network;

  const rawLogs = await client.getLogs({
    address:
      logFilter.filter.address !== null ? logFilter.filter.address : undefined,
    fromBlock: BigInt(fromBlock),
    toBlock: BigInt(toBlock),
    event: logFilter.filter.event,
    args: logFilter.filter.args as unknown as undefined,
  });

  const logs = parseLogs(rawLogs, { chainId: logFilter.network.chainId });

  // If any pending logs were present in the response, log a warning.
  if (logs.length !== rawLogs.length) {
    backfillService.resources.logger.logMessage(
      MessageKind.WARNING,
      `Received unexpected pending logs (count: ${
        logs.length - rawLogs.length
      })`
    );
  }

  await backfillService.resources.cacheStore.insertLogs(logs);

  const txHashesByBlockNumber = logs.reduce<Record<number, Set<Hash>>>(
    (acc, log) => {
      const blockNumber = Number(log.blockNumber);
      acc[blockNumber] ||= new Set<Hash>();
      acc[blockNumber].add(log.transactionHash);
      return acc;
    },
    {}
  );
  const requiredBlockNumbers = Object.keys(txHashesByBlockNumber)
    .map(Number)
    .sort((a, b) => a - b);

  let blockNumberToCacheFrom = fromBlock;
  const blockBackfillTasks: BlockBackfillTask[] = [];

  for (const blockNumber of requiredBlockNumbers) {
    blockBackfillTasks.push({
      blockNumberToCacheFrom,
      blockNumber,
      requiredTxHashes: txHashesByBlockNumber[blockNumber],
    });
    blockNumberToCacheFrom = blockNumber + 1;
  }

  // If there is a gap between the last required block and the toBlock
  // of the log batch, add another task to cover the gap. This is necessary
  // to properly updates the log filter cached range data.
  if (blockNumberToCacheFrom <= toBlock) {
    blockBackfillTasks.push({
      blockNumberToCacheFrom,
      blockNumber: toBlock,
      requiredTxHashes: new Set(),
    });
  }

  blockBackfillQueue.addTasks(blockBackfillTasks, {
    priority: isRetry ? 1 : 0,
  });
};
