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
import { Resources } from "@/Ponder";
import { formatEta, formatPercentage } from "@/utils/format";
import { type Queue, type Worker, createQueue } from "@/utils/queue";
import { hrTimeToMs, startClock } from "@/utils/timer";

import { findMissingIntervals } from "./intervals";

type HistoricalSyncEvents = {
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
  private resources: Resources;
  private eventStore: EventStore;
  private logFilters: LogFilter[];
  private network: Network;

  private queue: HistoricalSyncQueue;

  private logFilterCheckpoints: Record<string, number> = {};
  private minimumLogFilterCheckpoint = 0;

  private startTimestamp?: [number, number];
  private killFunctions: (() => void | Promise<void>)[] = [];

  constructor({
    resources,
    eventStore,
    logFilters,
    network,
  }: {
    resources: Resources;
    eventStore: EventStore;
    logFilters: LogFilter[];
    network: Network;
  }) {
    super();

    this.resources = resources;
    this.eventStore = eventStore;
    this.logFilters = logFilters;
    this.network = network;

    this.queue = this.buildQueue();

    logFilters.forEach((logFilter) => {
      this.logFilterCheckpoints[logFilter.name] = 0;
    });

    this.registerMetricCollectMethods();
  }

  async setup({
    latestBlockNumber,
    finalizedBlockNumber,
  }: {
    latestBlockNumber: number;
    finalizedBlockNumber: number;
  }) {
    await Promise.all(
      this.logFilters.map(async (logFilter) => {
        const { startBlock, endBlock: userDefinedEndBlock } = logFilter.filter;

        if (startBlock > latestBlockNumber) {
          throw new Error(
            `Start block number (${startBlock}) cannot be greater than latest block number (${latestBlockNumber}).
             Are you sure the RPC endpoint is for the correct network?`
          );
        }

        if (startBlock > finalizedBlockNumber) {
          // If the start block is in the unfinalized range, the historical sync is not needed.
          // Set the checkpoint to the current timestamp, then return (don't create the queue).
          const now = Math.round(Date.now() / 1000);
          this.logFilterCheckpoints[logFilter.name] = now;
          this.resources.metrics.ponder_historical_total_blocks.set(
            {
              network: this.network.name,
              logFilter: logFilter.name,
            },
            0
          );
          this.resources.logger.warn({
            service: "historical",
            msg: `Start block is not finalized, skipping historical sync (logFilter=${logFilter.name})`,
          });
          return;
        }

        if (userDefinedEndBlock) {
          if (userDefinedEndBlock < startBlock) {
            throw new Error(
              `End block number (${userDefinedEndBlock}) cannot be less than start block number (${startBlock}).
               Are you sure the RPC endpoint is for the correct network?`
            );
          }

          if (userDefinedEndBlock > latestBlockNumber) {
            throw new Error(
              `End block number (${userDefinedEndBlock}) cannot be greater than latest block number (${latestBlockNumber}).
               Are you sure the RPC endpoint is for the correct network?`
            );
          }

          if (userDefinedEndBlock > finalizedBlockNumber) {
            throw new Error(
              `End block number (${userDefinedEndBlock}) cannot be greater than finalized block number (${finalizedBlockNumber}).
               Are you sure the RPC endpoint is for the correct network?`
            );
          }
        }

        const endBlock = userDefinedEndBlock ?? finalizedBlockNumber;

        const maxBlockRange =
          logFilter.maxBlockRange ?? this.network.defaultMaxBlockRange;

        const cachedRanges = await this.eventStore.getLogFilterCachedRanges({
          filterKey: logFilter.filter.key,
        });

        const requiredBlockRanges = findMissingIntervals(
          [startBlock, endBlock],
          cachedRanges.map((r) => [Number(r.startBlock), Number(r.endBlock)])
        );

        const totalBlockCount = endBlock - startBlock + 1;
        const requiredBlockCount = requiredBlockRanges.reduce<number>(
          (acc, range) => acc + range[1] + 1 - range[0],
          0
        );
        const cachedBlockCount = totalBlockCount - requiredBlockCount;

        const cacheRate = Math.min(
          1,
          cachedBlockCount / (totalBlockCount || 1)
        );

        this.resources.metrics.ponder_historical_total_blocks.set(
          {
            network: this.network.name,
            logFilter: logFilter.name,
          },
          totalBlockCount
        );
        this.resources.metrics.ponder_historical_cached_blocks.set(
          {
            network: this.network.name,
            logFilter: logFilter.name,
          },
          cachedBlockCount
        );

        this.resources.logger.info({
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
            this.resources.metrics.ponder_historical_scheduled_tasks.inc({
              network: this.network.name,
              kind: "log",
            });

            fromBlock = toBlock + 1;
            toBlock = Math.min(fromBlock + maxBlockRange - 1, endBlock);
          }
        }
      })
    );
  }

  start() {
    this.startTimestamp = process.hrtime();

    // Emit status update logs on an interval for each active log filter.
    const updateLogInterval = setInterval(async () => {
      const completionStats = await this.getCompletionStats();

      completionStats.forEach(({ logFilter, rate, eta }) => {
        if (rate === 1) return;
        this.resources.logger.info({
          service: "historical",
          msg: `Sync is ${formatPercentage(rate)} complete${
            eta !== undefined ? ` with ~${formatEta(eta)} remaining` : ""
          } (logFilter=${logFilter})`,
          network: this.network.name,
        });
      });
    }, 10_000);
    this.killFunctions.push(() => {
      clearInterval(updateLogInterval);
    });

    // Edge case: If there are no tasks in the queue, this means the entire
    // requested range was cached, so the sync is complete. However, we still
    // need to emit the historicalCheckpoint event with some timestamp. It should
    // be safe to use the current timestamp.
    if (this.queue.size === 0) {
      const now = Math.round(Date.now() / 1000);
      this.emit("historicalCheckpoint", { timestamp: now });
      this.emit("syncComplete");
      this.resources.logger.info({
        service: "historical",
        msg: `Completed sync (network=${this.network.name})`,
        network: this.network.name,
      });
    }

    this.queue.start();
  }

  kill = async () => {
    for (const fn of this.killFunctions) {
      await fn();
    }

    this.queue.pause();
    this.queue.clear();
    // TODO: Figure out if it's necessary to wait for the queue to be idle before killing it.
    // await this.onIdle();
    this.resources.logger.debug({
      service: "historical",
      msg: `Killed historical sync service (network=${this.network.name})`,
    });
  };

  onIdle = async () => {
    await this.queue.onIdle();
  };

  private buildQueue = () => {
    const worker: Worker<LogSyncTask | BlockSyncTask> = async ({
      task,
      queue,
    }) => {
      if (task.kind === "LOG_SYNC") {
        await this.logTaskWorker({ task });
      } else {
        await this.blockTaskWorker({ task });
      }

      // If this is not the final task, return.
      if (queue.size > 0 || queue.pending > 1) return;

      // If this is the final task, run the cleanup/completion logic.

      // It's possible for multiple block sync tasks to run simultaneously,
      // resulting in a scenario where cached ranges are not fully merged.
      // Merge all cached ranges once last time before emitting the `syncComplete` event.
      await Promise.all(
        this.logFilters.map((logFilter) =>
          this.updateHistoricalCheckpoint({ logFilter })
        )
      );

      this.emit("syncComplete");
      const duration = hrTimeToMs(process.hrtime(this.startTimestamp));
      this.resources.logger.info({
        service: "historical",
        msg: `Completed sync in ${formatEta(duration)} (network=${
          this.network.name
        })`,
        network: this.network.name,
        duration,
      });
    };

    const queue = createQueue<LogSyncTask | BlockSyncTask>({
      worker,
      options: {
        concurrency: this.network.maxRpcRequestConcurrency,
        autoStart: false,
      },
      onComplete: ({ task }) => {
        const { logFilter } = task;

        if (task.kind === "BLOCK_SYNC") {
          this.resources.metrics.ponder_historical_completed_tasks.inc({
            network: this.network.name,
            kind: "block",
            status: "success",
          });

          this.resources.logger.trace({
            service: "historical",
            msg: `Completed block sync task`,
            network: this.network.name,
            logFilter: logFilter.name,
            blockNumberToCacheFrom: task.blockNumberToCacheFrom,
            blockNumber: task.blockNumber,
            requiredTransactionCount: task.requiredTxHashes.size,
          });

          // When a block task completes, a cached range record gets inserted.
          // Update the block range progress metric accordingly.
          this.resources.metrics.ponder_historical_completed_blocks.inc(
            {
              network: this.network.name,
              logFilter: logFilter.name,
            },
            task.blockNumber - task.blockNumberToCacheFrom + 1
          );
        }

        if (task.kind === "LOG_SYNC") {
          this.resources.metrics.ponder_historical_completed_tasks.inc({
            network: this.network.name,
            kind: "log",
            status: "success",
          });

          this.resources.logger.trace({
            service: "historical",
            msg: `Completed log sync task`,
            network: this.network.name,
            logFilter: logFilter.name,
            fromBlock: task.fromBlock,
            toBlock: task.toBlock,
          });
        }
      },
      onError: ({ error, task, queue }) => {
        const { logFilter } = task;

        this.resources.metrics.ponder_historical_completed_tasks.inc({
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
          this.resources.metrics.ponder_historical_scheduled_tasks.inc({
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
          this.resources.metrics.ponder_historical_scheduled_tasks.inc({
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
          this.resources.metrics.ponder_historical_scheduled_tasks.inc({
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

        if (task.kind === "LOG_SYNC") {
          this.resources.logger.error({
            service: "historical",
            msg: `Log sync task failed (network=${this.network.name}, logFilter=${logFilter.name})`,
            error,
            network: this.network.name,
            logFilter: logFilter.name,
            fromBlock: task.fromBlock,
            toBlock: task.toBlock,
          });
        }

        if (task.kind === "BLOCK_SYNC") {
          this.resources.logger.error({
            service: "historical",
            msg: `Block sync task failed (network=${this.network.name}, logFilter=${logFilter.name})`,
            error,
            network: this.network.name,
            logFilter: logFilter.name,
            blockNumberToCacheFrom: task.blockNumberToCacheFrom,
            blockNumber: task.blockNumber,
            requiredTransactionCount: task.requiredTxHashes.size,
          });
        }

        // Default to a retry (uses the retry options passed to the queue).
        const priority =
          Number.MAX_SAFE_INTEGER -
          (task.kind === "LOG_SYNC"
            ? task.fromBlock
            : task.blockNumberToCacheFrom);
        queue.addTask(task, { priority, retry: true });
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
    this.resources.metrics.ponder_historical_rpc_request_duration.observe(
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
      const priority =
        Number.MAX_SAFE_INTEGER - blockTask.blockNumberToCacheFrom;
      this.queue.addTask(blockTask, { priority });
    }

    this.resources.metrics.ponder_historical_scheduled_tasks.inc(
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

    this.resources.metrics.ponder_historical_rpc_request_duration.observe(
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

    await this.eventStore.insertFinalizedBlock({
      chainId: this.network.chainId,
      block,
      transactions,
      logFilterRange: {
        logFilterKey: logFilter.filter.key,
        blockNumberToCacheFrom,
      },
    });

    await this.updateHistoricalCheckpoint({ logFilter });
  };

  private updateHistoricalCheckpoint = async ({
    logFilter,
  }: {
    logFilter: LogFilter;
  }) => {
    const { startingRangeEndTimestamp } =
      await this.eventStore.mergeLogFilterCachedRanges({
        logFilterKey: logFilter.filter.key,
        logFilterStartBlockNumber: logFilter.filter.startBlock,
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

  private getCompletionStats = async () => {
    const cachedBlocksMetric = (
      await this.resources.metrics.ponder_historical_cached_blocks.get()
    ).values;
    const totalBlocksMetric = (
      await this.resources.metrics.ponder_historical_total_blocks.get()
    ).values;
    const completedBlocksMetric = (
      await this.resources.metrics.ponder_historical_completed_blocks.get()
    ).values;

    return this.logFilters.map(({ name }) => {
      const totalBlocks = totalBlocksMetric.find(
        (m) => m.labels.logFilter === name
      )?.value;
      const cachedBlocks = cachedBlocksMetric.find(
        (m) => m.labels.logFilter === name
      )?.value;
      const completedBlocks =
        completedBlocksMetric.find((m) => m.labels.logFilter === name)?.value ??
        0;

      // If the total_blocks metric is set and equals zero, the sync was skipped and
      // should be considered complete.
      if (totalBlocks === 0) {
        return { logFilter: name, rate: 1, eta: 0 };
      }

      // Any of these mean setup is not complete.
      if (
        totalBlocks === undefined ||
        cachedBlocks === undefined ||
        !this.startTimestamp
      ) {
        return { logFilter: name, rate: 0 };
      }

      const rate = (cachedBlocks + completedBlocks) / totalBlocks;

      // If fewer than 3 blocks have been processsed, the ETA will be low quality.
      if (completedBlocks < 3) return { logFilter: name, rate };

      // If rate is 1, sync is complete, so set the ETA to zero.
      if (rate === 1) return { logFilter: name, rate, eta: 0 };

      // (time elapsed) / (% completion of remaining block range)
      const elapsed = hrTimeToMs(process.hrtime(this.startTimestamp));
      const estimatedTotalDuration =
        elapsed / (completedBlocks / (totalBlocks - cachedBlocks));
      const estimatedTimeRemaining = estimatedTotalDuration - elapsed;

      return { logFilter: name, rate, eta: estimatedTimeRemaining };
    });
  };

  private registerMetricCollectMethods = async () => {
    // The `prom-client` base Metric class does allow dynamic assignment
    // of the `collect()` method, but it's not typed as such.

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.resources.metrics.ponder_historical_completion_rate.collect =
      async () => {
        const completionStats = await this.getCompletionStats();
        completionStats.forEach(({ logFilter, rate }) => {
          this.resources.metrics.ponder_historical_completion_rate.set(
            { logFilter, network: this.network.name },
            rate
          );
        });
      };

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.resources.metrics.ponder_historical_completion_eta.collect =
      async () => {
        const completionStats = await this.getCompletionStats();
        completionStats.forEach(({ logFilter, eta }) => {
          // If no progress has been made, can't calculate an accurate ETA.
          if (eta) {
            this.resources.metrics.ponder_historical_completion_eta.set(
              { logFilter, network: this.network.name },
              eta
            );
          }
        });
      };
  };
}
