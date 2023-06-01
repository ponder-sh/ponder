import Emittery from "emittery";
import {
  type Hash,
  type RpcTransaction,
  HttpRequestError,
  InvalidParamsRpcError,
  toHex,
} from "viem";

import type { LogFilter } from "@/config/logFilters";
import type { Network } from "@/config/networks";
import { QueueError } from "@/errors/queue";
import type { EventStore } from "@/event-store/store";
import { type Queue, createQueue } from "@/utils/queue";
import { endBenchmark, startBenchmark } from "@/utils/timer";

import { findMissingIntervals } from "./intervals";

type HistoricalSyncEvents = {
  syncStarted: undefined;
  syncComplete: undefined;
  historicalCheckpoint: { timestamp: number };
  error: { error: Error };
};

type HistoricalSyncMetrics = {
  startedAt: [number, number];
  isComplete: boolean;
  duration: number;
  logFilters: Record<
    string,
    {
      totalBlockCount: number;
      cacheRate: number;

      logTaskTotalCount: number;
      logTaskCompletedCount: number;
      logTaskErrorCount: number;

      blockTaskTotalCount: number;
      blockTaskCompletedCount: number;
      blockTaskErrorCount: number;
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
  private eventStore: EventStore;
  private logFilters: LogFilter[];
  network: Network;

  private queue: HistoricalSyncQueue;
  metrics: HistoricalSyncMetrics = {
    startedAt: startBenchmark(),
    duration: 0,
    isComplete: false,
    logFilters: {},
  };

  private minimumLogFilterCheckpoint = 0;
  private logFilterCheckpoints: Record<string, number>;

  constructor({
    eventStore,
    logFilters,
    network,
  }: {
    eventStore: EventStore;
    logFilters: LogFilter[];
    network: Network;
  }) {
    super();

    this.eventStore = eventStore;
    this.logFilters = logFilters;
    this.network = network;

    this.queue = this.buildQueue();
    this.logFilterCheckpoints = {};

    logFilters.forEach((logFilter) => {
      this.metrics.logFilters[logFilter.name] = {
        totalBlockCount: 0,
        cacheRate: 0,
        logTaskTotalCount: 0,
        logTaskCompletedCount: 0,
        logTaskErrorCount: 0,
        blockTaskTotalCount: 0,
        blockTaskCompletedCount: 0,
        blockTaskErrorCount: 0,
      };

      this.logFilterCheckpoints[logFilter.name] = 0;
    });
  }

  async setup({ finalizedBlockNumber }: { finalizedBlockNumber: number }) {
    await Promise.all(
      this.logFilters.map(async (logFilter) => {
        const { startBlock, endBlock: userDefinedEndBlock } = logFilter.filter;
        const endBlock = userDefinedEndBlock ?? finalizedBlockNumber;
        const maxBlockRange =
          logFilter.maxBlockRange ?? this.network.defaultMaxBlockRange;

        if (startBlock > endBlock) {
          throw new Error(
            `Start block number (${startBlock}) is greater than end block number (${endBlock}).
             Are you sure the RPC endpoint is for the correct network?`
          );
        }

        const cachedRanges = await this.eventStore.getLogFilterCachedRanges({
          filterKey: logFilter.filter.key,
        });

        const requiredBlockRanges = findMissingIntervals(
          [startBlock, endBlock],
          cachedRanges.map((r) => [Number(r.startBlock), Number(r.endBlock)])
        );

        const totalBlockCount = endBlock - startBlock + 1;
        const cachedBlockCount = cachedRanges.reduce(
          (acc, cur) =>
            acc + (Number(cur.endBlock) + 1 - Number(cur.startBlock)),
          0
        );

        this.metrics.logFilters[logFilter.name].totalBlockCount =
          totalBlockCount;
        this.metrics.logFilters[logFilter.name].cacheRate =
          cachedBlockCount / (totalBlockCount || 1);

        for (const blockRange of requiredBlockRanges) {
          const [startBlock, endBlock] = blockRange;

          let fromBlock = startBlock;
          let toBlock = Math.min(fromBlock + maxBlockRange - 1, endBlock);

          while (fromBlock <= endBlock) {
            this.queue.addTask({
              kind: "LOG_SYNC",
              logFilter,
              fromBlock,
              toBlock,
            });

            fromBlock = toBlock + 1;
            toBlock = Math.min(fromBlock + maxBlockRange - 1, endBlock);
          }
        }
      })
    );

    // If, after adding tasks to the queue, there are no tasks in the queue,
    // this means everything we need was cached and we can complete early.
    if (this.queue.size === 0) {
      this.metrics.duration = endBenchmark(this.metrics.startedAt);
      this.metrics.isComplete = true;
      this.emit("syncComplete");
    }
  }

  start() {
    this.queue.start();
    this.emit("syncStarted");
  }

  kill = async () => {
    this.queue.pause();
    this.queue.clear();
    // TODO: Figure out if it's necessary to wait for the queue to be idle before killing it.
    // await this.onIdle();
  };

  onIdle = async () => {
    await this.queue.onIdle();
  };

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
      onAdd: ({ task }) => {
        if (task.kind === "LOG_SYNC") {
          this.metrics.logFilters[task.logFilter.name].logTaskTotalCount += 1;
        } else {
          this.metrics.logFilters[task.logFilter.name].blockTaskTotalCount += 1;
        }
      },
      onComplete: ({ task }) => {
        const { logFilter } = task;
        if (task.kind === "LOG_SYNC") {
          this.metrics.logFilters[logFilter.name].logTaskCompletedCount += 1;
        } else {
          this.metrics.logFilters[logFilter.name].blockTaskCompletedCount += 1;
        }
      },
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

        const queueError = new QueueError({
          queueName: "Historical sync queue",
          task: {
            logFilterName: task.logFilter.name,
            ...task,
            logFilter: undefined,
          },
          cause: error,
        });
        this.emit("error", { error: queueError });

        // Default to a retry (uses the retry options passed to the queue).
        queue.addTask(task, { retry: true });
      },
      onIdle: () => {
        if (this.metrics.isComplete) return;
        this.metrics.duration = endBenchmark(this.metrics.startedAt);
        this.metrics.isComplete = true;
        this.emit("syncComplete");
      },
    });

    return queue;
  };

  private logTaskWorker = async ({ task }: { task: LogSyncTask }) => {
    const { logFilter, fromBlock, toBlock } = task;

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

    await this.eventStore.insertFinalizedLogs({
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

    this.queue.addTasks(blockTasks, { front: true });
  };

  private blockTaskWorker = async ({ task }: { task: BlockSyncTask }) => {
    const { logFilter, blockNumber, blockNumberToCacheFrom, requiredTxHashes } =
      task;

    const block = await this.network.client.request({
      method: "eth_getBlockByNumber",
      params: [toHex(blockNumber), true],
    });

    if (!block) throw new Error(`Block not found: ${blockNumber}`);

    // Filter down to only required transactions (transactions that emitted events we care about).
    const transactions = (block.transactions as RpcTransaction[]).filter((tx) =>
      requiredTxHashes.has(tx.hash)
    );

    const { startingRangeEndTimestamp } =
      await this.eventStore.insertFinalizedBlock({
        chainId: this.network.chainId,
        block,
        transactions,
        logFilterRange: {
          logFilterKey: logFilter.filter.key,
          blockNumberToCacheFrom,
          logFilterStartBlockNumber: logFilter.filter.startBlock,
        },
      });

    this.logFilterCheckpoints[logFilter.name] = Math.max(
      this.logFilterCheckpoints[logFilter.name],
      startingRangeEndTimestamp
    );

    const historicalCheckpoint = Math.min(
      ...Object.values(this.logFilterCheckpoints)
    );
    if (historicalCheckpoint > this.minimumLogFilterCheckpoint) {
      this.minimumLogFilterCheckpoint = historicalCheckpoint;
      this.emit("historicalCheckpoint", {
        timestamp: this.minimumLogFilterCheckpoint,
      });
    }
  };
}
