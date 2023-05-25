import Emittery from "emittery";
import {
  type Hash,
  type RpcTransaction,
  HttpRequestError,
  InvalidParamsRpcError,
  toHex,
} from "viem";

import { type Queue, createQueue } from "@/common/queue";
import { endBenchmark, startBenchmark } from "@/common/utils";
import type { LogFilter } from "@/config/logFilters";
import type { Network } from "@/config/networks";
import type { EventStore } from "@/event-store/store";

import { findMissingIntervals } from "./intervals";

type HistoricalSyncEvents = {
  syncStarted: undefined;
  syncCompleted: undefined;
  newEvents: undefined;
};

type HistoricalSyncMetrics = {
  startedAt?: [number, number];
  duration?: number;
  logFilters: Record<
    string,
    {
      totalBlockCount: number;
      cachedBlockCount: number;

      logTaskStartedCount: number;
      logTaskErrorCount: number;
      logTaskCompletedCount: number;

      blockTaskStartedCount: number;
      blockTaskErrorCount: number;
      blockTaskCompletedCount: number;
    }
  >;
};

type LogSyncTask = {
  kind: "LOG_SYNC";
  logFilter: LogFilter;
  fromBlock: number;
  toBlock: number;
};

type BlockSyncTask = {
  kind: "BLOCK_SYNC";
  logFilter: LogFilter;
  blockNumberToCacheFrom: number;
  blockNumber: number;
  requiredTxHashes: Set<Hash>;
};

type HistoricalSyncQueue = Queue<LogSyncTask | BlockSyncTask>;

export class HistoricalSyncService extends Emittery<HistoricalSyncEvents> {
  private store: EventStore;
  private logFilters: LogFilter[];
  private network: Network;

  private queue: HistoricalSyncQueue;
  metrics: HistoricalSyncMetrics;

  constructor({
    store,
    logFilters,
    network,
  }: {
    store: EventStore;
    logFilters: LogFilter[];
    network: Network;
  }) {
    super();

    this.store = store;
    this.logFilters = logFilters;
    this.network = network;

    this.queue = this.buildQueue();
    this.metrics = { logFilters: {} };

    logFilters.forEach((logFilter) => {
      this.metrics.logFilters[logFilter.name] = {
        totalBlockCount: 0,
        cachedBlockCount: 0,
        logTaskStartedCount: 0,
        logTaskErrorCount: 0,
        logTaskCompletedCount: 0,
        blockTaskStartedCount: 0,
        blockTaskErrorCount: 0,
        blockTaskCompletedCount: 0,
      };
    });
  }

  async setup({ finalizedBlockNumber }: { finalizedBlockNumber: number }) {
    await Promise.all(
      this.logFilters.map(async (logFilter) => {
        const { startBlock, endBlock: userDefinedEndBlock } = logFilter;
        const endBlock = userDefinedEndBlock ?? finalizedBlockNumber;

        if (startBlock > endBlock) {
          throw new Error(
            `Start block number (${startBlock}) is greater than end block number (${endBlock}).
             Are you sure the RPC endpoint is for the correct network?`
          );
        }

        const cachedRanges = await this.store.getLogFilterCachedRanges({
          filterKey: logFilter.filter.key,
        });

        const requiredBlockRanges = findMissingIntervals(
          [startBlock, endBlock],
          cachedRanges.map((r) => [Number(r.startBlock), Number(r.endBlock)])
        );

        this.metrics.logFilters[logFilter.name].totalBlockCount =
          endBlock - startBlock + 1;
        this.metrics.logFilters[logFilter.name].cachedBlockCount =
          cachedRanges.reduce(
            (acc, cur) =>
              acc + (Number(cur.endBlock) + 1 - Number(cur.startBlock)),
            0
          );

        for (const blockRange of requiredBlockRanges) {
          const [startBlock, endBlock] = blockRange;

          let fromBlock = startBlock;
          let toBlock = Math.min(
            fromBlock + logFilter.maxBlockRange - 1,
            endBlock
          );

          while (fromBlock <= endBlock) {
            this.queue.addTask({
              kind: "LOG_SYNC",
              logFilter,
              fromBlock,
              toBlock,
            });

            fromBlock = toBlock + 1;
            toBlock = Math.min(
              fromBlock + logFilter.maxBlockRange - 1,
              endBlock
            );
          }
        }
      })
    );
  }

  start() {
    this.metrics.startedAt = startBenchmark();
    this.queue.start();
    this.emit("syncStarted");
  }

  async onIdle() {
    await this.queue.onIdle();
  }

  async kill() {
    this.queue.clear();
    await this.queue.onIdle();
  }

  private buildQueue = () => {
    const worker = async ({ task }: { task: LogSyncTask | BlockSyncTask }) => {
      switch (task.kind) {
        case "LOG_SYNC": {
          return this.logTaskWorker({ task });
        }
        case "BLOCK_SYNC": {
          return this.blockTaskWorker({ task });
        }
      }
    };

    const queue = createQueue<LogSyncTask | BlockSyncTask, unknown, any>({
      worker,
      options: { concurrency: 10, autoStart: false },
      onError: ({ error, task, queue }) => {
        const { logFilter } = task;
        if (task.kind === "LOG_SYNC") {
          this.metrics.logFilters[logFilter.name].logTaskErrorCount += 1;
        } else {
          this.metrics.logFilters[logFilter.name].blockTaskErrorCount += 1;
        }

        // Handle Alchemy response size error.
        if (
          task.kind === "LOG_SYNC" &&
          error instanceof InvalidParamsRpcError &&
          error.details.startsWith("Log response size exceeded.")
        ) {
          const safe = error.details.split("this block range should work: ")[1];
          const safeStart = Number(safe.split(", ")[0].slice(1));
          const safeEnd = Number(safe.split(", ")[1].slice(0, -1));

          queue.addTask(
            { ...task, fromBlock: safeStart, toBlock: safeEnd },
            { front: true }
          );
          queue.addTask({ ...task, fromBlock: safeEnd + 1 }, { front: true });
          return;
        }

        // Handle Quicknode block range limit error (should never happen).
        if (
          task.kind === "LOG_SYNC" &&
          error instanceof HttpRequestError &&
          error.details.includes(
            "eth_getLogs and eth_newFilter are limited to a 10,000 blocks range"
          )
        ) {
          const midpoint = Math.floor(
            (task.toBlock - task.fromBlock) / 2 + task.fromBlock
          );
          queue.addTask({ ...task, toBlock: midpoint }, { front: true });
          queue.addTask({ ...task, fromBlock: midpoint + 1 }, { front: true });
          return;
        }

        // const queueError = new QueueError({
        //   queueName: "Log backfill queue",
        //   task: task,
        //   cause: error,
        // });
        // context.backfillService.resources.logger.logMessage(
        //   MessageKind.ERROR,
        //   queueError.message
        // );

        // Default to a retry (uses the retry options passed to the queue).
        queue.addTask(task, { retry: true });
      },
      onComplete: ({ task }) => {
        const { logFilter } = task;
        if (task.kind === "LOG_SYNC") {
          this.metrics.logFilters[logFilter.name].logTaskCompletedCount += 1;
        } else {
          this.metrics.logFilters[logFilter.name].blockTaskCompletedCount += 1;
        }
      },
      onIdle: () => {
        if (this.metrics.startedAt) {
          this.metrics.duration = endBenchmark(this.metrics.startedAt);
          this.emit("syncCompleted");
        }
      },
    });

    return queue;
  };

  private logTaskWorker = async ({ task }: { task: LogSyncTask }) => {
    const { logFilter, fromBlock, toBlock } = task;

    this.metrics.logFilters[logFilter.name].logTaskStartedCount += 1;

    const logs = await this.network.client.request({
      method: "eth_getLogs",
      params: [
        {
          address: logFilter.filter.address,
          topics: logFilter.filter.topics,
          fromBlock: toHex(fromBlock),
          toBlock: toHex(toBlock),
        },
      ],
    });

    await this.store.insertFinalizedLogs({
      chainId: this.network.chainId,
      logs,
    });

    const txHashesByBlockNumber = logs.reduce<Record<number, Set<Hash>>>(
      (acc, log) => {
        const blockNumber = Number(log.blockNumber);
        acc[blockNumber] ||= new Set<Hash>();
        acc[blockNumber].add(log.transactionHash!);
        return acc;
      },
      {}
    );
    const requiredBlockNumbers = Object.keys(txHashesByBlockNumber)
      .map(Number)
      .sort((a, b) => a - b);

    let blockNumberToCacheFrom = fromBlock;
    const blockTasks: BlockSyncTask[] = [];

    for (const blockNumber of requiredBlockNumbers) {
      blockTasks.push({
        kind: "BLOCK_SYNC",
        logFilter,
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
      blockTasks.push({
        kind: "BLOCK_SYNC",
        logFilter,
        blockNumberToCacheFrom,
        blockNumber: toBlock,
        requiredTxHashes: new Set(),
      });
    }

    this.queue.addTasks(blockTasks);
  };

  private blockTaskWorker = async ({ task }: { task: BlockSyncTask }) => {
    const { logFilter, blockNumber, blockNumberToCacheFrom, requiredTxHashes } =
      task;

    this.metrics.logFilters[logFilter.name].blockTaskStartedCount += 1;

    const block = await this.network.client.request({
      method: "eth_getBlockByNumber",
      params: [toHex(blockNumber), true],
    });

    if (!block) throw new Error(`Block not found: ${blockNumber}`);

    // Filter down to only required transactions (transactions that emitted events we care about).
    const transactions = (block.transactions as RpcTransaction[]).filter((tx) =>
      requiredTxHashes.has(tx.hash)
    );

    await this.store.insertFinalizedBlock({
      chainId: this.network.chainId,
      block,
      transactions,
      logFilterRange: {
        blockNumberToCacheFrom,
        logFilterKey: logFilter.filter.key,
      },
    });

    if (requiredTxHashes.size > 0) {
      this.emit("newEvents");
    }
  };
}
