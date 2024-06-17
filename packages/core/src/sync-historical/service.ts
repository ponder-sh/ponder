import type { Common } from "@/common/common.js";
import { getHistoricalSyncProgress } from "@/common/metrics.js";
import type { Network } from "@/config/networks.js";
import type {
  BlockSource,
  CallTraceSource,
  EventSource,
  FactoryCallTraceSource,
  FactoryLogSource,
  LogSource,
} from "@/config/sources.js";
import type { SyncStore } from "@/sync-store/store.js";
import {
  type SyncBlock,
  type SyncCallTrace,
  type SyncLog,
  _eth_getBlockByNumber,
  _eth_getLogs,
  _eth_getTransactionReceipt,
  _trace_filter,
} from "@/sync/index.js";
import { type Checkpoint, maxCheckpoint } from "@/utils/checkpoint.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import {
  BlockProgressTracker,
  ProgressTracker,
  getChunks,
  intervalDifference,
  intervalIntersection,
  intervalSum,
} from "@/utils/interval.js";
import { never } from "@/utils/never.js";
import { type Queue, type Worker, createQueue } from "@/utils/queue.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import { debounce, dedupe } from "@ponder/common";
import Emittery from "emittery";
import { type Hash, hexToNumber, numberToHex, toHex } from "viem";

const HISTORICAL_CHECKPOINT_EMIT_INTERVAL = 500;
const TRACE_FILTER_CHUNK_SIZE = 10;

type HistoricalSyncEvents = {
  /**
   * Emitted when the service has finished processing all historical sync tasks.
   */
  syncComplete: undefined;
  /**
   * Emitted when the minimum cached timestamp among all registered sources moves forward.
   * This indicates to consumers that the connected sync store now contains a complete history
   * of events for all registered sources between their start block and this timestamp (inclusive).
   */
  historicalCheckpoint: Checkpoint;
};

type FactoryChildAddressTask = {
  kind: "FACTORY_CHILD_ADDRESS";
  factory: FactoryLogSource | FactoryCallTraceSource;
  fromBlock: number;
  toBlock: number;
};

type LogFilterTask = {
  kind: "LOG_FILTER";
  logFilter: LogSource;
  fromBlock: number;
  toBlock: number;
};

type FactoryLogFilterTask = {
  kind: "FACTORY_LOG_FILTER";
  factoryLogFilter: FactoryLogSource;
  fromBlock: number;
  toBlock: number;
};

type TraceFilterTask = {
  kind: "TRACE_FILTER";
  traceFilter: CallTraceSource;
  fromBlock: number;
  toBlock: number;
};

type FactoryTraceFilterTask = {
  kind: "FACTORY_TRACE_FILTER";
  factoryTraceFilter: FactoryCallTraceSource;
  fromBlock: number;
  toBlock: number;
};

type BlockFilterTask = {
  kind: "BLOCK_FILTER";
  blockFilter: BlockSource;
  fromBlock: number;
  toBlock: number;
};

type BlockTask = {
  kind: "BLOCK";
  blockNumber: number;
  callbacks: ((block: SyncBlock) => Promise<void>)[];
};

type HistoricalSyncTask =
  | FactoryChildAddressTask
  | LogFilterTask
  | FactoryLogFilterTask
  | TraceFilterTask
  | FactoryTraceFilterTask
  | BlockFilterTask
  | BlockTask;

export class HistoricalSyncService extends Emittery<HistoricalSyncEvents> {
  private common: Common;
  private syncStore: SyncStore;
  private network: Network;
  private requestQueue: RequestQueue;
  private sources: EventSource[];

  /**
   * Block progress trackers for each task type.
   */
  private logFilterProgressTrackers: Record<string, ProgressTracker> = {};
  private factoryChildAddressProgressTrackers: Record<string, ProgressTracker> =
    {};
  private factoryLogFilterProgressTrackers: Record<string, ProgressTracker> =
    {};
  private traceFilterProgressTrackers: Record<string, ProgressTracker> = {};
  private factoryTraceFilterProgressTrackers: Record<string, ProgressTracker> =
    {};
  private blockFilterProgressTrackers: Record<string, ProgressTracker> = {};

  private blockProgressTracker: BlockProgressTracker =
    new BlockProgressTracker();

  /**
   * Functions registered by log filter + child contract tasks. These functions accept
   * a raw block object, get required data from it, then insert data and cache metadata
   * into the sync store. The keys of this object are used to keep track of which blocks
   * must be fetched.
   */
  private blockCallbacks: Record<
    number,
    ((block: SyncBlock) => Promise<void>)[]
  > = {};

  /**
   * Block tasks have been added to the queue up to and including this block number.
   * Used alongside blockCallbacks to keep track of which block tasks to add to the queue.
   */
  private blockTasksEnqueuedCheckpoint = 0;

  private queue: Queue<HistoricalSyncTask>;

  /** If true, failed tasks should not log errors or be retried. */
  private isShuttingDown = false;
  private progressLogInterval?: NodeJS.Timeout;

  constructor({
    common,
    syncStore,
    network,
    requestQueue,
    sources = [],
  }: {
    common: Common;
    syncStore: SyncStore;
    network: Network;
    requestQueue: RequestQueue;
    sources?: EventSource[];
  }) {
    super();

    this.common = common;
    this.syncStore = syncStore;
    this.network = network;
    this.requestQueue = requestQueue;
    this.sources = sources;

    this.queue = this.buildQueue();
  }

  async setup({
    finalizedBlockNumber,
  }: {
    finalizedBlockNumber: number;
  }) {
    // Initialize state variables. Required when restarting the service.
    this.isShuttingDown = false;
    this.blockTasksEnqueuedCheckpoint = 0;

    for (const source of this.sources) {
      const startBlock = source.startBlock;
      const endBlock = source.endBlock ?? finalizedBlockNumber;

      if (source.startBlock > finalizedBlockNumber) {
        switch (source.type) {
          case "log":
          case "factoryLog": {
            this.common.metrics.ponder_historical_total_blocks.set(
              {
                network: this.network.name,
                source: source.contractName,
                type: "log",
              },
              0,
            );
            this.common.logger.warn({
              service: "historical",
              msg: `Skipped syncing '${this.network.name}' logs for '${source.contractName}' because the start block is not finalized`,
            });
            break;
          }

          case "callTrace":
          case "factoryCallTrace": {
            this.common.metrics.ponder_historical_total_blocks.set(
              {
                network: this.network.name,
                source: source.contractName,
                type: "trace",
              },
              0,
            );
            this.common.logger.warn({
              service: "historical",
              msg: `Skipped syncing '${this.network.name}' call traces for '${source.contractName}' because the start block is not finalized`,
            });
            break;
          }

          case "block": {
            this.common.metrics.ponder_historical_total_blocks.set(
              {
                network: this.network.name,
                source: source.sourceName,
                type: "block",
              },
              0,
            );
            this.common.logger.warn({
              service: "historical",
              msg: `Skipped syncing '${this.network.name}' blocks for '${source.sourceName}' because the start block is not finalized`,
            });
            break;
          }

          default:
            never(source);
        }

        return;
      }

      switch (source.type) {
        case "log":
          {
            const completedLogFilterIntervals =
              await this.syncStore.getLogFilterIntervals({
                chainId: source.chainId,
                logFilter: source.criteria,
              });
            const logFilterProgressTracker = new ProgressTracker({
              target: [startBlock, endBlock],
              completed: completedLogFilterIntervals,
            });
            this.logFilterProgressTrackers[source.id] =
              logFilterProgressTracker;

            const requiredLogFilterIntervals =
              logFilterProgressTracker.getRequired();

            const logFilterTaskChunks = getChunks({
              intervals: requiredLogFilterIntervals,
              maxChunkSize:
                source.maxBlockRange ?? this.network.defaultMaxBlockRange,
            });

            for (const [fromBlock, toBlock] of logFilterTaskChunks) {
              this.queue.addTask(
                {
                  kind: "LOG_FILTER",
                  logFilter: source,
                  fromBlock,
                  toBlock,
                },
                { priority: Number.MAX_SAFE_INTEGER - fromBlock },
              );
            }
            if (logFilterTaskChunks.length > 0) {
              const total = intervalSum(requiredLogFilterIntervals);
              this.common.logger.debug({
                service: "historical",
                msg: `Added '${this.network.name}' LOG_FILTER tasks for '${source.contractName}' over a ${total} block range`,
              });
            }

            const targetBlockCount = endBlock - startBlock + 1;
            const cachedBlockCount =
              targetBlockCount - intervalSum(requiredLogFilterIntervals);

            this.common.metrics.ponder_historical_total_blocks.set(
              {
                network: this.network.name,
                source: source.contractName,
                type: "log",
              },
              targetBlockCount,
            );
            this.common.metrics.ponder_historical_cached_blocks.set(
              {
                network: this.network.name,
                source: source.contractName,
                type: "log",
              },
              cachedBlockCount,
            );

            this.common.logger.info({
              service: "historical",
              msg: `Started syncing '${this.network.name}' logs for '${
                source.contractName
              }' with ${formatPercentage(
                Math.min(1, cachedBlockCount / (targetBlockCount || 1)),
              )} cached`,
            });
          }
          break;

        case "factoryLog":
          {
            // Note that factory child address progress is stored using
            // log intervals for the factory log.
            const completedFactoryChildAddressIntervals =
              await this.syncStore.getLogFilterIntervals({
                chainId: source.chainId,
                logFilter: {
                  address: source.criteria.address,
                  topics: [source.criteria.eventSelector],
                  includeTransactionReceipts: false,
                },
              });
            const factoryChildAddressProgressTracker = new ProgressTracker({
              target: [startBlock, endBlock],
              completed: completedFactoryChildAddressIntervals,
            });
            this.factoryChildAddressProgressTrackers[source.id] =
              factoryChildAddressProgressTracker;

            const requiredFactoryChildAddressIntervals =
              factoryChildAddressProgressTracker.getRequired();
            const factoryChildAddressTaskChunks = getChunks({
              intervals: requiredFactoryChildAddressIntervals,
              maxChunkSize:
                source.maxBlockRange ?? this.network.defaultMaxBlockRange,
            });

            for (const [fromBlock, toBlock] of factoryChildAddressTaskChunks) {
              this.queue.addTask(
                {
                  kind: "FACTORY_CHILD_ADDRESS",
                  factory: source,
                  fromBlock,
                  toBlock,
                },
                { priority: Number.MAX_SAFE_INTEGER - fromBlock },
              );
            }
            if (factoryChildAddressTaskChunks.length > 0) {
              const total = intervalSum(requiredFactoryChildAddressIntervals);
              this.common.logger.debug({
                service: "historical",
                msg: `Added '${this.network.name}' FACTORY_CHILD_ADDRESS tasks for '${source.contractName}' over a ${total} block range`,
              });
            }

            const targetFactoryChildAddressBlockCount =
              endBlock - startBlock + 1;
            const cachedFactoryChildAddressBlockCount =
              targetFactoryChildAddressBlockCount -
              intervalSum(requiredFactoryChildAddressIntervals);

            this.common.metrics.ponder_historical_total_blocks.set(
              {
                network: this.network.name,
                source: `${source.contractName}_factory`,
                type: "log",
              },
              targetFactoryChildAddressBlockCount,
            );
            this.common.metrics.ponder_historical_cached_blocks.set(
              {
                network: this.network.name,
                source: `${source.contractName}_factory`,
                type: "log",
              },
              cachedFactoryChildAddressBlockCount,
            );

            const completedFactoryLogFilterIntervals =
              await this.syncStore.getFactoryLogFilterIntervals({
                chainId: source.chainId,
                factory: source.criteria,
              });
            const factoryLogFilterProgressTracker = new ProgressTracker({
              target: [startBlock, endBlock],
              completed: completedFactoryLogFilterIntervals,
            });
            this.factoryLogFilterProgressTrackers[source.id] =
              factoryLogFilterProgressTracker;

            // Only add factory log filter tasks for any intervals where the
            // child address tasks are completed, but the factory log filter tasks are not,
            // because these won't be added automatically by child address tasks.
            const requiredFactoryLogFilterIntervals =
              factoryLogFilterProgressTracker.getRequired();
            const missingFactoryLogFilterIntervals = intervalDifference(
              requiredFactoryLogFilterIntervals,
              requiredFactoryChildAddressIntervals,
            );

            const missingFactoryLogFilterTaskChunks = getChunks({
              intervals: missingFactoryLogFilterIntervals,
              maxChunkSize:
                source.maxBlockRange ?? this.network.defaultMaxBlockRange,
            });

            for (const [
              fromBlock,
              toBlock,
            ] of missingFactoryLogFilterTaskChunks) {
              this.queue.addTask(
                {
                  kind: "FACTORY_LOG_FILTER",
                  factoryLogFilter: source,
                  fromBlock,
                  toBlock,
                },
                { priority: Number.MAX_SAFE_INTEGER - fromBlock },
              );
            }
            if (missingFactoryLogFilterTaskChunks.length > 0) {
              const total = intervalSum(missingFactoryLogFilterIntervals);
              this.common.logger.debug({
                service: "historical",
                msg: `Added '${this.network.name}' FACTORY_LOG_FILTER tasks for '${source.contractName}' over a ${total} block range`,
              });
            }

            const targetFactoryLogFilterBlockCount = endBlock - startBlock + 1;
            const cachedFactoryLogFilterBlockCount =
              targetFactoryLogFilterBlockCount -
              intervalSum(requiredFactoryLogFilterIntervals);

            this.common.metrics.ponder_historical_total_blocks.set(
              {
                network: this.network.name,
                source: source.contractName,
                type: "log",
              },
              targetFactoryLogFilterBlockCount,
            );
            this.common.metrics.ponder_historical_cached_blocks.set(
              {
                network: this.network.name,
                source: source.contractName,
                type: "log",
              },
              cachedFactoryLogFilterBlockCount,
            );

            // Use factory log filter progress for the logger because it better represents
            // user-facing progress.
            const cacheRate = Math.min(
              1,
              cachedFactoryLogFilterBlockCount /
                (targetFactoryLogFilterBlockCount || 1),
            );
            this.common.logger.info({
              service: "historical",
              msg: `Started syncing '${this.network.name}' logs for '${
                source.contractName
              }' with ${formatPercentage(cacheRate)} cached`,
            });
          }
          break;

        case "callTrace":
          {
            const completedTraceFilterIntervals =
              await this.syncStore.getTraceFilterIntervals({
                chainId: source.chainId,
                traceFilter: source.criteria,
              });
            const traceFilterProgressTracker = new ProgressTracker({
              target: [startBlock, endBlock],
              completed: completedTraceFilterIntervals,
            });
            this.traceFilterProgressTrackers[source.id] =
              traceFilterProgressTracker;

            const requiredTraceFilterIntervals =
              traceFilterProgressTracker.getRequired();

            const traceFilterTaskChunks = getChunks({
              intervals: requiredTraceFilterIntervals,
              maxChunkSize: TRACE_FILTER_CHUNK_SIZE,
            });

            for (const [fromBlock, toBlock] of traceFilterTaskChunks) {
              this.queue.addTask(
                {
                  kind: "TRACE_FILTER",
                  traceFilter: source,
                  fromBlock,
                  toBlock,
                },
                { priority: Number.MAX_SAFE_INTEGER - fromBlock },
              );
            }
            if (traceFilterTaskChunks.length > 0) {
              const total = intervalSum(requiredTraceFilterIntervals);
              this.common.logger.debug({
                service: "historical",
                msg: `Added '${this.network.name}' TRACE_FILTER tasks for '${source.contractName}' over a ${total} block range`,
              });
            }

            const targetBlockCount = endBlock - startBlock + 1;
            const cachedBlockCount =
              targetBlockCount - intervalSum(requiredTraceFilterIntervals);

            this.common.metrics.ponder_historical_total_blocks.set(
              {
                network: this.network.name,
                source: source.contractName,
                type: "trace",
              },
              targetBlockCount,
            );
            this.common.metrics.ponder_historical_cached_blocks.set(
              {
                network: this.network.name,
                source: source.contractName,
                type: "trace",
              },
              cachedBlockCount,
            );

            this.common.logger.info({
              service: "historical",
              msg: `Started syncing '${this.network.name}' call traces for '${
                source.contractName
              }' with ${formatPercentage(
                Math.min(1, cachedBlockCount / (targetBlockCount || 1)),
              )} cached`,
            });
          }
          break;

        case "factoryCallTrace":
          {
            // Note that factory child address progress is stored using
            // log intervals for the factory log.
            const completedFactoryChildAddressIntervals =
              await this.syncStore.getLogFilterIntervals({
                chainId: source.chainId,
                logFilter: {
                  address: source.criteria.address,
                  topics: [source.criteria.eventSelector],
                  includeTransactionReceipts: false,
                },
              });
            const factoryChildAddressProgressTracker = new ProgressTracker({
              target: [startBlock, endBlock],
              completed: completedFactoryChildAddressIntervals,
            });
            this.factoryChildAddressProgressTrackers[source.id] =
              factoryChildAddressProgressTracker;

            const requiredFactoryChildAddressIntervals =
              factoryChildAddressProgressTracker.getRequired();
            const factoryChildAddressTaskChunks = getChunks({
              intervals: requiredFactoryChildAddressIntervals,
              maxChunkSize:
                source.maxBlockRange ?? this.network.defaultMaxBlockRange,
            });

            for (const [fromBlock, toBlock] of factoryChildAddressTaskChunks) {
              this.queue.addTask(
                {
                  kind: "FACTORY_CHILD_ADDRESS",
                  factory: source,
                  fromBlock,
                  toBlock,
                },
                { priority: Number.MAX_SAFE_INTEGER - fromBlock },
              );
            }
            if (factoryChildAddressTaskChunks.length > 0) {
              const total = intervalSum(requiredFactoryChildAddressIntervals);
              this.common.logger.debug({
                service: "historical",
                msg: `Added '${this.network.name}' FACTORY_CHILD_ADDRESS tasks for '${source.contractName}' over a ${total} block range`,
              });
            }

            const targetFactoryChildAddressBlockCount =
              endBlock - startBlock + 1;
            const cachedFactoryChildAddressBlockCount =
              targetFactoryChildAddressBlockCount -
              intervalSum(requiredFactoryChildAddressIntervals);

            this.common.metrics.ponder_historical_total_blocks.set(
              {
                network: this.network.name,
                source: `${source.contractName}_factory`,
                type: "trace",
              },
              targetFactoryChildAddressBlockCount,
            );
            this.common.metrics.ponder_historical_cached_blocks.set(
              {
                network: this.network.name,
                source: `${source.contractName}_factory`,
                type: "trace",
              },
              cachedFactoryChildAddressBlockCount,
            );

            const completedFactoryTraceFilterIntervals =
              await this.syncStore.getFactoryTraceFilterIntervals({
                chainId: source.chainId,
                factory: source.criteria,
              });
            const factoryTraceFilterProgressTracker = new ProgressTracker({
              target: [startBlock, endBlock],
              completed: completedFactoryTraceFilterIntervals,
            });
            this.factoryTraceFilterProgressTrackers[source.id] =
              factoryTraceFilterProgressTracker;

            // Only add factory trace filter tasks for any intervals where the
            // child address tasks are completed, but the factory trace filter tasks are not,
            // because these won't be added automatically by child address tasks.
            const requiredFactoryTraceFilterIntervals =
              factoryTraceFilterProgressTracker.getRequired();
            const missingFactoryTraceFilterIntervals = intervalDifference(
              requiredFactoryTraceFilterIntervals,
              requiredFactoryChildAddressIntervals,
            );

            const missingFactoryTraceFilterTaskChunks = getChunks({
              intervals: missingFactoryTraceFilterIntervals,
              maxChunkSize: TRACE_FILTER_CHUNK_SIZE,
            });

            for (const [
              fromBlock,
              toBlock,
            ] of missingFactoryTraceFilterTaskChunks) {
              this.queue.addTask(
                {
                  kind: "FACTORY_TRACE_FILTER",
                  factoryTraceFilter: source,
                  fromBlock,
                  toBlock,
                },
                { priority: Number.MAX_SAFE_INTEGER - fromBlock },
              );
            }
            if (missingFactoryTraceFilterTaskChunks.length > 0) {
              const total = intervalSum(missingFactoryTraceFilterIntervals);
              this.common.logger.debug({
                service: "historical",
                msg: `Added '${this.network.name}' FACTORY_TRACE_FILTER tasks for '${source.contractName}' over a ${total} block range`,
              });
            }

            const targetFactoryTraceFilterBlockCount =
              endBlock - startBlock + 1;
            const cachedFactoryTraceFilterBlockCount =
              targetFactoryTraceFilterBlockCount -
              intervalSum(requiredFactoryTraceFilterIntervals);

            this.common.metrics.ponder_historical_total_blocks.set(
              {
                network: this.network.name,
                source: source.contractName,
                type: "trace",
              },
              targetFactoryTraceFilterBlockCount,
            );
            this.common.metrics.ponder_historical_cached_blocks.set(
              {
                network: this.network.name,
                source: source.contractName,
                type: "trace",
              },
              cachedFactoryTraceFilterBlockCount,
            );

            // Use factory trace filter progress for the logger because it better represents
            // user-facing progress.
            const cacheRate = Math.min(
              1,
              cachedFactoryTraceFilterBlockCount /
                (targetFactoryTraceFilterBlockCount || 1),
            );
            this.common.logger.info({
              service: "historical",
              msg: `Started syncing '${this.network.name}' call traces for '${
                source.contractName
              }' with ${formatPercentage(cacheRate)} cached`,
            });
          }
          break;

        case "block":
          {
            const completedBlockFilterIntervals =
              await this.syncStore.getBlockFilterIntervals({
                chainId: source.chainId,
                blockFilter: source.criteria,
              });
            const blockFilterProgressTracker = new ProgressTracker({
              target: [startBlock, endBlock],
              completed: completedBlockFilterIntervals,
            });
            this.blockFilterProgressTrackers[source.id] =
              blockFilterProgressTracker;

            const requiredBlockFilterIntervals =
              blockFilterProgressTracker.getRequired();

            // block filters are chunked into intervals to avoid unmanageable
            // amounts of block callbacks being added at once.

            const blockFilterTaskChunks = getChunks({
              intervals: requiredBlockFilterIntervals,
              maxChunkSize: this.network.defaultMaxBlockRange,
            });

            for (const [fromBlock, toBlock] of blockFilterTaskChunks) {
              this.queue.addTask(
                {
                  kind: "BLOCK_FILTER",
                  blockFilter: source,
                  fromBlock,
                  toBlock,
                },
                { priority: Number.MAX_SAFE_INTEGER - fromBlock },
              );
            }
            if (blockFilterTaskChunks.length > 0) {
              const total = intervalSum(requiredBlockFilterIntervals);
              this.common.logger.debug({
                service: "historical",
                msg: `Added '${this.network.name}' BLOCK_FILTER tasks for '${source.sourceName}' over a ${total} block range`,
              });
            }

            const targetBlockCount = endBlock - startBlock + 1;
            const cachedBlockCount =
              targetBlockCount - intervalSum(requiredBlockFilterIntervals);

            this.common.metrics.ponder_historical_total_blocks.set(
              {
                network: this.network.name,
                source: source.sourceName,
                type: "block",
              },
              targetBlockCount,
            );
            this.common.metrics.ponder_historical_cached_blocks.set(
              {
                network: this.network.name,
                source: source.sourceName,
                type: "block",
              },
              cachedBlockCount,
            );

            this.common.logger.info({
              service: "historical",
              msg: `Started syncing '${this.network.name}' blocks for '${
                source.sourceName
              }' with ${formatPercentage(
                Math.min(1, cachedBlockCount / (targetBlockCount || 1)),
              )} cached`,
            });
          }
          break;

        default:
          never(source);
      }
    }
  }

  start() {
    this.common.metrics.ponder_historical_start_timestamp.set(Date.now());

    // Emit status update logs on an interval for each active log filter.
    this.progressLogInterval = setInterval(async () => {
      const historical = await getHistoricalSyncProgress(this.common.metrics);

      historical.sources.forEach(
        ({ networkName, sourceName, progress, eta }) => {
          if (progress === 1 || networkName !== this.network.name) return;
          this.common.logger.info({
            service: "historical",
            msg: `Syncing '${this.network.name}' for '${sourceName}' with ${formatPercentage(
              progress ?? 0,
            )} complete${eta !== undefined ? ` and ~${formatEta(eta)} remaining` : ""}`,
          });
        },
      );
    }, 10_000);

    // Edge case: If there are no tasks in the queue, this means the entire
    // requested range was cached, so the sync is complete.
    if (this.queue.size === 0) {
      clearInterval(this.progressLogInterval);
      this.common.logger.info({
        service: "historical",
        msg: `Finished '${this.network.name}' historical sync`,
      });
      this.emit("syncComplete");
    }

    this.queue.start();
  }

  kill = () => {
    this.isShuttingDown = true;
    clearInterval(this.progressLogInterval);
    this.queue.pause();
    this.queue.clear();
    this.common.logger.debug({
      service: "historical",
      msg: `Killed '${this.network.name}' historical sync`,
    });
  };

  onIdle = () =>
    new Promise((resolve) =>
      setImmediate(() => this.queue.onIdle().then(resolve)),
    );

  private buildQueue = () => {
    const worker: Worker<HistoricalSyncTask> = async ({ task, queue }) => {
      switch (task.kind) {
        case "FACTORY_CHILD_ADDRESS": {
          await this.factoryChildAddressTaskWorker(task);
          break;
        }
        case "LOG_FILTER": {
          await this.logFilterTaskWorker(task);
          break;
        }
        case "FACTORY_LOG_FILTER": {
          await this.factoryLogFilterTaskWorker(task);
          break;
        }
        case "TRACE_FILTER": {
          await this.traceFilterTaskWorker(task);
          break;
        }
        case "FACTORY_TRACE_FILTER": {
          await this.factoryTraceFilterTaskWorker(task);
          break;
        }
        case "BLOCK_FILTER": {
          await this.blockFilterTaskWorker(task);
          break;
        }
        case "BLOCK": {
          await this.blockTaskWorker(task);
          break;
        }
        default:
          never(task);
      }

      // If this is not the final task, return.
      if (queue.size > 0 || queue.pending > 1) return;
      // If this is the final task but the kill() method has been called, do nothing.
      if (this.isShuttingDown) return;

      // If this is the final task, run the cleanup/completion logic.
      clearInterval(this.progressLogInterval);
      const startTimestamp =
        (await this.common.metrics.ponder_historical_start_timestamp.get())
          .values?.[0]?.value ?? Date.now();
      const duration = Date.now() - startTimestamp;
      this.common.logger.info({
        service: "historical",
        msg: `Finished '${this.network.name}' historical sync in ${formatEta(duration)}`,
      });
      this.emit("syncComplete");
    };

    const queue = createQueue<HistoricalSyncTask>({
      worker,
      options: {
        concurrency: this.network.maxHistoricalTaskConcurrency,
        autoStart: false,
      },
      onError: ({ error, task, queue }) => {
        if (this.isShuttingDown) return;

        switch (task.kind) {
          case "FACTORY_CHILD_ADDRESS": {
            this.common.logger.warn({
              service: "historical",
              msg: `Failed to sync '${this.network.name}' child address logs for '${task.factory.contractName}' from block ${task.fromBlock} to ${task.toBlock}`,
              error,
            });
            const priority = Number.MAX_SAFE_INTEGER - task.fromBlock;
            queue.addTask({ ...task }, { priority });
            break;
          }
          case "LOG_FILTER": {
            this.common.logger.warn({
              service: "historical",
              msg: `Failed to sync '${this.network.name}' logs for '${task.logFilter.contractName}' from block ${task.fromBlock} to ${task.toBlock}`,
              error,
            });
            const priority = Number.MAX_SAFE_INTEGER - task.fromBlock;
            queue.addTask({ ...task }, { priority });
            break;
          }
          case "FACTORY_LOG_FILTER": {
            this.common.logger.warn({
              service: "historical",
              msg: `Failed to sync '${this.network.name}' logs for '${task.factoryLogFilter.contractName}' from block ${task.fromBlock} to ${task.toBlock}`,
              error,
            });
            const priority = Number.MAX_SAFE_INTEGER - task.fromBlock;
            queue.addTask({ ...task }, { priority });
            break;
          }
          case "TRACE_FILTER": {
            this.common.logger.warn({
              service: "historical",
              msg: `Failed to sync '${this.network.name}' call traces for '${task.traceFilter.contractName}' from block ${task.fromBlock} to ${task.toBlock}`,
              error,
            });
            const priority = Number.MAX_SAFE_INTEGER - task.fromBlock;
            queue.addTask({ ...task }, { priority });
            break;
          }

          case "FACTORY_TRACE_FILTER": {
            this.common.logger.warn({
              service: "historical",
              msg: `Failed to sync '${this.network.name}' call traces for '${task.factoryTraceFilter.contractName}' from block ${task.fromBlock} to ${task.toBlock}`,
              error,
            });
            const priority = Number.MAX_SAFE_INTEGER - task.fromBlock;
            queue.addTask({ ...task }, { priority });
            break;
          }
          case "BLOCK_FILTER": {
            this.common.logger.warn({
              service: "historical",
              msg: `Failed to sync '${this.network.name}' blocks for '${task.blockFilter.sourceName}' from block ${task.fromBlock} to ${task.toBlock}`,
              error,
            });
            const priority = Number.MAX_SAFE_INTEGER - task.fromBlock;
            queue.addTask({ ...task }, { priority });
            break;
          }
          case "BLOCK": {
            this.common.logger.warn({
              service: "historical",
              msg: `Failed to sync '${this.network.name}' block ${task.blockNumber}`,
              error,
            });
            const priority = Number.MAX_SAFE_INTEGER - task.blockNumber;
            queue.addTask({ ...task }, { priority });
            break;
          }

          default:
            never(task);
        }

        this.common.logger.warn({
          service: "historical",
          msg: `Retrying failed '${this.network.name}' sync task`,
        });
      },
    });

    return queue;
  };

  private logFilterTaskWorker = async ({
    logFilter,
    fromBlock,
    toBlock,
  }: LogFilterTask) => {
    this.common.logger.trace({
      service: "historical",
      msg: `Starting '${this.network.name}' LOG_FILTER task for '${logFilter.contractName}' from block ${fromBlock} to ${toBlock}`,
    });

    const logs = await _eth_getLogs(
      { requestQueue: this.requestQueue },
      {
        address: logFilter.criteria.address,
        topics: logFilter.criteria.topics,
        fromBlock: toHex(fromBlock),
        toBlock: toHex(toBlock),
      },
    );
    const logIntervals = this.buildLogIntervals({ fromBlock, toBlock, logs });

    for (const logInterval of logIntervals) {
      const { startBlock, endBlock } = logInterval;

      if (this.blockCallbacks[endBlock] === undefined)
        this.blockCallbacks[endBlock] = [];

      this.blockCallbacks[endBlock]!.push(async (block) => {
        const { transactionHashes } = logInterval;
        const transactions = block.transactions.filter((tx) =>
          transactionHashes.has(tx.hash),
        );
        const transactionReceipts =
          logFilter.criteria.includeTransactionReceipts === true
            ? await Promise.all(
                transactions.map((tx) =>
                  _eth_getTransactionReceipt(
                    { requestQueue: this.requestQueue },
                    { hash: tx.hash },
                  ),
                ),
              )
            : [];

        await this.syncStore.insertLogFilterInterval({
          logs: logInterval.logs,
          interval: {
            startBlock: BigInt(logInterval.startBlock),
            endBlock: BigInt(logInterval.endBlock),
          },
          logFilter: logFilter.criteria,
          chainId: logFilter.chainId,
          block,
          transactions,
          transactionReceipts,
        });

        this.common.metrics.ponder_historical_completed_blocks.inc(
          {
            network: this.network.name,
            source: logFilter.contractName,
            type: "log",
          },
          endBlock - startBlock + 1,
        );
      });
    }

    this.logFilterProgressTrackers[logFilter.id]!.addCompletedInterval([
      fromBlock,
      toBlock,
    ]);

    this.enqueueBlockTasks();

    this.common.logger.trace({
      service: "historical",
      msg: `Completed '${this.network.name}' LOG_FILTER task for '${logFilter.contractName}' from block ${fromBlock} to ${toBlock}`,
    });
  };

  private factoryLogFilterTaskWorker = async ({
    factoryLogFilter,
    fromBlock,
    toBlock,
  }: FactoryLogFilterTask) => {
    this.common.logger.trace({
      service: "historical",
      msg: `Starting '${this.network.name}' FACTORY_LOG_FILTER task for '${factoryLogFilter.contractName}' from block ${fromBlock} to ${toBlock}`,
    });

    const iterator = this.syncStore.getFactoryChildAddresses({
      chainId: factoryLogFilter.chainId,
      factory: factoryLogFilter.criteria,
      fromBlock: BigInt(factoryLogFilter.startBlock),
      toBlock: BigInt(toBlock),
    });

    const logs: SyncLog[] = [];
    for await (const childContractAddressBatch of iterator) {
      const _logs = await _eth_getLogs(
        { requestQueue: this.requestQueue },
        {
          address: childContractAddressBatch,
          topics: factoryLogFilter.criteria.topics,
          fromBlock: numberToHex(fromBlock),
          toBlock: numberToHex(toBlock),
        },
      );
      logs.push(..._logs);
    }

    const logIntervals = this.buildLogIntervals({ fromBlock, toBlock, logs });

    for (const logInterval of logIntervals) {
      const { startBlock, endBlock, logs, transactionHashes } = logInterval;

      if (this.blockCallbacks[endBlock] === undefined)
        this.blockCallbacks[endBlock] = [];

      this.blockCallbacks[endBlock]!.push(async (block) => {
        const transactions = block.transactions.filter((tx) =>
          transactionHashes.has(tx.hash),
        );
        const transactionReceipts =
          factoryLogFilter.criteria.includeTransactionReceipts === true
            ? await Promise.all(
                transactions.map((tx) =>
                  _eth_getTransactionReceipt(
                    { requestQueue: this.requestQueue },
                    { hash: tx.hash },
                  ),
                ),
              )
            : [];

        await this.syncStore.insertFactoryLogFilterInterval({
          chainId: factoryLogFilter.chainId,
          factory: factoryLogFilter.criteria,
          block,
          transactions,
          transactionReceipts,
          logs,
          interval: {
            startBlock: BigInt(startBlock),
            endBlock: BigInt(endBlock),
          },
        });

        this.common.metrics.ponder_historical_completed_blocks.inc(
          {
            network: this.network.name,
            source: factoryLogFilter.contractName,
            type: "log",
          },
          endBlock - startBlock + 1,
        );
      });
    }

    this.factoryLogFilterProgressTrackers[
      factoryLogFilter.id
    ]!.addCompletedInterval([fromBlock, toBlock]);

    this.enqueueBlockTasks();

    this.common.logger.trace({
      service: "historical",
      msg: `Completed '${this.network.name}' FACTORY_LOG_FILTER task for '${factoryLogFilter.contractName}' from block ${fromBlock} to ${toBlock}`,
    });
  };

  private factoryChildAddressTaskWorker = async ({
    factory,
    fromBlock,
    toBlock,
  }: FactoryChildAddressTask) => {
    this.common.logger.trace({
      service: "historical",
      msg: `Starting '${this.network.name}' FACTORY_CHILD_ADDRESS task for '${factory.contractName}' from block ${fromBlock} to ${toBlock}`,
    });

    const logs = await _eth_getLogs(
      { requestQueue: this.requestQueue },
      {
        address: factory.criteria.address,
        topics: [factory.criteria.eventSelector],
        fromBlock: toHex(fromBlock),
        toBlock: toHex(toBlock),
      },
    );

    // Insert the new child address logs into the store.
    await this.syncStore.insertFactoryChildAddressLogs({
      chainId: factory.chainId,
      logs,
    });

    // Register block callbacks for the child address logs. This is how
    // the intervals will be recorded (marking the child address logs as
    // cached on subsequent starts).
    const logIntervals = this.buildLogIntervals({ fromBlock, toBlock, logs });
    for (const logInterval of logIntervals) {
      if (this.blockCallbacks[logInterval.endBlock] === undefined)
        this.blockCallbacks[logInterval.endBlock] = [];

      this.blockCallbacks[logInterval.endBlock]!.push(async (block) => {
        const { transactionHashes } = logInterval;

        const transactions = block.transactions.filter((tx) =>
          transactionHashes.has(tx.hash),
        );

        await this.syncStore.insertLogFilterInterval({
          logs: logInterval.logs,
          interval: {
            startBlock: BigInt(logInterval.startBlock),
            endBlock: BigInt(logInterval.endBlock),
          },
          logFilter: {
            address: factory.criteria.address,
            topics: [factory.criteria.eventSelector],
            includeTransactionReceipts: false,
          },
          chainId: factory.chainId,
          block,
          transactions,
          transactionReceipts: [],
        });
      });
    }

    // Update the checkpoint, and if necessary, enqueue factory log filter tasks.
    const { isUpdated, prevCheckpoint, newCheckpoint } =
      this.factoryChildAddressProgressTrackers[
        factory.id
      ]!.addCompletedInterval([fromBlock, toBlock]);

    switch (factory.type) {
      case "factoryLog": {
        if (isUpdated) {
          // It's possible for the factory log filter to have already completed some or
          // all of the block interval here. To avoid duplicates, only add intervals that
          // are still marked as required.
          const requiredIntervals = intervalIntersection(
            [[prevCheckpoint + 1, newCheckpoint]],
            this.factoryLogFilterProgressTrackers[factory.id]!.getRequired(),
          );
          const factoryLogFilterChunks = getChunks({
            intervals: requiredIntervals,
            maxChunkSize:
              factory.maxBlockRange ?? this.network.defaultMaxBlockRange,
          });

          for (const [fromBlock, toBlock] of factoryLogFilterChunks) {
            this.queue.addTask(
              {
                kind: "FACTORY_LOG_FILTER",
                factoryLogFilter: factory,
                fromBlock,
                toBlock,
              },
              { priority: Number.MAX_SAFE_INTEGER - fromBlock },
            );
          }
        }
        this.common.metrics.ponder_historical_completed_blocks.inc(
          {
            network: this.network.name,
            source: `${factory.contractName}_factory`,
            type: "log",
          },
          toBlock - fromBlock + 1,
        );
        break;
      }

      case "factoryCallTrace": {
        if (isUpdated) {
          // It's possible for the factory log filter to have already completed some or
          // all of the block interval here. To avoid duplicates, only add intervals that
          // are still marked as required.
          const requiredIntervals = intervalIntersection(
            [[prevCheckpoint + 1, newCheckpoint]],
            this.factoryTraceFilterProgressTrackers[factory.id]!.getRequired(),
          );
          const factoryTraceFilterChunks = getChunks({
            intervals: requiredIntervals,
            maxChunkSize: TRACE_FILTER_CHUNK_SIZE,
          });

          for (const [fromBlock, toBlock] of factoryTraceFilterChunks) {
            this.queue.addTask(
              {
                kind: "FACTORY_TRACE_FILTER",
                factoryTraceFilter: factory,
                fromBlock,
                toBlock,
              },
              { priority: Number.MAX_SAFE_INTEGER - fromBlock },
            );
          }
        }
        this.common.metrics.ponder_historical_completed_blocks.inc(
          {
            network: this.network.name,
            source: `${factory.contractName}_factory`,
            type: "trace",
          },
          toBlock - fromBlock + 1,
        );
        break;
      }

      default:
        never(factory);
    }

    this.common.logger.trace({
      service: "historical",
      msg: `Completed '${this.network.name}' FACTORY_CHILD_ADDRESS task for '${factory.contractName}' from block ${fromBlock} to ${toBlock}`,
    });
  };

  private blockFilterTaskWorker = async ({
    blockFilter,
    fromBlock,
    toBlock,
  }: BlockFilterTask) => {
    this.common.logger.trace({
      service: "historical",
      msg: `Starting '${this.network.name}' BLOCK_FILTER task for '${blockFilter.sourceName}' from block ${fromBlock} to ${toBlock}`,
    });

    const baseOffset =
      (fromBlock - blockFilter.criteria.offset) % blockFilter.criteria.interval;
    const offset =
      baseOffset === 0 ? 0 : blockFilter.criteria.interval - baseOffset;

    // Determine which blocks are matched by the block filter, and add a callback for
    // each block. A block callback, and subsequent "eth_getBlock" request can be
    // skipped if the block is already present in the database.

    const requiredBlocks: number[] = [];
    for (
      let blockNumber = fromBlock + offset;
      blockNumber <= toBlock;
      blockNumber += blockFilter.criteria.interval
    ) {
      requiredBlocks.push(blockNumber);
    }

    // If toBlock is not already required, add it. This is necessary
    // to mark the full block range of the eth_getLogs request as cached.
    if (!requiredBlocks.includes(toBlock)) {
      requiredBlocks.push(toBlock);
    }

    let prevBlockNumber = fromBlock;
    for (const blockNumber of requiredBlocks) {
      const hasBlock = await this.syncStore.getBlock({
        chainId: blockFilter.chainId,
        blockNumber,
      });

      const startBlock = prevBlockNumber;
      const endBlock = blockNumber;

      if (hasBlock) {
        await this.syncStore.insertBlockFilterInterval({
          chainId: blockFilter.chainId,
          blockFilter: blockFilter.criteria,
          interval: {
            startBlock: BigInt(startBlock),
            endBlock: BigInt(endBlock),
          },
        });

        this.common.metrics.ponder_historical_completed_blocks.inc(
          {
            network: this.network.name,
            source: blockFilter.sourceName,
            type: "block",
          },
          endBlock - startBlock + 1,
        );
      } else {
        if (this.blockCallbacks[blockNumber] === undefined)
          this.blockCallbacks[blockNumber] = [];

        this.blockCallbacks[blockNumber]!.push(async (block) => {
          await this.syncStore.insertBlockFilterInterval({
            chainId: blockFilter.chainId,
            blockFilter: blockFilter.criteria,
            block,
            interval: {
              startBlock: BigInt(startBlock),
              endBlock: BigInt(endBlock),
            },
          });

          this.common.metrics.ponder_historical_completed_blocks.inc(
            {
              network: this.network.name,
              source: blockFilter.sourceName,
              type: "block",
            },
            endBlock - startBlock + 1,
          );
        });
      }

      prevBlockNumber = blockNumber + 1;
    }

    this.blockFilterProgressTrackers[blockFilter.id]!.addCompletedInterval([
      fromBlock,
      toBlock,
    ]);

    this.enqueueBlockTasks();

    this.common.logger.trace({
      service: "historical",
      msg: `Completed '${this.network.name}' BLOCK_FILTER task for '${blockFilter.sourceName}' from block ${fromBlock} to ${toBlock}`,
    });
  };

  private traceFilterTaskWorker = async ({
    traceFilter,
    fromBlock,
    toBlock,
  }: TraceFilterTask) => {
    this.common.logger.trace({
      service: "historical",
      msg: `Starting '${this.network.name}' TRACE_FILTER task for '${traceFilter.contractName}' from block ${fromBlock} to ${toBlock}`,
    });

    const traces = await _trace_filter(
      { requestQueue: this.requestQueue },
      {
        fromBlock,
        toBlock,
        fromAddress: traceFilter.criteria.fromAddress,
        toAddress: traceFilter.criteria.toAddress,
      },
    ).then(
      (traces) => traces.filter((t) => t.type === "call") as SyncCallTrace[],
    );

    // Request transactionReceipts to check for reverted transactions.
    const transactionReceipts = await Promise.all(
      dedupe(traces.map((t) => t.transactionHash)).map((hash) =>
        _eth_getTransactionReceipt(
          {
            requestQueue: this.requestQueue,
          },
          {
            hash,
          },
        ),
      ),
    );

    const revertedTransactions = new Set<Hash>();
    for (const receipt of transactionReceipts) {
      if (receipt.status === "0x0") {
        revertedTransactions.add(receipt.transactionHash);
      }
    }

    const persistentTraces = traces.filter(
      (trace) => revertedTransactions.has(trace.transactionHash) === false,
    );

    const tracesByBlockNumber: Record<number, SyncCallTrace[] | undefined> = {};
    const txHashesByBlockNumber: Record<number, Set<Hash> | undefined> = {};

    for (const trace of persistentTraces) {
      const blockNumber = hexToNumber(trace.blockNumber);

      if (tracesByBlockNumber[blockNumber] === undefined) {
        tracesByBlockNumber[blockNumber] = [];
      }
      if (txHashesByBlockNumber[blockNumber] === undefined) {
        txHashesByBlockNumber[blockNumber] = new Set<Hash>();
      }

      tracesByBlockNumber[blockNumber]!.push(trace);
      txHashesByBlockNumber[blockNumber]!.add(trace.transactionHash);
    }

    const requiredBlocks = Object.keys(txHashesByBlockNumber)
      .map(Number)
      .sort((a, b) => a - b);

    // If toBlock is not already required, add it. This is necessary
    // to mark the full block range of the trace_filter request as cached.
    if (!requiredBlocks.includes(toBlock)) {
      requiredBlocks.push(toBlock);
    }

    const traceIntervals: {
      startBlock: number;
      endBlock: number;
      traces: SyncCallTrace[];
      transactionHashes: Set<Hash>;
    }[] = [];

    let prev = fromBlock;
    for (const blockNumber of requiredBlocks) {
      traceIntervals.push({
        startBlock: prev,
        endBlock: blockNumber,
        traces: tracesByBlockNumber[blockNumber] ?? [],
        transactionHashes: txHashesByBlockNumber[blockNumber] ?? new Set(),
      });
      prev = blockNumber + 1;
    }

    for (const traceInterval of traceIntervals) {
      const { startBlock, endBlock } = traceInterval;

      if (this.blockCallbacks[endBlock] === undefined)
        this.blockCallbacks[endBlock] = [];

      this.blockCallbacks[endBlock]!.push(async (block) => {
        const { transactionHashes } = traceInterval;
        const transactions = block.transactions.filter((tx) =>
          transactionHashes.has(tx.hash),
        );

        await this.syncStore.insertTraceFilterInterval({
          traces: traceInterval.traces,
          interval: {
            startBlock: BigInt(startBlock),
            endBlock: BigInt(endBlock),
          },
          traceFilter: traceFilter.criteria,
          chainId: traceFilter.chainId,
          block,
          transactions,
          // trace intervals always include transaction receipts because
          // the transactions receipts are already needed determine the
          // persistence of a trace.
          transactionReceipts: transactionReceipts.filter((txr) =>
            transactionHashes.has(txr.transactionHash),
          ),
        });

        this.common.metrics.ponder_historical_completed_blocks.inc(
          {
            network: this.network.name,
            source: traceFilter.contractName,
            type: "trace",
          },
          endBlock - startBlock + 1,
        );
      });
    }
    this.traceFilterProgressTrackers[traceFilter.id]!.addCompletedInterval([
      fromBlock,
      toBlock,
    ]);

    this.enqueueBlockTasks();

    this.common.logger.trace({
      service: "historical",
      msg: `Completed '${this.network.name}' TRACE_FILTER task for '${traceFilter.contractName}' from block ${fromBlock} to ${toBlock}`,
    });
  };

  private factoryTraceFilterTaskWorker = async ({
    factoryTraceFilter,
    fromBlock,
    toBlock,
  }: FactoryTraceFilterTask) => {
    this.common.logger.trace({
      service: "historical",
      msg: `Starting '${this.network.name}' FACTORY_TRACE_FILTER task for '${factoryTraceFilter.contractName}' from block ${fromBlock} to ${toBlock}`,
    });

    const iterator = this.syncStore.getFactoryChildAddresses({
      chainId: factoryTraceFilter.chainId,
      factory: factoryTraceFilter.criteria,
      fromBlock: BigInt(factoryTraceFilter.startBlock),
      toBlock: BigInt(toBlock),
    });

    const traces: SyncCallTrace[] = [];
    for await (const childContractAddressBatch of iterator) {
      const _traces = await _trace_filter(
        { requestQueue: this.requestQueue },
        {
          fromBlock,
          toBlock,
          fromAddress: factoryTraceFilter.criteria.fromAddress,
          toAddress: childContractAddressBatch,
        },
      ).then(
        (traces) => traces.filter((t) => t.type === "call") as SyncCallTrace[],
      );
      traces.push(..._traces);
    }

    // Request transactionReceipts to check for reverted transactions.
    const transactionReceipts = await Promise.all(
      dedupe(traces.map((t) => t.transactionHash)).map((hash) =>
        _eth_getTransactionReceipt(
          {
            requestQueue: this.requestQueue,
          },
          {
            hash,
          },
        ),
      ),
    );

    const revertedTransactions = new Set<Hash>();
    for (const receipt of transactionReceipts) {
      if (receipt.status === "0x0") {
        revertedTransactions.add(receipt.transactionHash);
      }
    }

    const persistentTraces = traces.filter(
      (trace) => revertedTransactions.has(trace.transactionHash) === false,
    );

    const tracesByBlockNumber: Record<number, SyncCallTrace[] | undefined> = {};
    const txHashesByBlockNumber: Record<number, Set<Hash> | undefined> = {};

    for (const trace of persistentTraces) {
      const blockNumber = hexToNumber(trace.blockNumber);

      if (tracesByBlockNumber[blockNumber] === undefined) {
        tracesByBlockNumber[blockNumber] = [];
      }
      if (txHashesByBlockNumber[blockNumber] === undefined) {
        txHashesByBlockNumber[blockNumber] = new Set<Hash>();
      }

      tracesByBlockNumber[blockNumber]!.push(trace);
      txHashesByBlockNumber[blockNumber]!.add(trace.transactionHash);
    }

    const requiredBlocks = Object.keys(txHashesByBlockNumber)
      .map(Number)
      .sort((a, b) => a - b);

    // If toBlock is not already required, add it. This is necessary
    // to mark the full block range of the trace_filter request as cached.
    if (!requiredBlocks.includes(toBlock)) {
      requiredBlocks.push(toBlock);
    }

    const traceIntervals: {
      startBlock: number;
      endBlock: number;
      traces: SyncCallTrace[];
      transactionHashes: Set<Hash>;
    }[] = [];

    let prev = fromBlock;
    for (const blockNumber of requiredBlocks) {
      traceIntervals.push({
        startBlock: prev,
        endBlock: blockNumber,
        traces: tracesByBlockNumber[blockNumber] ?? [],
        transactionHashes: txHashesByBlockNumber[blockNumber] ?? new Set(),
      });
      prev = blockNumber + 1;
    }

    for (const traceInterval of traceIntervals) {
      const { startBlock, endBlock } = traceInterval;

      if (this.blockCallbacks[endBlock] === undefined)
        this.blockCallbacks[endBlock] = [];

      this.blockCallbacks[endBlock]!.push(async (block) => {
        const { transactionHashes } = traceInterval;
        const transactions = block.transactions.filter((tx) =>
          transactionHashes.has(tx.hash),
        );

        await this.syncStore.insertFactoryTraceFilterInterval({
          chainId: factoryTraceFilter.chainId,
          factory: factoryTraceFilter.criteria,
          block,
          transactions,
          // factory trace intervals always include transaction receipts because
          // the transactions receipts are already needed determine the
          // persistence of a trace.
          transactionReceipts: transactionReceipts.filter((txr) =>
            transactionHashes.has(txr.transactionHash),
          ),
          traces: traceInterval.traces,
          interval: {
            startBlock: BigInt(startBlock),
            endBlock: BigInt(endBlock),
          },
        });

        this.common.metrics.ponder_historical_completed_blocks.inc(
          {
            network: this.network.name,
            source: factoryTraceFilter.contractName,
            type: "trace",
          },
          endBlock - startBlock + 1,
        );
      });
    }

    this.factoryTraceFilterProgressTrackers[
      factoryTraceFilter.id
    ]!.addCompletedInterval([fromBlock, toBlock]);

    this.enqueueBlockTasks();

    this.common.logger.trace({
      service: "historical",
      msg: `Completed '${this.network.name}' FACTORY_TRACE_FILTER task for '${factoryTraceFilter.contractName}' from block ${fromBlock} to ${toBlock}`,
    });
  };

  private blockTaskWorker = async ({ blockNumber, callbacks }: BlockTask) => {
    this.common.logger.trace({
      service: "historical",
      msg: `Starting '${this.network.name}' BLOCK task for block ${blockNumber} with ${callbacks.length} callbacks`,
    });

    const block = await _eth_getBlockByNumber(
      { requestQueue: this.requestQueue },
      {
        blockNumber,
      },
    );

    for (const callback of callbacks) {
      await callback(block);
    }

    const newBlockCheckpoint = this.blockProgressTracker.addCompletedBlock({
      blockNumber,
      blockTimestamp: hexToNumber(block.timestamp),
    });

    if (newBlockCheckpoint) {
      this.debouncedEmitCheckpoint.call({
        ...maxCheckpoint,
        blockTimestamp: newBlockCheckpoint.blockTimestamp,
        chainId: BigInt(this.network.chainId),
        blockNumber: BigInt(newBlockCheckpoint.blockNumber),
      });
    }

    this.common.logger.trace({
      service: "historical",
      msg: `Completed '${this.network.name}' BLOCK task for block ${blockNumber} with ${callbacks.length} callbacks`,
    });
  };

  private buildLogIntervals = ({
    fromBlock,
    toBlock,
    logs,
  }: {
    fromBlock: number;
    toBlock: number;
    logs: SyncLog[];
  }) => {
    const logsByBlockNumber: Record<number, SyncLog[] | undefined> = {};
    const txHashesByBlockNumber: Record<number, Set<Hash> | undefined> = {};

    logs.forEach((log) => {
      const blockNumber = hexToNumber(log.blockNumber!);
      (txHashesByBlockNumber[blockNumber] ||= new Set<Hash>()).add(
        log.transactionHash!,
      );
      (logsByBlockNumber[blockNumber] ||= []).push(log);
    });

    const requiredBlocks = Object.keys(txHashesByBlockNumber)
      .map(Number)
      .sort((a, b) => a - b);

    // If toBlock is not already required, add it. This is necessary
    // to mark the full block range of the eth_getLogs request as cached.
    if (!requiredBlocks.includes(toBlock)) {
      requiredBlocks.push(toBlock);
    }

    const requiredIntervals: {
      startBlock: number;
      endBlock: number;
      logs: SyncLog[];
      transactionHashes: Set<Hash>;
    }[] = [];

    let prev = fromBlock;
    for (const blockNumber of requiredBlocks) {
      requiredIntervals.push({
        startBlock: prev,
        endBlock: blockNumber,
        logs: logsByBlockNumber[blockNumber] ?? [],
        transactionHashes: txHashesByBlockNumber[blockNumber] ?? new Set(),
      });
      prev = blockNumber + 1;
    }

    return requiredIntervals;
  };

  private enqueueBlockTasks = () => {
    // If a source has an endBlock and is completed, its checkpoint
    // will be equal to its endBlock. This poses a problem if other sources
    // don't have an endBlock and are still in progress, because this value
    // will get "stuck" at the endBlock. To avoid this, filter out any sources
    // that have no more required intervals.
    const blockTasksCanBeEnqueuedTo = Math.min(
      ...[
        ...Object.values(this.logFilterProgressTrackers),
        ...Object.values(this.factoryChildAddressProgressTrackers),
        ...Object.values(this.factoryLogFilterProgressTrackers),
        ...Object.values(this.traceFilterProgressTrackers),
        ...Object.values(this.factoryTraceFilterProgressTrackers),
        ...Object.values(this.blockFilterProgressTrackers),
      ]
        .filter((i) => i.getRequired().length > 0)
        .map((i) => i.getCheckpoint()),
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
            callbacks: this.blockCallbacks[blockNumber]!,
          },
          { priority: Number.MAX_SAFE_INTEGER - blockNumber },
        );
        delete this.blockCallbacks[blockNumber];
      }

      this.blockTasksEnqueuedCheckpoint = blockTasksCanBeEnqueuedTo;
    }
  };

  private debouncedEmitCheckpoint = debounce(
    HISTORICAL_CHECKPOINT_EMIT_INTERVAL,
    (checkpoint: Checkpoint) => {
      this.emit("historicalCheckpoint", checkpoint);
    },
  );
}
