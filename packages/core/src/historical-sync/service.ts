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
import { LoggerService } from "@/logs/service";
import { MetricsService } from "@/metrics/service";
import { formatEta, formatPercentage } from "@/utils/format";
import { type Queue, createQueue } from "@/utils/queue";
import { startClock } from "@/utils/timer";

import { findMissingIntervals } from "./intervals";

type HistoricalSyncEvents = {
  /**
   * Emitted when the service starts processing historical sync tasks.
   */
  syncStarted: undefined;
  /**
   * Emitted when the service has finished processing all historical sync tasks.
   */
  syncComplete: undefined;
  /**
   * Emitted when the minimum cached timestamp among all registered log filters moves forward.
   * This indicates to consumers that the connected event store now contains a complete history
   * of events for all registered log filters between their start block and this timestamp (inclusive).
   */
  historicalCheckpoint: { timestamp: number };
  /**
   * Emitted when a historical sync task fails.
   */
  error: { error: Error };
};

type HistoricalSyncStats = {
  endDuration: () => number;
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
  private metrics: MetricsService;
  private logger: LoggerService;
  private eventStore: EventStore;
  private logFilters: LogFilter[];
  network: Network;

  private queue: HistoricalSyncQueue;
  stats: HistoricalSyncStats = {
    endDuration: startClock(),
    duration: 0,
    isComplete: false,
    logFilters: {},
  };

  private minimumLogFilterCheckpoint = 0;
  private logFilterCheckpoints: Record<string, number>;

  constructor({
    metrics,
    logger,
    eventStore,
    logFilters,
    network,
  }: {
    metrics: MetricsService;
    logger: LoggerService;
    eventStore: EventStore;
    logFilters: LogFilter[];
    network: Network;
  }) {
    super();

    this.metrics = metrics;
    this.logger = logger;
    this.eventStore = eventStore;
    this.logFilters = logFilters;
    this.network = network;

    this.queue = this.buildQueue();
    this.logFilterCheckpoints = {};

    logFilters.forEach((logFilter) => {
      this.stats.logFilters[logFilter.name] = {
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
        const cacheRate = Math.min(
          1,
          cachedBlockCount / (totalBlockCount || 1)
        );

        this.metrics.ponder_historical_total_blocks.set(
          {
            network: this.network.name,
            logFilter: logFilter.name,
          },
          totalBlockCount
        );
        this.metrics.ponder_historical_cached_blocks.set(
          {
            network: this.network.name,
            logFilter: logFilter.name,
          },
          cachedBlockCount
        );

        this.stats.logFilters[logFilter.name].totalBlockCount = totalBlockCount;
        this.stats.logFilters[logFilter.name].cacheRate = cacheRate;

        this.logger.info({
          service: "historical",
          msg: `Started sync with ${formatPercentage(
            cacheRate
          )} cached (network=${this.network.name})`,
          network: this.network.name,
          logFilter: logFilter.name,
          totalBlockCount,
          cacheRate,
        });

        for (const blockRange of requiredBlockRanges) {
          const [startBlock, endBlock] = blockRange;

          let fromBlock = startBlock;
          let toBlock = Math.min(fromBlock + maxBlockRange - 1, endBlock);

          while (fromBlock <= endBlock) {
            this.queue.addTask(
              {
                kind: "LOG_SYNC",
                logFilter,
                fromBlock,
                toBlock,
              },
              {
                priority: Number.MAX_SAFE_INTEGER - fromBlock,
              }
            );
            this.metrics.ponder_historical_scheduled_tasks.inc({
              network: this.network.name,
              kind: "log",
            });

            fromBlock = toBlock + 1;
            toBlock = Math.min(fromBlock + maxBlockRange - 1, endBlock);
          }
        }
      })
    );

    // Edge case: If there are no tasks in the queue, this means the entire
    // requested range was cached, so the sync is complete. However, we still
    // need to emit the historicalCheckpoint event with some timestamp. It should
    // be safe to use the current timestamp.
    if (this.queue.size === 0) {
      this.stats.duration = this.stats.endDuration();
      this.stats.isComplete = true;
      this.emit("historicalCheckpoint", {
        timestamp: Math.round(Date.now() / 1000),
      });
      this.emit("syncComplete");
      this.logger.info({
        service: "historical",
        msg: `Completed sync in ${formatEta(this.stats.duration)} (network=${
          this.network.name
        })`,
        network: this.network.name,
        duration: this.stats.duration,
      });
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
    this.logger.debug({
      service: "historical",
      msg: `Killed historical sync service (network=${this.network.name})`,
    });
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
        const { logFilter } = task;
        if (task.kind === "LOG_SYNC") {
          this.stats.logFilters[logFilter.name].logTaskTotalCount += 1;
        } else {
          this.stats.logFilters[logFilter.name].blockTaskTotalCount += 1;
        }
      },
      onComplete: ({ task }) => {
        const { logFilter } = task;
        if (task.kind === "LOG_SYNC") {
          this.stats.logFilters[logFilter.name].logTaskCompletedCount += 1;
        } else {
          this.stats.logFilters[logFilter.name].blockTaskCompletedCount += 1;

          this.metrics.ponder_historical_completed_blocks.inc(
            {
              network: this.network.name,
              logFilter: logFilter.name,
            },
            task.blockNumber - task.blockNumberToCacheFrom + 1
          );
        }

        this.logger.trace({
          service: "historical",
          msg:
            task.kind === "LOG_SYNC"
              ? `Completed log sync task`
              : `Completed block sync task`,
          network: this.network.name,
          logFilter: logFilter.name,
          ...(task.kind === "LOG_SYNC"
            ? {
                fromBlock: task.fromBlock,
                toBlock: task.toBlock,
              }
            : {
                blockNumberToCacheFrom: task.blockNumberToCacheFrom,
                blockNumber: task.blockNumber,
                requiredTransactionCount: task.requiredTxHashes.size,
              }),
        });

        this.metrics.ponder_historical_completed_tasks.inc({
          network: this.network.name,
          kind: task.kind === "LOG_SYNC" ? "log" : "block",
          status: "success",
        });
      },
      onError: ({ error, task, queue }) => {
        const { logFilter } = task;
        if (task.kind === "LOG_SYNC") {
          this.stats.logFilters[logFilter.name].logTaskErrorCount += 1;
        } else {
          this.stats.logFilters[logFilter.name].blockTaskErrorCount += 1;
        }

        this.metrics.ponder_historical_completed_tasks.inc({
          network: this.network.name,
          kind: task.kind === "LOG_SYNC" ? "log" : "block",
          status: "failure",
        });

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
            {
              priority: Number.MAX_SAFE_INTEGER - safeStart,
            }
          );
          queue.addTask(
            { ...task, fromBlock: safeEnd + 1 },
            { priority: Number.MAX_SAFE_INTEGER - safeEnd + 1 }
          );
          // Splitting the task into two parts increases the total count by 1.
          this.metrics.ponder_historical_scheduled_tasks.inc({
            network: this.network.name,
            kind: "log",
          });
          return;
        }

        // Handle thirdweb block range limit error.
        if (
          task.kind === "LOG_SYNC" &&
          error instanceof InvalidParamsRpcError &&
          error.details.includes("block range less than 20000")
        ) {
          const midpoint = Math.floor(
            (task.toBlock - task.fromBlock) / 2 + task.fromBlock
          );
          queue.addTask(
            { ...task, toBlock: midpoint },
            { priority: Number.MAX_SAFE_INTEGER - task.fromBlock }
          );
          queue.addTask(
            { ...task, fromBlock: midpoint + 1 },
            { priority: Number.MAX_SAFE_INTEGER - midpoint + 1 }
          );
          // Splitting the task into two parts increases the total count by 1.
          this.metrics.ponder_historical_scheduled_tasks.inc({
            network: this.network.name,
            kind: "log",
          });
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
          queue.addTask(
            { ...task, toBlock: midpoint },
            { priority: Number.MAX_SAFE_INTEGER - task.fromBlock }
          );
          queue.addTask(
            { ...task, fromBlock: midpoint + 1 },
            { priority: Number.MAX_SAFE_INTEGER - midpoint + 1 }
          );
          // Splitting the task into two parts increases the total count by 1.
          this.metrics.ponder_historical_scheduled_tasks.inc({
            network: this.network.name,
            kind: "log",
          });
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

        this.logger.error({
          service: "historical",
          msg:
            task.kind === "LOG_SYNC"
              ? `Historical sync log task failed`
              : `Historical sync block task failed`,
          network: this.network.name,
          logFilter: logFilter.name,
          ...(task.kind === "LOG_SYNC"
            ? {
                fromBlock: task.fromBlock,
                toBlock: task.toBlock,
              }
            : {
                blockNumberToCacheFrom: task.blockNumberToCacheFrom,
                blockNumber: task.blockNumber,
                requiredTransactionCount: task.requiredTxHashes.size,
              }),
          error,
        });

        // Default to a retry (uses the retry options passed to the queue).
        const priority =
          Number.MAX_SAFE_INTEGER -
          (task.kind === "LOG_SYNC"
            ? task.fromBlock
            : task.blockNumberToCacheFrom);
        queue.addTask(task, { priority, retry: true });
      },
      onIdle: () => {
        if (this.stats.isComplete) return;
        this.stats.duration = this.stats.endDuration();
        this.stats.isComplete = true;
        this.emit("syncComplete");
        this.logger.info({
          service: "historical",
          msg: `Completed sync in ${formatEta(this.stats.duration)} (network=${
            this.network.name
          })`,
          network: this.network.name,
          duration: this.stats.duration,
        });
      },
    });

    return queue;
  };

  private logTaskWorker = async ({ task }: { task: LogSyncTask }) => {
    const { logFilter, fromBlock, toBlock } = task;

    const stopClock = startClock();
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
    this.metrics.ponder_historical_rpc_request_duration.observe(
      {
        method: "eth_getLogs",
        network: this.network.name,
      },
      stopClock()
    );

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

    for (const blockTask of blockTasks) {
      this.queue.addTask(blockTask, {
        priority: Number.MAX_SAFE_INTEGER - blockTask.blockNumberToCacheFrom,
      });
    }

    this.metrics.ponder_historical_scheduled_tasks.inc(
      {
        network: this.network.name,
        kind: "block",
      },
      blockTasks.length
    );
  };

  private blockTaskWorker = async ({ task }: { task: BlockSyncTask }) => {
    const { logFilter, blockNumber, blockNumberToCacheFrom, requiredTxHashes } =
      task;

    const stopClock = startClock();
    const block = await this.network.client.request({
      method: "eth_getBlockByNumber",
      params: [toHex(blockNumber), true],
    });

    this.metrics.ponder_historical_rpc_request_duration.observe(
      {
        method: "eth_getBlockByNumber",
        network: this.network.name,
      },
      stopClock()
    );

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
