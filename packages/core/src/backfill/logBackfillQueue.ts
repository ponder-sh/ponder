import {
  Hash,
  HttpRequestError,
  InvalidParamsRpcError,
  numberToHex,
} from "viem";

import { createQueue, Queue, Worker } from "@/common/createQueue";
import { MessageKind } from "@/common/LoggerService";
import { parseLogs } from "@/common/types";
import { LogFilter } from "@/config/logFilters";

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

  // const rawLogs = await client.getLogs({
  //   address:
  //     logFilter.filter.address !== null ? logFilter.filter.address : undefined,
  //   event: logFilter.filter.event,
  //   fromBlock: BigInt(fromBlock),
  //   toBlock: BigInt(toBlock),
  // });

  const result = await client.transport.request({
    method: "eth_getLogs",
    params: [
      {
        address:
          logFilter.filter.address !== null
            ? logFilter.filter.address
            : undefined,
        topics:
          logFilter.filter.topics !== null
            ? logFilter.filter.topics
            : undefined,
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(toBlock),
      },
    ],
  });

  const logs = parseLogs(rawLogs);

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

  let blockBackfillTasks: BlockBackfillTask[];

  // Handle the case where no logs were found. This is required to properly
  // update the log cache metadata, which is handled in the block worker.
  if (requiredBlockNumbers.length === 0) {
    blockBackfillTasks = [
      {
        blockNumber: toBlock,
        previousBlockNumber: fromBlock,
        requiredTxHashes: new Set(),
      },
    ];
  } else {
    blockBackfillTasks = requiredBlockNumbers.reduce<BlockBackfillTask[]>(
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
  }

  blockBackfillQueue.addTasks(blockBackfillTasks, {
    priority: isRetry ? 1 : 0,
  });
};
