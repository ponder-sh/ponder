import type { Common } from "@/Ponder.js";
import type { Network } from "@/config/networks.js";
import {
  type Factory,
  type FactoryCriteria,
  type LogFilter,
  type LogFilterCriteria,
  type Source,
  type Topics,
  sourceIsLogFilter,
} from "@/config/sources.js";
import { SyncStoreError } from "@/errors/syncStore.js";
import { getHistoricalSyncStats } from "@/metrics/utils.js";
import type { SyncStore } from "@/sync-store/store.js";
import type { Checkpoint } from "@/utils/checkpoint.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import {
  BlockProgressTracker,
  ProgressTracker,
  getChunks,
  intervalDifference,
  intervalIntersection,
  intervalSum,
} from "@/utils/interval.js";
import { toLowerCase } from "@/utils/lowercase.js";
import Emittery from "emittery";
import {
  type Address,
  BlockNotFoundError,
  type Hash,
  type Hex,
  type RpcBlock,
  type RpcLog,
  RpcRequestError,
  hexToNumber,
  numberToHex,
  toHex,
} from "viem";
import {
  type LogFilterError,
  getLogFilterRetryRanges,
} from "./getLogFilterRetryRanges.js";
import { validateHistoricalBlockRange } from "./validateHistoricalBlockRange.js";

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

  /**
   * Emitted when a critical error occurs
   */
  error: BlockNotFoundError | RpcRequestError | SyncStoreError | Error;
};

type LogFilterTask = {
  kind: "LOG_FILTER";
  logFilter: LogFilter;
  fromBlock: number;
  toBlock: number;
};

type FactoryChildAddressTask = {
  kind: "FACTORY_CHILD_ADDRESS";
  factory: Factory;
  fromBlock: number;
  toBlock: number;
};

type FactoryLogFilterTask = {
  kind: "FACTORY_LOG_FILTER";
  factory: Factory;
  fromBlock: number;
  toBlock: number;
};

type BlockTask = {
  kind: "BLOCK";
  blockNumber: number;
  callbacks: ((block: HistoricalBlock) => Promise<void>)[];
};

type HistoricalSyncTask =
  | LogFilterTask
  | FactoryChildAddressTask
  | FactoryLogFilterTask
  | BlockTask;

type HistoricalBlock = RpcBlock<"finalized", true>;

type LogInterval = {
  startBlock: number;
  endBlock: number;
  logs: RpcLog[];
  transactionHashes: Set<Hash>;
};

export class HistoricalSyncService extends Emittery<HistoricalSyncEvents> {
  private common: Common;
  private syncStore: SyncStore;
  private network: Network;

  /**
   * Service configuration. Will eventually be reloadable.
   */
  private finalizedBlockNumber: number | undefined = undefined;
  private sources: Source[];

  /**
   * Block progress trackers for each task type.
   */
  private logFilterProgressTrackers: Record<string, ProgressTracker> = {};
  private factoryChildAddressProgressTrackers: Record<string, ProgressTracker> =
    {};
  private factoryLogFilterProgressTrackers: Record<string, ProgressTracker> =
    {};
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
    ((block: HistoricalBlock) => Promise<void>)[]
  > = {};

  /**
   * Block tasks have been added to the queue up to and including this block number.
   * Used alongside blockCallbacks to keep track of which block tasks to add to the queue.
   */
  private blockTasksEnqueuedCheckpoint = 0;

  private progressLogInterval?: NodeJS.Timeout;

  constructor({
    common,
    syncStore,
    network,
    sources = [],
  }: {
    common: Common;
    syncStore: SyncStore;
    network: Network;
    sources?: Source[];
  }) {
    super();

    this.common = common;
    this.syncStore = syncStore;
    this.network = network;
    this.sources = sources;
  }

  private setupLogFilterSource = async ({
    source,
    isHistoricalSyncRequired,
    startBlock,
    endBlock,
    finalizedBlockNumber,
  }: {
    source: LogFilter;
    isHistoricalSyncRequired: boolean;
    startBlock: number;
    endBlock: number | undefined;
    finalizedBlockNumber: number | undefined;
  }): Promise<void> => {
    if (!isHistoricalSyncRequired) {
      if (this.finalizedBlockNumber !== undefined) {
        this.logFilterProgressTrackers[source.id] = new ProgressTracker({
          target: [startBlock, finalizedBlockNumber!],
          completed: [[startBlock, finalizedBlockNumber!]],
        });
      }
      this.common.metrics.ponder_historical_total_blocks.set(
        { network: this.network.name, contract: source.contractName },
        0,
      );
      this.common.logger.warn({
        service: "historical",
        msg: `Start block is in unfinalized range, skipping historical sync (contract=${source.id})`,
      });
      return;
    }

    const completedLogFilterIntervals =
      await this.syncStore.getLogFilterIntervals({
        chainId: source.chainId,
        logFilter: {
          address: source.criteria.address,
          topics: source.criteria.topics,
        },
      });
    const logFilterProgressTracker = new ProgressTracker({
      target: [startBlock, endBlock!],
      completed: completedLogFilterIntervals,
    });
    this.logFilterProgressTrackers[source.id] = logFilterProgressTracker;

    const requiredLogFilterIntervals = logFilterProgressTracker.getRequired();

    const logFilterTaskChunks = getChunks({
      intervals: requiredLogFilterIntervals,
      maxChunkSize: source.maxBlockRange ?? this.network.defaultMaxBlockRange,
    });

    for (const [fromBlock, toBlock] of logFilterTaskChunks) {
      this.runTask({
        kind: "LOG_FILTER",
        logFilter: source,
        fromBlock,
        toBlock,
      });
    }

    if (logFilterTaskChunks.length > 0) {
      const total = intervalSum(requiredLogFilterIntervals);
      this.common.logger.debug({
        service: "historical",
        msg: `Added LOG_FILTER tasks for ${total}-block range (contract=${source.contractName}, network=${this.network.name})`,
      });
    }

    const targetBlockCount = endBlock! - startBlock + 1;
    const cachedBlockCount =
      targetBlockCount - intervalSum(requiredLogFilterIntervals);

    this.common.metrics.ponder_historical_total_blocks.set(
      { network: this.network.name, contract: source.contractName },
      targetBlockCount,
    );
    this.common.metrics.ponder_historical_cached_blocks.set(
      { network: this.network.name, contract: source.contractName },
      cachedBlockCount,
    );

    this.common.logger.info({
      service: "historical",
      msg: `Started sync with ${formatPercentage(
        Math.min(1, cachedBlockCount / (targetBlockCount || 1)),
      )} cached (contract=${source.contractName} network=${this.network.name})`,
    });
  };

  private setupFactorySource = async ({
    source,
    isHistoricalSyncRequired,
    startBlock,
    endBlock,
    finalizedBlockNumber,
  }: {
    source: Factory;
    isHistoricalSyncRequired: boolean;
    startBlock: number;
    endBlock: number | undefined;
    finalizedBlockNumber: number | undefined;
  }) => {
    // Factory
    if (!isHistoricalSyncRequired) {
      if (this.finalizedBlockNumber !== undefined) {
        this.factoryChildAddressProgressTrackers[source.id] =
          new ProgressTracker({
            target: [startBlock, finalizedBlockNumber!],
            completed: [[startBlock, finalizedBlockNumber!]],
          });
        this.factoryLogFilterProgressTrackers[source.id] = new ProgressTracker({
          target: [startBlock, finalizedBlockNumber!],
          completed: [[startBlock, finalizedBlockNumber!]],
        });
      }
      this.common.metrics.ponder_historical_total_blocks.set(
        { network: this.network.name, contract: source.contractName },
        0,
      );
      this.common.logger.warn({
        service: "historical",
        msg: `Start block is in unfinalized range, skipping historical sync (contract=${source.contractName})`,
      });
      return;
    }

    // Note that factory child address progress is stored using
    // log intervals for the factory log.
    const completedFactoryChildAddressIntervals =
      await this.syncStore.getLogFilterIntervals({
        chainId: source.chainId,
        logFilter: {
          address: source.criteria.address,
          topics: [source.criteria.eventSelector],
        },
      });
    const factoryChildAddressProgressTracker = new ProgressTracker({
      target: [startBlock, endBlock!],
      completed: completedFactoryChildAddressIntervals,
    });
    this.factoryChildAddressProgressTrackers[source.id] =
      factoryChildAddressProgressTracker;

    const requiredFactoryChildAddressIntervals =
      factoryChildAddressProgressTracker.getRequired();
    const factoryChildAddressTaskChunks = getChunks({
      intervals: requiredFactoryChildAddressIntervals,
      maxChunkSize: source.maxBlockRange ?? this.network.defaultMaxBlockRange,
    });

    for (const [fromBlock, toBlock] of factoryChildAddressTaskChunks) {
      this.runTask({
        kind: "FACTORY_CHILD_ADDRESS",
        factory: source,
        fromBlock,
        toBlock,
      });
    }
    if (factoryChildAddressTaskChunks.length > 0) {
      const total = intervalSum(requiredFactoryChildAddressIntervals);
      this.common.logger.debug({
        service: "historical",
        msg: `Added FACTORY_CHILD_ADDRESS tasks for ${total}-block range (factory=${source.id}, network=${this.network.name})`,
      });
    }

    const targetFactoryChildAddressBlockCount = endBlock! - startBlock + 1;
    const cachedFactoryChildAddressBlockCount =
      targetFactoryChildAddressBlockCount -
      intervalSum(requiredFactoryChildAddressIntervals);

    this.common.metrics.ponder_historical_total_blocks.set(
      {
        network: this.network.name,
        contract: `${source.contractName}_factory`,
      },
      targetFactoryChildAddressBlockCount,
    );
    this.common.metrics.ponder_historical_cached_blocks.set(
      {
        network: this.network.name,
        contract: `${source.contractName}_factory`,
      },
      cachedFactoryChildAddressBlockCount,
    );

    const completedFactoryLogFilterIntervals =
      await this.syncStore.getFactoryLogFilterIntervals({
        chainId: source.chainId,
        factory: source.criteria,
      });
    const factoryLogFilterProgressTracker = new ProgressTracker({
      target: [startBlock, endBlock!],
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
      maxChunkSize: source.maxBlockRange ?? this.network.defaultMaxBlockRange,
    });

    for (const [fromBlock, toBlock] of missingFactoryLogFilterTaskChunks) {
      this.runTask({
        kind: "FACTORY_LOG_FILTER",
        factory: source,
        fromBlock,
        toBlock,
      });
    }
    if (missingFactoryLogFilterTaskChunks.length > 0) {
      const total = intervalSum(missingFactoryLogFilterIntervals);
      this.common.logger.debug({
        service: "historical",
        msg: `Added FACTORY_LOG_FILTER tasks for ${total}-block range (contract=${source.contractName}, network=${this.network.name})`,
      });
    }

    const targetFactoryLogFilterBlockCount = endBlock! - startBlock + 1;
    const cachedFactoryLogFilterBlockCount =
      targetFactoryLogFilterBlockCount -
      intervalSum(requiredFactoryLogFilterIntervals);

    this.common.metrics.ponder_historical_total_blocks.set(
      { network: this.network.name, contract: source.contractName },
      targetFactoryLogFilterBlockCount,
    );
    this.common.metrics.ponder_historical_cached_blocks.set(
      { network: this.network.name, contract: source.contractName },
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
      msg: `Started sync with ${formatPercentage(cacheRate)} cached (contract=${
        source.contractName
      } network=${this.network.name})`,
    });
  };

  async start({
    latestBlockNumber,
    finalizedBlockNumber,
  }: {
    latestBlockNumber: number;
    finalizedBlockNumber: number | undefined;
  }) {
    // Initialize state variables. Required when restarting the service.
    this.blockTasksEnqueuedCheckpoint = 0;
    this.finalizedBlockNumber = finalizedBlockNumber;

    this.network.requestQueue.pause();

    await Promise.all(
      this.sources.map(async (source) => {
        const { isHistoricalSyncRequired, startBlock, endBlock } =
          validateHistoricalBlockRange({
            startBlock: source.startBlock,
            endBlock: source.endBlock,
            finalizedBlockNumber,
            latestBlockNumber,
          });

        if (sourceIsLogFilter(source)) {
          await this.setupLogFilterSource({
            source,
            isHistoricalSyncRequired,
            startBlock,
            endBlock,
            finalizedBlockNumber,
          });
        } else {
          await this.setupFactorySource({
            source,
            isHistoricalSyncRequired,
            startBlock,
            endBlock,
            finalizedBlockNumber,
          });
        }
      }),
    );

    this.network.requestQueue.start();

    this.common.metrics.ponder_historical_start_timestamp.set(Date.now());

    // Emit status update logs on an interval for each active log filter.
    this.progressLogInterval = setInterval(async () => {
      const completionStats = await getHistoricalSyncStats({
        metrics: this.common.metrics,
        sources: this.sources,
      });

      completionStats.forEach(({ contract, rate, eta }) => {
        if (rate === 1) return;
        this.common.logger.info({
          service: "historical",
          msg: `Sync is ${formatPercentage(rate)} complete${
            eta !== undefined ? ` with ~${formatEta(eta)} remaining` : ""
          } (contract=${contract})`,
          network: this.network.name,
        });
      });
    }, 10_000);

    // Edge case: The entire requested range was cached, or there is no
    // historical sync required, so the sync is complete. However, we still
    // need to emit the historicalCheckpoint event with some timestamp. It should
    // be safe to use the current timestamp.
    if (this.isSyncComplete()) {
      if (this.finalizedBlockNumber !== undefined) {
        this.emit("historicalCheckpoint", {
          blockTimestamp: Math.round(Date.now() / 1000),
          chainId: this.network.chainId,
          blockNumber: this.finalizedBlockNumber,
        });
      }
      clearInterval(this.progressLogInterval);
      this.emit("syncComplete");
      this.common.logger.info({
        service: "historical",
        msg: `Completed sync (network=${this.network.name})`,
        network: this.network.name,
      });
    }
  }

  private isSyncComplete = () => {
    return (
      Object.values(this.logFilterProgressTrackers).every((t) =>
        t.isComplete(),
      ) &&
      Object.values(this.factoryChildAddressProgressTrackers).every((t) =>
        t.isComplete(),
      ) &&
      Object.values(this.factoryLogFilterProgressTrackers).every((t) =>
        t.isComplete(),
      ) &&
      this.blockProgressTracker.isComplete()
    );
  };

  private checkSyncCompletion = async () => {
    if (this.isSyncComplete()) {
      clearInterval(this.progressLogInterval);
      this.emit("syncComplete");
      const startTimestamp =
        (await this.common.metrics.ponder_historical_start_timestamp.get())
          .values?.[0]?.value ?? Date.now();
      const duration = Date.now() - startTimestamp;
      this.common.logger.info({
        service: "historical",
        msg: `Completed sync in ${formatEta(duration)} (network=${
          this.network.name
        })`,
      });
    }
  };

  private runTask = async (task: HistoricalSyncTask) => {
    try {
      if (task.kind === "LOG_FILTER") await this.logFilterTaskWorker(task);
      else if (task.kind === "FACTORY_LOG_FILTER")
        await this.factoryLogFilterTaskWorker(task);
      else if (task.kind === "FACTORY_CHILD_ADDRESS")
        await this.factoryChildAddressTaskWorker(task);
      else if (task.kind === "BLOCK") await this.blockTaskWorker(task);
    } catch (error_) {
      if (error_ === undefined) return;
      const error = error_ as Error;
      error.stack = undefined;

      if (task.kind === "LOG_FILTER") {
        this.common.logger.error({
          service: "historical",
          msg: `Log filter task failed... [${task.fromBlock}, ${
            task.toBlock
          }] (contract=${task.logFilter.contractName}, network=${
            this.network.name
          }, error=${`${error.name}: ${error.message}`})`,
          error,
        });
      } else if (task.kind === "FACTORY_LOG_FILTER") {
        this.common.logger.error({
          service: "historical",
          msg: `Factory log filter task failed [${task.fromBlock}, ${
            task.toBlock
          }] (contract=${task.factory.contractName}, network=${
            this.network.name
          }, error=${`${error.name}: ${error.message}`})`,
          error,
        });
      } else if (task.kind === "FACTORY_CHILD_ADDRESS") {
        this.common.logger.error({
          service: "historical",
          msg: `Factory child address task failed... [${task.fromBlock}, ${
            task.toBlock
          }] (contract=${task.factory.contractName}, network=${
            this.network.name
          }, eerror=${`${error.name}: ${error.message}`})`,
          error,
        });
      } else if (task.kind === "BLOCK") {
        this.common.logger.error({
          service: "historical",
          msg: `Block task failed... [${task.blockNumber}] (network=${
            this.network.name
          }, error=${`${error.name}: ${error.message}`})`,
          error,
        });
      }

      await this.emit("error", error);
    }
  };

  private logFilterTaskWorker = async ({
    logFilter,
    fromBlock,
    toBlock,
  }: Omit<LogFilterTask, "kind">) => {
    const logs = await this._eth_getLogs({
      address: logFilter.criteria.address,
      topics: logFilter.criteria.topics,
      fromBlock: toHex(fromBlock),
      toBlock: toHex(toBlock),
    });
    const logIntervals = this.buildLogIntervals({
      fromBlock,
      toBlock,
      logs,
    });

    for (const logInterval of logIntervals) {
      const { startBlock, endBlock } = logInterval;

      if (this.blockCallbacks[endBlock] === undefined)
        this.blockCallbacks[endBlock] = [];

      this.blockCallbacks[endBlock].push(async (block) => {
        await this._insertLogFilterInterval({
          logInterval,
          logFilter: logFilter.criteria,
          chainId: logFilter.chainId,
          block,
        });

        this.common.metrics.ponder_historical_completed_blocks.inc(
          {
            network: this.network.name,
            contract: logFilter.contractName,
          },
          endBlock - startBlock + 1,
        );
      });
    }

    this.logFilterProgressTrackers[logFilter.id].addCompletedInterval([
      fromBlock,
      toBlock,
    ]);

    this.enqueueBlockTasks();

    if (logIntervals.length === 0) await this.checkSyncCompletion();

    this.common.logger.trace({
      service: "historical",
      msg: `Completed LOG_FILTER task adding ${logIntervals.length} BLOCK tasks [${fromBlock}, ${toBlock}] (contract=${logFilter.contractName}, network=${this.network.name})`,
    });
  };

  private factoryLogFilterTaskWorker = async ({
    factory,
    fromBlock,
    toBlock,
  }: Omit<FactoryLogFilterTask, "kind">) => {
    const iterator = this.syncStore.getFactoryChildAddresses({
      chainId: factory.chainId,
      factory: factory.criteria,
      upToBlockNumber: BigInt(toBlock),
    });

    const childAddresses: Address[][] = [];
    for await (const childContractAddressBatch of iterator) {
      childAddresses.push(childContractAddressBatch);
    }

    const logs = await Promise.all(
      childAddresses.map(async (c) =>
        this._eth_getLogs({
          address: c,
          topics: factory.criteria.topics,
          fromBlock: numberToHex(fromBlock),
          toBlock: numberToHex(toBlock),
        }),
      ),
    ).then((l) => l.flat());

    const logIntervals = this.buildLogIntervals({
      fromBlock,
      toBlock,
      logs,
    });

    for (const logInterval of logIntervals) {
      const { startBlock, endBlock } = logInterval;

      if (this.blockCallbacks[endBlock] === undefined)
        this.blockCallbacks[endBlock] = [];

      this.blockCallbacks[endBlock].push(async (block) => {
        await this._insertFactoryLogFilterInterval({
          chainId: factory.chainId,
          factory: factory.criteria,
          block,
          logInterval,
        });

        this.common.metrics.ponder_historical_completed_blocks.inc(
          {
            network: this.network.name,
            contract: factory.contractName,
          },
          endBlock - startBlock + 1,
        );
      });
    }

    this.factoryLogFilterProgressTrackers[factory.id].addCompletedInterval([
      fromBlock,
      toBlock,
    ]);

    this.enqueueBlockTasks();

    if (logIntervals.length === 0) await this.checkSyncCompletion();

    this.common.logger.trace({
      service: "historical",
      msg: `Completed FACTORY_LOG_FILTER task adding ${logIntervals.length} BLOCK tasks [${fromBlock}, ${toBlock}] (contract=${factory.contractName}, network=${this.network.name})`,
    });
  };

  private factoryChildAddressTaskWorker = async ({
    factory,
    fromBlock,
    toBlock,
  }: Omit<FactoryChildAddressTask, "kind">) => {
    const logs = await this._eth_getLogs({
      address: factory.criteria.address,
      topics: [factory.criteria.eventSelector],
      fromBlock: toHex(fromBlock),
      toBlock: toHex(toBlock),
    });

    // Insert the new child address logs into the store.
    await this._insertFactoryChildAddressLogs({
      chainId: factory.chainId,
      logs,
    });

    const logIntervals = this.buildLogIntervals({
      fromBlock,
      toBlock,
      logs,
    });

    for (const logInterval of logIntervals) {
      if (this.blockCallbacks[logInterval.endBlock] === undefined)
        this.blockCallbacks[logInterval.endBlock] = [];

      this.blockCallbacks[logInterval.endBlock].push(async (block) => {
        await this._insertLogFilterInterval({
          logInterval,
          logFilter: {
            address: factory.criteria.address,
            topics: [factory.criteria.eventSelector],
          },
          chainId: factory.chainId,
          block,
        });
      });
    }

    // Update the checkpoint, and if necessary, enqueue factory log filter tasks.
    const { isUpdated, prevCheckpoint, newCheckpoint } =
      this.factoryChildAddressProgressTrackers[factory.id].addCompletedInterval(
        [fromBlock, toBlock],
      );

    if (isUpdated) {
      // It's possible for the factory log filter to have already completed some or
      // all of the block interval here. To avoid duplicates, only add intervals that
      // are still marked as required.
      const requiredIntervals = intervalIntersection(
        [[prevCheckpoint + 1, newCheckpoint]],
        this.factoryLogFilterProgressTrackers[factory.id].getRequired(),
      );
      const factoryLogFilterChunks = getChunks({
        intervals: requiredIntervals,
        maxChunkSize:
          factory.maxBlockRange ?? this.network.defaultMaxBlockRange,
      });

      for (const [fromBlock, toBlock] of factoryLogFilterChunks) {
        this.runTask({
          kind: "FACTORY_LOG_FILTER",
          factory,
          fromBlock,
          toBlock,
        });
      }
    }

    if (logIntervals.length === 0) await this.checkSyncCompletion();

    this.common.metrics.ponder_historical_completed_blocks.inc(
      {
        network: this.network.name,
        contract: `${factory.contractName}_factory`,
      },
      toBlock - fromBlock + 1,
    );

    this.common.logger.trace({
      service: "historical",
      msg: `Completed FACTORY_CHILD_ADDRESS task [${fromBlock}, ${toBlock}] (contract=${factory.contractName}, network=${this.network.name})`,
    });
  };

  private blockTaskWorker = async ({
    blockNumber,
    callbacks,
  }: Omit<BlockTask, "kind">) => {
    const block = await this._eth_getBlockByNumber({ blockNumber });

    await Promise.all(callbacks.map((cb) => cb(block)));

    const newBlockCheckpoint = this.blockProgressTracker.addCompletedBlock({
      blockNumber,
      blockTimestamp: hexToNumber(block.timestamp),
    });

    if (newBlockCheckpoint) {
      this.emit("historicalCheckpoint", {
        blockTimestamp: newBlockCheckpoint.blockTimestamp,
        chainId: this.network.chainId,
        blockNumber: newBlockCheckpoint.blockNumber,
      });
    }

    await this.checkSyncCompletion();

    this.common.logger.trace({
      service: "historical",
      msg: `Completed BLOCK task ${hexToNumber(block.number!)} with ${
        callbacks.length
      } callbacks (network=${this.network.name})`,
    });
  };

  private buildLogIntervals = ({
    fromBlock,
    toBlock,
    logs,
  }: {
    fromBlock: number;
    toBlock: number;
    logs: RpcLog[];
  }): LogInterval[] => {
    const logsByBlockNumber: Record<number, RpcLog[] | undefined> = {};
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
      logs: RpcLog[];
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

  /**
   * Run the block tasks for all available blocks.
   */
  private enqueueBlockTasks = () => {
    const blockTasksCanBeEnqueuedTo = Math.min(
      ...Object.values(this.logFilterProgressTrackers).map((i) =>
        i.getCheckpoint(),
      ),
      ...Object.values(this.factoryChildAddressProgressTrackers).map((i) =>
        i.getCheckpoint(),
      ),
      ...Object.values(this.factoryLogFilterProgressTrackers).map((i) =>
        i.getCheckpoint(),
      ),
    );

    if (blockTasksCanBeEnqueuedTo > this.blockTasksEnqueuedCheckpoint) {
      const newBlocks = Object.keys(this.blockCallbacks)
        .map(Number)
        .filter((blockNumber) => blockNumber <= blockTasksCanBeEnqueuedTo);

      this.blockProgressTracker.addPendingBlocks({ blockNumbers: newBlocks });

      for (const blockNumber of newBlocks) {
        this.runTask({
          kind: "BLOCK",
          blockNumber,
          callbacks: this.blockCallbacks[blockNumber],
        });
        delete this.blockCallbacks[blockNumber];
      }

      this.common.logger.trace({
        service: "historical",
        msg: `Enqueued ${newBlocks.length} BLOCK tasks [${
          this.blockTasksEnqueuedCheckpoint + 1
        }, ${blockTasksCanBeEnqueuedTo}] (network=${this.network.name})`,
      });

      this.blockTasksEnqueuedCheckpoint = blockTasksCanBeEnqueuedTo;
    }
  };

  /**
   * Helper function for "eth_getLogs" rpc request.
   * Handles different error types and retries the request if applicable.
   */
  private _eth_getLogs = (params: {
    address?: Address | Address[];
    topics?: Topics;
    fromBlock: Hex;
    toBlock: Hex;
  }): Promise<RpcLog[]> => {
    try {
      return this.network.requestQueue.request(
        {
          method: "eth_getLogs",
          params: [
            {
              fromBlock: params.fromBlock,
              toBlock: params.toBlock,

              topics: params.topics,
              address: params.address
                ? Array.isArray(params.address)
                  ? params.address.map((a) => toLowerCase(a))
                  : toLowerCase(params.address)
                : undefined,
            },
          ],
        },
        hexToNumber(params.fromBlock),
      );
    } catch (err) {
      const retryRanges = getLogFilterRetryRanges(
        err as LogFilterError,
        params.fromBlock,
        params.toBlock,
      );

      return Promise.all(
        retryRanges.map(([from, to]) =>
          this._eth_getLogs({
            fromBlock: from,
            toBlock: to,
            topics: params.topics,
            address: params.address,
          }),
        ),
      ).then((l) => l.flat());
    }
  };

  /**
   * Helper function for "eth_getBlockByNumber" request.
   */
  private _eth_getBlockByNumber = (params: {
    blockNumber: number;
  }): Promise<HistoricalBlock> =>
    this.network.requestQueue
      .request(
        {
          method: "eth_getBlockByNumber",
          params: [numberToHex(params.blockNumber), true],
        },
        params.blockNumber,
      )
      .then((block) => {
        if (!block)
          throw new BlockNotFoundError({
            blockNumber: BigInt(params.blockNumber),
          });
        return block as HistoricalBlock;
      });

  /**
   * Helper function for "insertLogFilterInterval"
   */
  private _insertLogFilterInterval = ({
    logInterval: { transactionHashes, logs, startBlock, endBlock },
    logFilter,
    block,
    chainId,
  }: {
    logInterval: LogInterval;
    logFilter: LogFilterCriteria;
    block: HistoricalBlock;
    chainId: number;
  }) =>
    this.syncStore.insertLogFilterInterval({
      chainId,
      logFilter,
      block,
      transactions: block.transactions.filter((tx) =>
        transactionHashes.has(tx.hash),
      ),
      logs,
      interval: {
        startBlock: BigInt(startBlock),
        endBlock: BigInt(endBlock),
      },
    });

  /**
   * Helper function for "insertFactoryLogFilterInterval"
   */
  private _insertFactoryLogFilterInterval = ({
    logInterval: { transactionHashes, logs, startBlock, endBlock },
    factory,
    block,
    chainId,
  }: {
    logInterval: LogInterval;
    factory: FactoryCriteria;
    block: HistoricalBlock;
    chainId: number;
  }) =>
    this.syncStore.insertFactoryLogFilterInterval({
      chainId: chainId,
      factory: factory,
      block,
      transactions: block.transactions.filter((tx) =>
        transactionHashes.has(tx.hash),
      ),
      logs,
      interval: {
        startBlock: BigInt(startBlock),
        endBlock: BigInt(endBlock),
      },
    });

  /**
   * Helper function for "insertFactoryChildAddressLogs"
   */
  private _insertFactoryChildAddressLogs = ({
    chainId,
    logs,
  }: { chainId: number; logs: RpcLog[] }) => {
    return this.syncStore.insertFactoryChildAddressLogs({
      chainId,
      logs,
    });
  };
}
