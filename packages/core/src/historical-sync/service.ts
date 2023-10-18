import Emittery from "emittery";
import {
  type Hash,
  type RpcTransaction,
  hexToBigInt,
  hexToNumber,
  HttpRequestError,
  InvalidParamsRpcError,
  LimitExceededRpcError,
  RpcBlock,
  RpcLog,
  toHex,
} from "viem";

import { Factory, getAddressFromFactoryEventLog } from "@/config/factories";
import type { LogFilter } from "@/config/logFilters";
import type { Network } from "@/config/networks";
import type { EventStore } from "@/event-store/store";
import type { Common } from "@/Ponder";
import { formatEta, formatPercentage } from "@/utils/format";
import {
  BlockProgressTracker,
  getChunks,
  intervalDifference,
  intervalSum,
  ProgressTracker,
} from "@/utils/interval";
import { type Queue, type Worker, createQueue } from "@/utils/queue";
import { hrTimeToMs, startClock } from "@/utils/timer";

import { validateHistoricalBlockRange } from "./utils";

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
  historicalCheckpoint: { blockNumber: number; blockTimestamp: number };
};

type LogFilterTask = {
  kind: "LOG_FILTER";
  logFilter: LogFilter;
  fromBlock: number;
  toBlock: number;
};

type FactoryTask = {
  kind: "FACTORY_CONTRACT";
  factory: Factory;
  fromBlock: number;
  toBlock: number;
};

type ChildContractTask = {
  kind: "CHILD_CONTRACT";
  factory: Factory;
  fromBlock: number;
  toBlock: number;
};

type BlockTask = {
  kind: "BLOCK";
  blockNumber: number;
  callbacks: ((block: RpcBlock) => Promise<void>)[];
};

type HistoricalSyncTask =
  | LogFilterTask
  | FactoryTask
  | ChildContractTask
  | BlockTask;

export class HistoricalSyncService extends Emittery<HistoricalSyncEvents> {
  private common: Common;
  private eventStore: EventStore;
  private network: Network;

  /**
   * Service configuration. Will eventually be reloadable.
   */
  private finalizedBlockNumber: number = null!;
  private logFilters: LogFilter[];
  private factories: Factory[];

  /**
   * Block progress trackers for each task type.
   */
  private logFilterProgressTrackers: Record<string, ProgressTracker> = {};
  private factoryProgressTrackers: Record<string, ProgressTracker> = {};
  private childContractProgressTrackers: Record<string, ProgressTracker> = {};
  private blockProgressTracker: BlockProgressTracker =
    new BlockProgressTracker();

  /**
   * Functions registered by log filter + child contract tasks. These functions accept
   * a raw block object, get required data from it, then insert data and cache metadata
   * into the event store. The keys of this object are used to keep track of which blocks
   * must be fetched.
   */
  private blockCallbacks: Record<
    number,
    ((block: RpcBlock) => Promise<void>)[]
  > = {};

  /**
   * Block tasks have been added to the queue up to and including this block number.
   * Used alongside blockCallbacks to keep track of which block tasks to add to the queue.
   */
  private blockTasksEnqueuedCheckpoint = 0;

  private queue: Queue<HistoricalSyncTask>;
  private startTimestamp?: [number, number];
  private killFunctions: (() => void | Promise<void>)[] = [];

  constructor({
    common,
    eventStore,
    network,
    logFilters = [],
    factories = [],
  }: {
    common: Common;
    eventStore: EventStore;
    network: Network;
    logFilters?: LogFilter[];
    factories?: Factory[];
  }) {
    super();

    this.common = common;
    this.eventStore = eventStore;
    this.network = network;
    this.logFilters = logFilters;
    this.factories = factories;

    this.queue = this.buildQueue();

    this.registerMetricCollectMethods();
  }

  async setup({
    latestBlockNumber,
    finalizedBlockNumber,
  }: {
    latestBlockNumber: number;
    finalizedBlockNumber: number;
  }) {
    this.finalizedBlockNumber = finalizedBlockNumber;

    await Promise.all([
      ...this.logFilters.map(async (logFilter) => {
        const { isHistoricalSyncRequired, startBlock, endBlock } =
          validateHistoricalBlockRange({
            startBlock: logFilter.startBlock,
            endBlock: logFilter.endBlock,
            finalizedBlockNumber,
            latestBlockNumber,
          });

        if (!isHistoricalSyncRequired) {
          this.logFilterProgressTrackers[logFilter.name] = new ProgressTracker({
            target: [startBlock, finalizedBlockNumber],
            completed: [[startBlock, finalizedBlockNumber]],
          });
          this.common.metrics.ponder_historical_total_blocks.set(
            { network: this.network.name, eventSource: logFilter.name },
            0
          );
          this.common.logger.warn({
            service: "historical",
            msg: `Start block is in unfinalized range, skipping historical sync (eventSource=${logFilter.name})`,
          });
          return;
        }

        const completedLogFilterIntervals =
          await this.eventStore.getLogFilterIntervals({
            chainId: logFilter.chainId,
            logFilter: {
              address: logFilter.criteria.address,
              topics: logFilter.criteria.topics,
            },
          });
        const logFilterProgressTracker = new ProgressTracker({
          target: [startBlock, endBlock],
          completed: completedLogFilterIntervals,
        });
        this.logFilterProgressTrackers[logFilter.name] =
          logFilterProgressTracker;

        const requiredLogFilterIntervals =
          logFilterProgressTracker.getRequired();

        const logFilterTaskChunks = getChunks({
          intervals: requiredLogFilterIntervals,
          maxChunkSize:
            logFilter.maxBlockRange ?? this.network.defaultMaxBlockRange,
        });

        for (const [fromBlock, toBlock] of logFilterTaskChunks) {
          this.queue.addTask(
            { kind: "LOG_FILTER", logFilter, fromBlock, toBlock },
            { priority: Number.MAX_SAFE_INTEGER - fromBlock }
          );
        }

        const targetBlockCount = endBlock - startBlock + 1;
        const cachedBlockCount = intervalSum(completedLogFilterIntervals);

        this.common.metrics.ponder_historical_total_blocks.set(
          { network: this.network.name, eventSource: logFilter.name },
          targetBlockCount
        );
        this.common.metrics.ponder_historical_cached_blocks.set(
          { network: this.network.name, eventSource: logFilter.name },
          cachedBlockCount
        );

        this.common.logger.info({
          service: "historical",
          msg: `Started sync with ${formatPercentage(
            Math.min(1, cachedBlockCount / (targetBlockCount || 1))
          )} cached (eventSource=${logFilter.name} network=${
            this.network.name
          })`,
        });
      }),
      ...this.factories.map(async (factory) => {
        const { isHistoricalSyncRequired, startBlock, endBlock } =
          validateHistoricalBlockRange({
            startBlock: factory.startBlock,
            endBlock: factory.endBlock,
            finalizedBlockNumber,
            latestBlockNumber,
          });

        if (!isHistoricalSyncRequired) {
          this.factoryProgressTrackers[factory.name] = new ProgressTracker({
            target: [startBlock, finalizedBlockNumber],
            completed: [[startBlock, finalizedBlockNumber]],
          });
          this.childContractProgressTrackers[factory.name] =
            new ProgressTracker({
              target: [startBlock, finalizedBlockNumber],
              completed: [[startBlock, finalizedBlockNumber]],
            });
          this.common.metrics.ponder_historical_total_blocks.set(
            { network: this.network.name, eventSource: factory.name },
            0
          );
          this.common.logger.warn({
            service: "historical",
            msg: `Start block is in unfinalized range, skipping historical sync (eventSource=${factory.name})`,
          });
          return;
        }

        const completedFactoryIntervals =
          await this.eventStore.getFactoryIntervals({
            chainId: factory.chainId,
            factory: factory.criteria,
          });
        const factoryProgressTracker = new ProgressTracker({
          target: [startBlock, endBlock],
          completed: completedFactoryIntervals,
        });
        this.factoryProgressTrackers[factory.name] = factoryProgressTracker;

        const completedChildContractIntervals =
          await this.eventStore.getChildContractIntervals({
            chainId: factory.chainId,
            factory: factory.criteria,
          });
        const childProgressTracker = new ProgressTracker({
          target: [startBlock, endBlock],
          completed: completedChildContractIntervals,
        });
        this.childContractProgressTrackers[factory.name] = childProgressTracker;

        const requiredFactoryIntervals = factoryProgressTracker.getRequired();
        const factoryTaskChunks = getChunks({
          intervals: requiredFactoryIntervals,
          maxChunkSize:
            factory.maxBlockRange ?? this.network.defaultMaxBlockRange,
        });

        for (const [fromBlock, toBlock] of factoryTaskChunks) {
          this.queue.addTask(
            { kind: "FACTORY_CONTRACT", factory, fromBlock, toBlock },
            { priority: Number.MAX_SAFE_INTEGER - fromBlock }
          );
        }

        const targetFactoryBlockCount = endBlock - startBlock + 1;
        const cachedFactoryBlockCount = intervalSum(completedFactoryIntervals);

        this.common.metrics.ponder_historical_total_blocks.set(
          {
            network: this.network.name,
            // This name is used for the FACTORY_CONTRACT task progress for this factory in metrics.
            eventSource: `${factory.name}_factory`,
          },
          targetFactoryBlockCount
        );
        this.common.metrics.ponder_historical_cached_blocks.set(
          {
            network: this.network.name,
            eventSource: `${factory.name}_factory`,
          },
          cachedFactoryBlockCount
        );

        // Manually add child log tasks for any intervals where the factory
        // logs are cached, but the child logs are not. These won't be added
        // automatically by the factory log tasks.
        const requiredChildContractIntervals =
          childProgressTracker.getRequired();
        const missingChildContractIntervals = intervalDifference(
          requiredChildContractIntervals,
          requiredFactoryIntervals
        );

        const missingChildTaskChunks = getChunks({
          intervals: missingChildContractIntervals,
          maxChunkSize:
            factory.maxBlockRange ?? this.network.defaultMaxBlockRange,
        });

        for (const [fromBlock, toBlock] of missingChildTaskChunks) {
          this.queue.addTask(
            { kind: "CHILD_CONTRACT", factory, fromBlock, toBlock },
            { priority: Number.MAX_SAFE_INTEGER - fromBlock }
          );
        }

        const targetChildContractBlockCount = endBlock - startBlock + 1;
        const cachedChildContractBlockCount = intervalSum(
          completedChildContractIntervals
        );

        this.common.metrics.ponder_historical_total_blocks.set(
          { network: this.network.name, eventSource: factory.name },
          targetChildContractBlockCount
        );
        this.common.metrics.ponder_historical_cached_blocks.set(
          { network: this.network.name, eventSource: factory.name },
          cachedChildContractBlockCount
        );

        // Use child contract progress for the log because it better represents
        // user-facing progress.
        const cacheRate = Math.min(
          1,
          cachedChildContractBlockCount / (targetChildContractBlockCount || 1)
        );
        this.common.logger.info({
          service: "historical",
          msg: `Started sync with ${formatPercentage(
            cacheRate
          )} cached (eventSource=${factory.name} network=${this.network.name})`,
        });
      }),
    ]);
  }

  start() {
    this.startTimestamp = process.hrtime();

    // Emit status update logs on an interval for each active log filter.
    const updateLogInterval = setInterval(async () => {
      const completionStats = await this.getCompletionStats();

      completionStats.forEach(({ eventSource, rate, eta }) => {
        if (rate === 1) return;
        this.common.logger.info({
          service: "historical",
          msg: `Sync is ${formatPercentage(rate)} complete${
            eta !== undefined ? ` with ~${formatEta(eta)} remaining` : ""
          } (eventSource=${eventSource})`,
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
      this.emit("historicalCheckpoint", {
        blockNumber: this.finalizedBlockNumber,
        blockTimestamp: Math.round(Date.now() / 1000),
      });
      this.emit("syncComplete");
      this.common.logger.info({
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
    this.common.logger.debug({
      service: "historical",
      msg: `Killed historical sync service (network=${this.network.name})`,
    });
  };

  onIdle = async () => {
    await this.queue.onIdle();
  };

  private buildQueue = () => {
    const worker: Worker<HistoricalSyncTask> = async ({ task, queue }) => {
      switch (task.kind) {
        case "LOG_FILTER": {
          await this.logFilterTaskWorker({ task });
          break;
        }
        case "FACTORY_CONTRACT": {
          await this.factoryTaskWorker({ task });
          break;
        }
        case "CHILD_CONTRACT": {
          await this.childContractTaskWorker({ task });
          break;
        }
        case "BLOCK": {
          await this.blockTaskWorker({ task });
          break;
        }
      }

      // If this is not the final task, return.
      if (queue.size > 0 || queue.pending > 1) return;

      // If this is the final task, run the cleanup/completion logic.
      this.emit("syncComplete");
      const duration = hrTimeToMs(process.hrtime(this.startTimestamp));
      this.common.logger.info({
        service: "historical",
        msg: `Completed sync in ${formatEta(duration)} (network=${
          this.network.name
        })`,
      });
    };

    const queue = createQueue<HistoricalSyncTask>({
      worker,
      options: {
        concurrency: this.network.maxRpcRequestConcurrency,
        autoStart: false,
      },
      onError: ({ error, task, queue }) => {
        switch (task.kind) {
          case "LOG_FILTER": {
            // Handle Alchemy response size error.
            if (
              error instanceof InvalidParamsRpcError &&
              error.details.startsWith("Log response size exceeded.")
            ) {
              const safe = error.details.split(
                "this block range should work: "
              )[1];
              const safeStart = Number(safe.split(", ")[0].slice(1));
              const safeEnd = Number(safe.split(", ")[1].slice(0, -1));

              queue.addTask(
                { ...task, fromBlock: safeStart, toBlock: safeEnd },
                { priority: Number.MAX_SAFE_INTEGER - safeStart }
              );
              queue.addTask(
                { ...task, fromBlock: safeEnd + 1 },
                { priority: Number.MAX_SAFE_INTEGER - safeEnd + 1 }
              );
              return;
            }

            // Handle thirdweb block range limit error.
            if (
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
              queue.addTask(
                { ...task, toBlock: midpoint },
                { priority: Number.MAX_SAFE_INTEGER - task.fromBlock }
              );
              queue.addTask(
                { ...task, fromBlock: midpoint + 1 },
                { priority: Number.MAX_SAFE_INTEGER - midpoint + 1 }
              );
              return;
            }

            // Handle Infura block range limit error.
            if (
              task.kind === "LOG_SYNC" &&
              error instanceof LimitExceededRpcError &&
              error.details.includes("query returned more than 10000 results")
            ) {
              const safe = error.details.split("Try with this block range ")[1];
              const safeStart = Number(safe.split(", ")[0].slice(1));
              const safeEnd = Number(safe.split(", ")[1].slice(0, -2));

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
              this.common.metrics.ponder_historical_scheduled_tasks.inc({
                network: this.network.name,
                kind: "log",
              });
              return;
            }

            // Default to a retry (uses the retry options passed to the queue).
            const priority = Number.MAX_SAFE_INTEGER - task.fromBlock;
            queue.addTask(task, { priority, retry: true });

            break;
          }
          case "BLOCK": {
            this.common.logger.warn({
              service: "historical",
              msg: `Block sync task failed (network=${this.network.name}, blockNumber=${task.blockNumber})`,
              error,
            });

            // Default to a retry (uses the retry options passed to the queue).
            const priority = Number.MAX_SAFE_INTEGER - task.blockNumber;
            queue.addTask(task, { priority, retry: true });

            break;
          }
        }
      },
    });

    return queue;
  };

  private logFilterTaskWorker = async ({ task }: { task: LogFilterTask }) => {
    const { logFilter, fromBlock, toBlock } = task;

    const stopClock = startClock();
    const logs = await this.network.client.request({
      method: "eth_getLogs",
      params: [
        {
          address: logFilter.criteria.address,
          topics: logFilter.criteria.topics,
          fromBlock: toHex(fromBlock),
          toBlock: toHex(toBlock),
        },
      ],
    });
    this.common.metrics.ponder_historical_rpc_request_duration.observe(
      { method: "eth_getLogs", network: this.network.name },
      stopClock()
    );

    const logsByBlockNumber: Record<number, RpcLog[] | undefined> = {};
    const txHashesByBlockNumber: Record<number, Set<Hash> | undefined> = {};

    logs.forEach((log) => {
      const blockNumber = hexToNumber(log.blockNumber!);
      (txHashesByBlockNumber[blockNumber] ||= new Set<Hash>()).add(
        log.transactionHash!
      );
      (logsByBlockNumber[blockNumber] ||= []).push(log);
    });

    const requiredBlocks = Object.keys(txHashesByBlockNumber)
      .map(Number)
      .sort((a, b) => a - b);

    // If toBlock is not already required, add it. This is necessary
    // to mark the full block range of the eth_getLogs request as cached.
    if (!requiredBlocks.includes(task.toBlock)) {
      requiredBlocks.push(task.toBlock);
    }

    const requiredIntervals: [number, number][] = [];
    let prev = task.fromBlock;
    for (const blockNumber of requiredBlocks) {
      requiredIntervals.push([prev, blockNumber]);
      prev = blockNumber + 1;
    }

    for (const [startBlock, endBlock] of requiredIntervals) {
      (this.blockCallbacks[endBlock] ||= []).push(async (block) => {
        // Filter down to only required transactions (transactions that emitted events we care about).
        const requiredTxHashes = txHashesByBlockNumber[endBlock] ?? new Set();
        const transactions = (block.transactions as RpcTransaction[]).filter(
          (tx) => requiredTxHashes.has(tx.hash)
        );

        const logs = logsByBlockNumber[endBlock] ?? [];

        await this.eventStore.insertHistoricalLogFilterInterval({
          chainId: logFilter.chainId,
          block,
          transactions,
          logs,
          logFilter: {
            address: logFilter.criteria.address,
            topics: logFilter.criteria.topics,
          },
          interval: {
            startBlock: BigInt(startBlock),
            endBlock: BigInt(endBlock),
          },
        });

        this.common.metrics.ponder_historical_completed_blocks.inc(
          { network: this.network.name, eventSource: logFilter.name },
          endBlock - startBlock + 1
        );
      });
    }

    this.logFilterProgressTrackers[task.logFilter.name].addCompletedInterval([
      task.fromBlock,
      task.toBlock,
    ]);

    this.enqueueBlockTasks();

    this.common.logger.trace({
      service: "historical",
      msg: `Completed log sync task [${task.fromBlock}, ${task.toBlock}] (logFilter=${task.logFilter.name}, network=${this.network.name})`,
    });
  };

  private factoryTaskWorker = async ({ task }: { task: FactoryTask }) => {
    const { factory, fromBlock, toBlock } = task;

    const stopClock = startClock();
    const logs = await this.network.client.request({
      method: "eth_getLogs",
      params: [
        {
          address: factory.criteria.address,
          // TODO: Consider batching requests across many factories if possible.
          topics: [factory.criteria.eventSelector],
          fromBlock: toHex(fromBlock),
          toBlock: toHex(toBlock),
        },
      ],
    });
    this.common.metrics.ponder_historical_rpc_request_duration.observe(
      { method: "eth_getLogs", network: this.network.name },
      stopClock()
    );

    const newChildContracts = logs.map((log) => ({
      address: getAddressFromFactoryEventLog({
        criteria: factory.criteria,
        log,
      }),
      creationBlock: hexToBigInt(log.blockNumber!),
    }));

    await this.eventStore.insertHistoricalFactoryInterval({
      chainId: factory.chainId,
      factory: factory.criteria,
      newChildContracts,
      interval: {
        startBlock: BigInt(fromBlock),
        endBlock: BigInt(toBlock),
      },
    });

    const { isUpdated, prevCheckpoint, newCheckpoint } =
      this.factoryProgressTrackers[factory.name].addCompletedInterval([
        fromBlock,
        toBlock,
      ]);

    if (isUpdated) {
      const childContractTaskChunks = getChunks({
        intervals: [[prevCheckpoint + 1, newCheckpoint]],
        maxChunkSize:
          factory.maxBlockRange ?? this.network.defaultMaxBlockRange,
      });

      for (const [fromBlock, toBlock] of childContractTaskChunks) {
        this.queue.addTask(
          { kind: "CHILD_CONTRACT", factory, fromBlock, toBlock },
          { priority: Number.MAX_SAFE_INTEGER - fromBlock }
        );
      }
    }

    this.common.metrics.ponder_historical_completed_blocks.inc(
      { network: this.network.name, eventSource: `${factory.name}_factory` },
      toBlock - fromBlock + 1
    );

    this.common.logger.trace({
      service: "historical",
      msg: `Completed factory contract task [${task.fromBlock}, ${task.toBlock}] (factory=${task.factory.name}, network=${this.network.name})`,
    });
  };

  private childContractTaskWorker = async ({
    task,
  }: {
    task: ChildContractTask;
  }) => {
    const iterator = this.eventStore.getChildContractAddresses({
      chainId: task.factory.chainId,
      upToBlockNumber: BigInt(task.toBlock),
      factory: task.factory.criteria,
    });

    for await (const childContractAddressBatch of iterator) {
      const stopClock = startClock();
      const logs = await this.network.client.request({
        method: "eth_getLogs",
        params: [
          {
            address: childContractAddressBatch,
            fromBlock: toHex(task.fromBlock),
            toBlock: toHex(task.toBlock),
          },
        ],
      });
      this.common.metrics.ponder_historical_rpc_request_duration.observe(
        { method: "eth_getLogs", network: this.network.name },
        stopClock()
      );

      /** START: Same logic as log worker. */

      const logsByBlockNumber: Record<number, RpcLog[] | undefined> = {};
      const txHashesByBlockNumber: Record<number, Set<Hash> | undefined> = {};

      logs.forEach((log) => {
        const blockNumber = hexToNumber(log.blockNumber!);
        (txHashesByBlockNumber[blockNumber] ||= new Set<Hash>()).add(
          log.transactionHash!
        );
        (logsByBlockNumber[blockNumber] ||= []).push(log);
      });

      const requiredBlocks = Object.keys(txHashesByBlockNumber)
        .map(Number)
        .sort((a, b) => a - b);

      // If toBlock is not already required, add it. This is necessary
      // to reflect the availability of logs for the full range of the
      // eth_getLogs request.
      if (!requiredBlocks.includes(task.toBlock)) {
        requiredBlocks.push(task.toBlock);
      }

      const requiredIntervals: [number, number][] = [];
      let prev = task.fromBlock;
      for (const blockNumber of requiredBlocks) {
        requiredIntervals.push([prev, blockNumber]);
        prev = blockNumber + 1;
      }

      for (const [startBlock, endBlock] of requiredIntervals) {
        (this.blockCallbacks[endBlock] ||= []).push(async (block) => {
          // Filter down to only required transactions (transactions that emitted events we care about).
          const requiredTxHashes = txHashesByBlockNumber[endBlock] ?? new Set();
          const transactions = (block.transactions as RpcTransaction[]).filter(
            (tx) => requiredTxHashes.has(tx.hash)
          );

          const logs = logsByBlockNumber[endBlock] ?? [];

          await this.eventStore.insertHistoricalChildContractInterval({
            chainId: task.factory.chainId,
            factory: task.factory.criteria,
            block,
            transactions,
            logs,
            interval: {
              startBlock: BigInt(startBlock),
              endBlock: BigInt(endBlock),
            },
          });

          this.common.metrics.ponder_historical_completed_blocks.inc(
            { network: this.network.name, eventSource: task.factory.name },
            endBlock - startBlock + 1
          );
        });
      }

      /** END: Same logic as log worker. */
    }

    this.childContractProgressTrackers[task.factory.name].addCompletedInterval([
      task.fromBlock,
      task.toBlock,
    ]);

    this.enqueueBlockTasks();

    this.common.logger.trace({
      service: "historical",
      msg: `Completed child contract task [${task.fromBlock}, ${task.toBlock}] (childContract=${task.factory.name}, network=${this.network.name})`,
    });
  };

  private blockTaskWorker = async ({ task }: { task: BlockTask }) => {
    const { blockNumber, callbacks } = task;

    const stopClock = startClock();
    const block = await this.network.client.request({
      method: "eth_getBlockByNumber",
      params: [toHex(blockNumber), true],
    });

    this.common.metrics.ponder_historical_rpc_request_duration.observe(
      { method: "eth_getBlockByNumber", network: this.network.name },
      stopClock()
    );

    if (!block) throw new Error(`Block not found: ${blockNumber}`);

    await Promise.all(callbacks.map((cb) => cb(block)));

    const newBlockCheckpoint = this.blockProgressTracker.addCompletedBlock({
      blockNumber,
      blockTimestamp: hexToNumber(block.timestamp),
    });

    if (newBlockCheckpoint) {
      this.emit("historicalCheckpoint", newBlockCheckpoint);
    }

    this.common.logger.trace({
      service: "historical",
      msg: `Completed block task ${hexToNumber(block.number!)} containing ${
        callbacks.length
      } callbacks (network=${this.network.name})`,
    });
  };

  private enqueueBlockTasks = () => {
    const blockTasksCanBeEnqueuedTo = Math.min(
      ...Object.values(this.logFilterProgressTrackers).map((i) =>
        i.getCheckpoint()
      ),
      ...Object.values(this.childContractProgressTrackers).map((i) =>
        i.getCheckpoint()
      )
    );

    if (blockTasksCanBeEnqueuedTo > this.blockTasksEnqueuedCheckpoint) {
      const newBlocks = Object.keys(this.blockCallbacks)
        .map(Number)
        .filter((blockNumber) => blockNumber <= blockTasksCanBeEnqueuedTo);

      this.blockProgressTracker.addPendingBlocks({ blockNumbers: newBlocks });

      for (const blockNumber of newBlocks) {
        this.queue.addTask(
          {
            kind: "BLOCK",
            blockNumber,
            callbacks: this.blockCallbacks[blockNumber],
          },
          { priority: Number.MAX_SAFE_INTEGER - blockNumber }
        );
        delete this.blockCallbacks[blockNumber];
      }

      this.blockTasksEnqueuedCheckpoint = blockTasksCanBeEnqueuedTo;
    }
  };

  private getCompletionStats = async () => {
    const cachedBlocksMetric = (
      await this.common.metrics.ponder_historical_cached_blocks.get()
    ).values;
    const totalBlocksMetric = (
      await this.common.metrics.ponder_historical_total_blocks.get()
    ).values;
    const completedBlocksMetric = (
      await this.common.metrics.ponder_historical_completed_blocks.get()
    ).values;

    const eventSourceNames = [
      ...this.logFilters.map((l) => l.name),
      ...this.factories.map((f) => f.name),
    ];

    return eventSourceNames.map((name) => {
      const totalBlocks = totalBlocksMetric.find(
        (m) => m.labels.eventSource === name
      )?.value;
      const cachedBlocks = cachedBlocksMetric.find(
        (m) => m.labels.eventSource === name
      )?.value;
      const completedBlocks =
        completedBlocksMetric.find((m) => m.labels.eventSource === name)
          ?.value ?? 0;

      // If the total_blocks metric is set and equals zero, the sync was skipped and
      // should be considered complete.
      if (totalBlocks === 0) {
        return { eventSource: name, rate: 1, eta: 0 };
      }

      // Any of these mean setup is not complete.
      if (
        totalBlocks === undefined ||
        cachedBlocks === undefined ||
        !this.startTimestamp
      ) {
        return { eventSource: name, rate: 0 };
      }

      const rate = (cachedBlocks + completedBlocks) / totalBlocks;

      // If fewer than 3 blocks have been processsed, the ETA will be low quality.
      if (completedBlocks < 3) return { eventSource: name, rate };

      // If rate is 1, sync is complete, so set the ETA to zero.
      if (rate === 1) return { eventSource: name, rate, eta: 0 };

      // (time elapsed) / (% completion of remaining block range)
      const elapsed = hrTimeToMs(process.hrtime(this.startTimestamp));
      const estimatedTotalDuration =
        elapsed / (completedBlocks / (totalBlocks - cachedBlocks));
      const estimatedTimeRemaining = estimatedTotalDuration - elapsed;

      return { eventSource: name, rate, eta: estimatedTimeRemaining };
    });
  };

  private registerMetricCollectMethods = async () => {
    // The `prom-client` base Metric class does allow dynamic assignment
    // of the `collect()` method, but it's not typed as such.

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.common.metrics.ponder_historical_completion_rate.collect =
      async () => {
        const completionStats = await this.getCompletionStats();
        completionStats.forEach(({ eventSource, rate }) => {
          this.common.metrics.ponder_historical_completion_rate.set(
            { eventSource, network: this.network.name },
            rate
          );
        });
      };

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.common.metrics.ponder_historical_completion_eta.collect = async () => {
      const completionStats = await this.getCompletionStats();
      completionStats.forEach(({ eventSource, eta }) => {
        // If no progress has been made, can't calculate an accurate ETA.
        if (eta) {
          this.common.metrics.ponder_historical_completion_eta.set(
            { eventSource, network: this.network.name },
            eta
          );
        }
      });
    };
  };
}
