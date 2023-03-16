import { Hash, HttpRequestError, InvalidParamsRpcError } from "viem";

import { createQueue, Queue, Worker } from "@/common/createQueue";
import { MessageKind } from "@/common/LoggerService";
import { parseLogs } from "@/common/types";
import type { Contract } from "@/config/contracts";

import { BackfillService } from "./BackfillService";
import type { BlockBackfillQueue } from "./blockBackfillQueue";

export type LogBackfillTask = {
  fromBlock: number;
  toBlock: number;
  isRetry: boolean;
};

export type LogBackfillWorkerContext = {
  backfillService: BackfillService;
  contract: Contract;
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
      contract: context.contract.name,
      count: 1,
    });
  });

  queue.on("error", ({ error }) => {
    context.backfillService.emit("logTaskFailed", {
      contract: context.contract.name,
      error,
    });
  });

  queue.on("completed", () => {
    context.backfillService.emit("logTaskCompleted", {
      contract: context.contract.name,
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
  const { backfillService, contract, blockBackfillQueue } = context;
  const { client } = contract.network;

  const [rawLogs, rawToBlock] = await Promise.all([
    client.getLogs({
      address: [contract.address],
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    }),
    client.getBlock({
      blockNumber: BigInt(toBlock),
      includeTransactions: false,
    }),
  ]);

  // The timestamp of the toBlock is required to properly update the cached intervals below.
  const toBlockTimestamp = rawToBlock.timestamp;

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
  const completedBlockHashes: Hash[] = [];

  const onSuccess = async ({ blockHash }: { blockHash?: Hash } = {}) => {
    if (blockHash) completedBlockHashes.push(blockHash);

    if (completedBlockHashes.length === requiredBlockHashes.length) {
      await backfillService.resources.cacheStore.insertCachedInterval({
        contractAddress: contract.address,
        startBlock: fromBlock,
        endBlock: toBlock,
        endBlockTimestamp: Number(toBlockTimestamp),
      });

      // If there were logs in this batch, send an event to process them.
      const logCount = logs.length;
      if (logCount > 0) {
        backfillService.emit("eventsAdded", { count: logCount });
      }
    }
  };

  // If there are no required blocks, call the batch success callback manually
  // so we make sure to update the contract metadata accordingly.
  if (requiredBlockHashes.length === 0) {
    await onSuccess();
  }

  const blockBackfillTasks = requiredBlockHashes.map((blockHash) => ({
    blockHash,
    requiredTxHashes: txHashesByBlockHash[blockHash],
    onSuccess,
  }));

  blockBackfillQueue.addTasks(blockBackfillTasks, {
    priority: isRetry ? 1 : 0,
  });
};
