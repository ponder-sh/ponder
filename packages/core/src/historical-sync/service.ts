import Emittery from "emittery";
import {
  type Hash,
  type RpcTransaction,
  hexToBigInt,
  hexToNumber,
  HttpRequestError,
  InvalidParamsRpcError,
  RpcBlock,
  RpcLog,
  toHex,
} from "viem";

import { FactoryContract } from "@/config/factories";
import type { LogFilter } from "@/config/logFilters";
import type { Network } from "@/config/networks";
import type { EventStore } from "@/event-store/store";
import type { Common } from "@/Ponder";
import { formatEta, formatPercentage } from "@/utils/format";
import {
  getChunks,
  intervalDifference,
  intervalIntersection,
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

type FactoryContractTask = {
  kind: "FACTORY_CONTRACT";
  factoryContract: FactoryContract;
  fromBlock: number;
  toBlock: number;
};

type ChildContractTask = {
  kind: "CHILD_CONTRACT";
  factoryContract: FactoryContract;
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
  | FactoryContractTask
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
  private factoryContracts: FactoryContract[];

  /**
   * Block progress trackers for each task type.
   */
  private logFilterProgressTrackers: Record<string, ProgressTracker> = {};
  private factoryContractProgressTrackers: Record<string, ProgressTracker> = {};
  private childContractProgressTrackers: Record<string, ProgressTracker> = {};

  /**
   * Functions registered by log filter + child contract tasks. These functions accept
   * a raw block object, get required data from it, then insert data and cache metadata
   * into the event store.
   */
  private blockCallbacks: Record<
    number,
    ((block: RpcBlock) => Promise<void>)[]
  > = {};

  /**
   * Block tasks have been added to the queue up to and including this block number.
   */
  private blockTasksEnqueuedCheckpoint = 0;

  /**
   * Block task numbers that are currently in progress. On completing a block task,
   * this set is used to determine whether or not the historicalCheckpoint event should
   * be emitted.
   */
  private blockTasksInProgress = new Set<number>();

  private queue: Queue<HistoricalSyncTask>;
  private startTimestamp?: [number, number];
  private killFunctions: (() => void | Promise<void>)[] = [];

  constructor({
    common,
    eventStore,
    network,
    logFilters = [],
    factoryContracts = [],
  }: {
    common: Common;
    eventStore: EventStore;
    network: Network;
    logFilters?: LogFilter[];
    factoryContracts?: FactoryContract[];
  }) {
    super();

    this.common = common;
    this.eventStore = eventStore;
    this.network = network;
    this.logFilters = logFilters;
    this.factoryContracts = factoryContracts;

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
            startBlock: logFilter.filter.startBlock,
            endBlock: logFilter.filter.endBlock,
            finalizedBlockNumber,
            latestBlockNumber,
          });

        if (!isHistoricalSyncRequired) {
          this.logFilterProgressTrackers[logFilter.name] = new ProgressTracker({
            target: [startBlock, finalizedBlockNumber],
            completed: [[startBlock, finalizedBlockNumber]],
          });
          // this.common.metrics.ponder_historical_total_blocks.set(
          //   { network: this.network.name, logFilter: logFilter.name },
          //   0
          // );
          // this.common.logger.warn({
          //   service: "historical",
          //   msg: `Start block is not finalized, skipping historical sync (logFilter=${logFilter.name})`,
          // });
          return;
        }

        const logFilterProgressTracker = new ProgressTracker({
          target: [startBlock, endBlock],
          completed: await this.eventStore.getLogFilterIntervals({
            chainId: logFilter.chainId,
            logFilter: {
              address: logFilter.filter.address,
              topics: logFilter.filter.topics,
            },
          }),
        });
        this.logFilterProgressTrackers[logFilter.name] =
          logFilterProgressTracker;

        const logFilterTaskChunks = getChunks({
          intervals: logFilterProgressTracker.getRequired(),
          maxChunkSize:
            logFilter.maxBlockRange ?? this.network.defaultMaxBlockRange,
        });

        for (const [fromBlock, toBlock] of logFilterTaskChunks) {
          this.queue.addTask(
            { kind: "LOG_FILTER", logFilter, fromBlock, toBlock },
            { priority: Number.MAX_SAFE_INTEGER - fromBlock }
          );

          this.common.metrics.ponder_historical_scheduled_tasks.inc({
            network: this.network.name,
            kind: "log",
          });
        }
      }),
      ...this.factoryContracts.map(async (factoryContract) => {
        const { isHistoricalSyncRequired, startBlock, endBlock } =
          validateHistoricalBlockRange({
            startBlock: factoryContract.startBlock,
            endBlock: factoryContract.endBlock,
            finalizedBlockNumber,
            latestBlockNumber,
          });

        if (!isHistoricalSyncRequired) {
          this.factoryContractProgressTrackers[factoryContract.name] =
            new ProgressTracker({
              target: [startBlock, finalizedBlockNumber],
              completed: [[startBlock, finalizedBlockNumber]],
            });
          this.childContractProgressTrackers[factoryContract.name] =
            new ProgressTracker({
              target: [startBlock, finalizedBlockNumber],
              completed: [[startBlock, finalizedBlockNumber]],
            });
          // this.common.metrics.ponder_historical_total_blocks.set(
          //   { network: this.network.name, logFilter: logFilter.name },
          //   0
          // );
          // this.common.logger.warn({
          //   service: "historical",
          //   msg: `Start block is not finalized, skipping historical sync (logFilter=${logFilter.name})`,
          // });
          return;
        }

        const factoryProgressTracker = new ProgressTracker({
          target: [startBlock, endBlock],
          completed: await this.eventStore.getFactoryContractIntervals({
            chainId: factoryContract.chainId,
            factoryContract: {
              address: factoryContract.address,
              eventSelector: factoryContract.factoryEventSelector,
            },
          }),
        });
        this.factoryContractProgressTrackers[factoryContract.name] =
          factoryProgressTracker;

        const childProgressTracker = new ProgressTracker({
          target: [startBlock, endBlock],
          completed: await this.eventStore.getChildContractIntervals({
            chainId: factoryContract.chainId,
            factoryContract: {
              address: factoryContract.address,
              eventSelector: factoryContract.factoryEventSelector,
            },
          }),
        });
        this.childContractProgressTrackers[factoryContract.name] =
          childProgressTracker;

        const factoryTaskChunks = getChunks({
          intervals: factoryProgressTracker.getRequired(),
          maxChunkSize:
            factoryContract.maxBlockRange ?? this.network.defaultMaxBlockRange,
        });

        for (const [fromBlock, toBlock] of factoryTaskChunks) {
          this.queue.addTask(
            { kind: "FACTORY_CONTRACT", factoryContract, fromBlock, toBlock },
            { priority: Number.MAX_SAFE_INTEGER - fromBlock }
          );
        }

        // Manually add child log tasks for any intervals where the factory
        // logs are cached, but the child logs are not. These won't be added
        // automatically by the factory log tasks.
        const missingChildTaskChunks = intervalIntersection(
          factoryProgressTracker.getCheckpoint() >= startBlock
            ? [[startBlock, factoryProgressTracker.getCheckpoint()]]
            : [],
          intervalDifference(
            childProgressTracker.getRequired(),
            factoryProgressTracker.getRequired()
          )
        );

        for (const [fromBlock, toBlock] of missingChildTaskChunks) {
          this.queue.addTask(
            { kind: "CHILD_CONTRACT", factoryContract, fromBlock, toBlock },
            { priority: Number.MAX_SAFE_INTEGER - fromBlock }
          );
        }
      }),
    ]);
  }

  start() {
    this.startTimestamp = process.hrtime();

    // Emit status update logs on an interval for each active log filter.
    const updateLogInterval = setInterval(async () => {
      const completionStats = await this.getCompletionStats();

      completionStats.forEach(({ logFilter, rate, eta }) => {
        if (rate === 1) return;
        this.common.logger.info({
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
          await this.factoryContractTaskWorker({ task });
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

      // // It's possible for multiple block sync tasks to run simultaneously,
      // // resulting in a scenario where cached ranges are not fully merged.
      // // Merge all cached ranges once last time before emitting the `syncComplete` event.
      // await Promise.all(
      //   this.logFilters.map((logFilter) =>
      //     this.updateHistoricalCheckpoint({ logFilter })
      //   )
      // );

      this.emit("syncComplete");
      const duration = hrTimeToMs(process.hrtime(this.startTimestamp));
      this.common.logger.info({
        service: "historical",
        msg: `Completed sync in ${formatEta(duration)} (network=${
          this.network.name
        })`,
        network: this.network.name,
        duration,
      });
    };

    const queue = createQueue<HistoricalSyncTask>({
      worker,
      options: {
        concurrency: this.network.maxRpcRequestConcurrency,
        autoStart: false,
      },
      onError: ({ error, task, queue }) => {
        console.log({ error, task });

        switch (task.kind) {
          case "LOG_FILTER": {
            this.common.metrics.ponder_historical_completed_tasks.inc({
              network: this.network.name,
              kind: "log",
              status: "failure",
            });

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
              // Splitting the task into two parts increases the total count by 1.
              this.common.metrics.ponder_historical_scheduled_tasks.inc({
                network: this.network.name,
                kind: "log",
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
              queue.addTask(
                { ...task, toBlock: midpoint },
                { priority: Number.MAX_SAFE_INTEGER - task.fromBlock }
              );
              queue.addTask(
                { ...task, fromBlock: midpoint + 1 },
                { priority: Number.MAX_SAFE_INTEGER - midpoint + 1 }
              );
              // Splitting the task into two parts increases the total count by 1.
              this.common.metrics.ponder_historical_scheduled_tasks.inc({
                network: this.network.name,
                kind: "log",
              });
              return;
            }

            this.common.logger.error({
              service: "historical",
              msg: `Log sync task failed (network=${this.network.name}, logFilter=${task.logFilter.name})`,
              error,
              network: this.network.name,
              logFilter: task.logFilter.name,
              fromBlock: task.fromBlock,
              toBlock: task.toBlock,
            });

            // Default to a retry (uses the retry options passed to the queue).
            const priority = Number.MAX_SAFE_INTEGER - task.fromBlock;
            queue.addTask(task, { priority, retry: true });

            break;
          }
          // case "BLOCK_SYNC": {
          //   this.common.metrics.ponder_historical_completed_tasks.inc({
          //     network: this.network.name,
          //     kind: "block",
          //     status: "failure",
          //   });

          //   this.common.logger.error({
          //     service: "historical",
          //     msg: `Block sync task failed (network=${this.network.name}, logFilter=${task.logFilter.name})`,
          //     error,
          //     network: this.network.name,
          //     logFilter: task.logFilter.name,
          //     blockNumberToCacheFrom: task.blockNumberToCacheFrom,
          //     blockNumber: task.blockNumber,
          //     requiredTransactionCount: task.requiredTxHashes.size,
          //   });

          //   // Default to a retry (uses the retry options passed to the queue).
          //   const priority =
          //     Number.MAX_SAFE_INTEGER - task.blockNumberToCacheFrom;
          //   queue.addTask(task, { priority, retry: true });

          //   break;
          // }
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
          address: logFilter.filter.address,
          topics: logFilter.filter.topics,
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
    if (requiredBlocks.length === 0 || requiredBlocks[-1] < task.toBlock) {
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

        await this.eventStore.insertLogFilterInterval({
          chainId: logFilter.chainId,
          block,
          transactions,
          logs,
          logFilter: {
            address: logFilter.filter.address,
            topics: logFilter.filter.topics,
          },
          interval: {
            startBlock: BigInt(startBlock),
            endBlock: BigInt(endBlock),
            endBlockTimestamp: hexToBigInt(block.timestamp!),
          },
        });
      });
    }

    this.enqueueBlockTasks();

    // this.common.metrics.ponder_historical_completed_tasks.inc({
    //   network: this.network.name,
    //   kind: "log",
    //   status: "success",
    // });

    // this.common.logger.trace({
    //   service: "historical",
    //   msg: `Completed log sync task [${task.fromBlock}, ${task.toBlock}] (logFilter=${task.logFilter.name}, network=${this.network.name})`,
    //   network: this.network.name,
    //   logFilter: task.logFilter.name,
    //   fromBlock: task.fromBlock,
    //   toBlock: task.toBlock,
    // });
  };

  private factoryContractTaskWorker = async ({
    task,
  }: {
    task: FactoryContractTask;
  }) => {
    const { factoryContract, fromBlock, toBlock } = task;

    console.log("in factoryContractTaskWorker", { fromBlock, toBlock });

    const stopClock = startClock();
    const logs = await this.network.client.request({
      method: "eth_getLogs",
      params: [
        {
          address: factoryContract.address,
          topics: [factoryContract.factoryEventSelector],
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
      address: factoryContract.getAddressFromFactoryEventLog(log),
      creationBlock: hexToBigInt(log.blockNumber!),
    }));

    console.log({
      newChildContracts,
    });

    await this.eventStore.insertFactoryContractInterval({
      chainId: factoryContract.chainId,
      childContracts: newChildContracts,
      factoryContract: {
        address: factoryContract.address,
        eventSelector: factoryContract.factoryEventSelector,
      },
      interval: {
        startBlock: BigInt(fromBlock),
        endBlock: BigInt(toBlock),
      },
    });

    const { isUpdated, prevCheckpoint, newCheckpoint } =
      this.factoryContractProgressTrackers[
        factoryContract.name
      ].addCompletedInterval([fromBlock, toBlock]);

    console.log({ isUpdated, prevCheckpoint, newCheckpoint });

    if (isUpdated) {
      const childContractTaskChunks = getChunks({
        intervals: [[prevCheckpoint + 1, newCheckpoint]],
        maxChunkSize:
          factoryContract.maxBlockRange ?? this.network.defaultMaxBlockRange,
      });

      for (const [fromBlock, toBlock] of childContractTaskChunks) {
        this.queue.addTask(
          { kind: "CHILD_CONTRACT", factoryContract, fromBlock, toBlock },
          { priority: Number.MAX_SAFE_INTEGER - fromBlock }
        );
      }
    }
  };

  private childContractTaskWorker = async ({
    task,
  }: {
    task: ChildContractTask;
  }) => {
    const iterator = this.eventStore.getChildContractAddresses({
      chainId: task.factoryContract.chainId,
      upToBlockNumber: BigInt(task.toBlock),
      factoryContract: {
        address: task.factoryContract.address,
        eventSelector: task.factoryContract.factoryEventSelector,
      },
    });

    console.log("in childContractTaskWorker", {
      fromBlock: task.fromBlock,
      toBlock: task.toBlock,
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

      console.log({ childContractAddressBatch });
      console.log("got logs:", logs.length);

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

      console.log({ requiredBlocks: requiredBlocks.length });

      // If toBlock is not already required, add it. This is necessary
      // to reflect the availability of logs for the full range of the
      // eth_getLogs request.
      if (requiredBlocks.length === 0 || requiredBlocks[-1] < task.toBlock) {
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

          await this.eventStore.insertChildContractInterval({
            chainId: task.factoryContract.chainId,
            block,
            transactions,
            logs,
            factoryContract: {
              address: task.factoryContract.address,
              eventSelector: task.factoryContract.factoryEventSelector,
            },
            interval: {
              startBlock: BigInt(startBlock),
              endBlock: BigInt(endBlock),
              endBlockTimestamp: hexToBigInt(block.timestamp!),
            },
          });
        });
      }

      /** END: Same logic as log worker. */
    }

    this.childContractProgressTrackers[
      task.factoryContract.name
    ].addCompletedInterval([task.fromBlock, task.toBlock]);

    this.enqueueBlockTasks();
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

    console.log("finished block", blockNumber);

    const minInProgressBlockNumber = Math.min(...this.blockTasksInProgress);
    this.blockTasksInProgress.delete(blockNumber);
    if (
      this.blockTasksInProgress.size === 0 ||
      blockNumber === minInProgressBlockNumber
    ) {
      console.log("emitting historical checkpoint", {
        blockNumber: hexToNumber(block.number!),
        blockTimestamp: hexToNumber(block.timestamp),
      });

      this.emit("historicalCheckpoint", {
        blockNumber: hexToNumber(block.number!),
        blockTimestamp: hexToNumber(block.timestamp),
      });
    }
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

    console.log({
      blockTasksEnqueuedCheckpoint: this.blockTasksEnqueuedCheckpoint,
      blockTasksCanBeEnqueuedTo,
    });

    if (blockTasksCanBeEnqueuedTo > this.blockTasksEnqueuedCheckpoint) {
      const newBlocks = Object.keys(this.blockCallbacks)
        .map(Number)
        .filter((blockNumber) => blockNumber <= blockTasksCanBeEnqueuedTo);

      for (const blockNumber of newBlocks) {
        this.blockTasksInProgress.add(blockNumber);

        console.log({
          blockNumber,
          callbacks: this.blockCallbacks[blockNumber],
        });

        this.queue.addTask(
          {
            kind: "BLOCK",
            blockNumber,
            callbacks: this.blockCallbacks[blockNumber],
          },
          { priority: Number.MAX_SAFE_INTEGER - blockNumber }
        );
        delete this.blockCallbacks[blockNumber]; // TODO: Is this necessary?
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
    this.common.metrics.ponder_historical_completion_rate.collect =
      async () => {
        const completionStats = await this.getCompletionStats();
        completionStats.forEach(({ logFilter, rate }) => {
          this.common.metrics.ponder_historical_completion_rate.set(
            { logFilter, network: this.network.name },
            rate
          );
        });
      };

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.common.metrics.ponder_historical_completion_eta.collect = async () => {
      const completionStats = await this.getCompletionStats();
      completionStats.forEach(({ logFilter, eta }) => {
        // If no progress has been made, can't calculate an accurate ETA.
        if (eta) {
          this.common.metrics.ponder_historical_completion_eta.set(
            { logFilter, network: this.network.name },
            eta
          );
        }
      });
    };
  };
}
