import type { Common } from "@/Ponder.js";
import type { Network } from "@/config/networks.js";
import {
  type Factory,
  type LogFilter,
  type Source,
  type Topics,
  sourceIsLogFilter,
} from "@/config/sources.js";
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
import { request } from "@/utils/request.js";
import { startClock } from "@/utils/timer.js";
import Emittery from "emittery";
import {
  type Address,
  type Hash,
  type Hex,
  type RpcBlock,
  type RpcLog,
  hexToNumber,
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
};

type HistoricalBlock = RpcBlock<"finalized", true>;

type LogFilterTask = {
  logFilter: LogFilter;
  fromBlock: number;
  toBlock: number;
};

type FactoryChildAddressTask = {
  factory: Factory;
  fromBlock: number;
  toBlock: number;
};

type FactoryLogFilterTask = {
  factory: Factory;
  fromBlock: number;
  toBlock: number;
};

type BlockTask = {
  blockNumber: number;
  callbacks: ((block: HistoricalBlock) => Promise<void>)[];
};

export class HistoricalSyncService extends Emittery<HistoricalSyncEvents> {
  private common: Common;
  private syncStore: SyncStore;
  private network: Network;

  /**
   * Service configuration. Will eventually be reloadable.
   */
  private finalizedBlockNumber: number = null!;
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

  setup({
    latestBlockNumber,
    finalizedBlockNumber,
  }: {
    latestBlockNumber: number;
    finalizedBlockNumber: number;
  }) {
    // Initialize state variables. Required when restarting the service.
    this.blockTasksEnqueuedCheckpoint = 0;
    this.finalizedBlockNumber = finalizedBlockNumber;

    return Promise.all(
      this.sources.map((source) => {
        const { isHistoricalSyncRequired, startBlock, endBlock } =
          validateHistoricalBlockRange({
            startBlock: source.startBlock,
            endBlock: source.endBlock,
            finalizedBlockNumber,
            latestBlockNumber,
          });

        if (sourceIsLogFilter(source)) {
          return this.setupLogFilterSource({
            source,
            isHistoricalSyncRequired,
            startBlock,
            endBlock,
            finalizedBlockNumber,
          });
        } else {
          return this.setupFactorySource({
            source,
            isHistoricalSyncRequired,
            startBlock,
            endBlock,
            finalizedBlockNumber,
          });
        }
      }),
    );
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
    finalizedBlockNumber: number;
  }): Promise<void> => {
    if (!isHistoricalSyncRequired) {
      this.logFilterProgressTrackers[source.id] = new ProgressTracker({
        target: [startBlock, finalizedBlockNumber],
        completed: [[startBlock, finalizedBlockNumber]],
      });
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
      this.logFilterTaskWorker({
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
    finalizedBlockNumber: number;
  }) => {
    // Factory
    if (!isHistoricalSyncRequired) {
      this.factoryChildAddressProgressTrackers[source.id] = new ProgressTracker(
        {
          target: [startBlock, finalizedBlockNumber],
          completed: [[startBlock, finalizedBlockNumber]],
        },
      );
      this.factoryLogFilterProgressTrackers[source.id] = new ProgressTracker({
        target: [startBlock, finalizedBlockNumber],
        completed: [[startBlock, finalizedBlockNumber]],
      });
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
      this.factoryChildAddressTaskWorker({
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
      this.factoryLogFilterTaskWorker({
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

  start() {
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

    // Edge case: If there are no tasks in the queue, this means the entire
    // requested range was cached, so the sync is complete. However, we still
    // need to emit the historicalCheckpoint event with some timestamp. It should
    // be safe to use the current timestamp.
    if (
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
    ) {
      this.emit("historicalCheckpoint", {
        blockTimestamp: Math.round(Date.now() / 1000),
        chainId: this.network.chainId,
        blockNumber: this.finalizedBlockNumber,
      });
      clearInterval(this.progressLogInterval);
      this.emit("syncComplete");
      this.common.logger.info({
        service: "historical",
        msg: `Completed sync (network=${this.network.name})`,
        network: this.network.name,
      });
    }
  }

  private checkSyncCompletion = async () => {
    if (
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
    ) {
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

  private logFilterTaskWorker = (task: LogFilterTask) => {
    const { logFilter, fromBlock, toBlock } = task;

    return this._eth_getLogs({
      address: logFilter.criteria.address,
      topics: logFilter.criteria.topics,
      fromBlock: toHex(fromBlock),
      toBlock: toHex(toBlock),
    }).then((logs) => {
      const logIntervals = this.buildLogIntervals({ fromBlock, toBlock, logs });

      for (const logInterval of logIntervals) {
        const { startBlock, endBlock, logs, transactionHashes } = logInterval;
        (this.blockCallbacks[endBlock] ||= []).push((block) =>
          this.syncStore
            .insertLogFilterInterval({
              chainId: logFilter.chainId,
              block,
              transactions: block.transactions.filter((tx) =>
                transactionHashes.has(tx.hash),
              ),
              logs,
              logFilter: logFilter.criteria,
              interval: {
                startBlock: BigInt(startBlock),
                endBlock: BigInt(endBlock),
              },
            })
            .then(() => {
              this.common.metrics.ponder_historical_completed_blocks.inc(
                {
                  network: this.network.name,
                  contract: logFilter.contractName,
                },
                endBlock - startBlock + 1,
              );
            }),
        );
      }

      this.logFilterProgressTrackers[logFilter.id].addCompletedInterval([
        task.fromBlock,
        task.toBlock,
      ]);

      if (logIntervals.length === 0) this.checkSyncCompletion();

      this.enqueueBlockTasks();

      this.common.logger.trace({
        service: "historical",
        msg: `Completed LOG_FILTER task adding ${logIntervals.length} BLOCK tasks [${task.fromBlock}, ${task.toBlock}] (contract=${logFilter.contractName}, network=${this.network.name})`,
      });
    });
  };

  private factoryChildAddressTaskWorker = (task: FactoryChildAddressTask) => {
    const { factory, fromBlock, toBlock } = task;

    this._eth_getLogs({
      address: factory.criteria.address,
      topics: [factory.criteria.eventSelector],
      fromBlock: toHex(fromBlock),
      toBlock: toHex(toBlock),
    })
      .then((logs) =>
        // Insert the new child address logs into the store.
        this.syncStore
          .insertFactoryChildAddressLogs({
            chainId: factory.chainId,
            logs,
          })
          .then(() => logs),
      )
      .then((logs) => {
        const logIntervals = this.buildLogIntervals({
          fromBlock,
          toBlock,
          logs,
        });

        for (const logInterval of logIntervals) {
          const { startBlock, endBlock, logs, transactionHashes } = logInterval;
          (this.blockCallbacks[endBlock] ||= []).push((block) =>
            // Register block callbacks for the child address logs. This is how
            // the intervals will be recorded (marking the child address logs as
            // cached on subsequent starts).
            this.syncStore.insertLogFilterInterval({
              chainId: factory.chainId,
              logFilter: {
                address: factory.criteria.address,
                topics: [factory.criteria.eventSelector],
              },
              block,
              transactions: block.transactions.filter((tx) =>
                transactionHashes.has(tx.hash),
              ),
              logs,
              interval: {
                startBlock: BigInt(startBlock),
                endBlock: BigInt(endBlock),
              },
            }),
          );
        }

        // Update the checkpoint, and if necessary, enqueue factory log filter tasks.
        const { isUpdated, prevCheckpoint, newCheckpoint } =
          this.factoryChildAddressProgressTrackers[
            factory.id
          ].addCompletedInterval([fromBlock, toBlock]);

        if (logIntervals.length === 0) this.checkSyncCompletion();

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
            this.factoryLogFilterTaskWorker({
              factory,
              fromBlock,
              toBlock,
            });
          }
        }
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
      });
  };

  private factoryLogFilterTaskWorker = async ({
    factory,
    fromBlock,
    toBlock,
  }: FactoryLogFilterTask) => {
    const iterator = this.syncStore.getFactoryChildAddresses({
      chainId: factory.chainId,
      factory: factory.criteria,
      upToBlockNumber: BigInt(toBlock),
    });

    const childAddresses: Address[][] = [];
    for await (const childContractAddressBatch of iterator) {
      childAddresses.push(childContractAddressBatch);
    }

    return Promise.all(
      childAddresses.map((c) =>
        this._eth_getLogs({
          address: c,
          topics: factory.criteria.topics,
          fromBlock: toHex(fromBlock),
          toBlock: toHex(toBlock),
        }),
      ),
    ).then((_logs) => {
      const logs = _logs.flat();

      const logIntervals = this.buildLogIntervals({
        fromBlock,
        toBlock,
        logs,
      });

      for (const logInterval of logIntervals) {
        const { startBlock, endBlock, logs, transactionHashes } = logInterval;
        (this.blockCallbacks[endBlock] ||= []).push((block) =>
          this.syncStore
            .insertFactoryLogFilterInterval({
              chainId: factory.chainId,
              factory: factory.criteria,
              block,
              transactions: block.transactions.filter((tx) =>
                transactionHashes.has(tx.hash),
              ),
              logs,
              interval: {
                startBlock: BigInt(startBlock),
                endBlock: BigInt(endBlock),
              },
            })
            .then(() => {
              this.common.metrics.ponder_historical_completed_blocks.inc(
                {
                  network: this.network.name,
                  contract: factory.contractName,
                },
                endBlock - startBlock + 1,
              );
            }),
        );
      }

      this.factoryLogFilterProgressTrackers[factory.id].addCompletedInterval([
        fromBlock,
        toBlock,
      ]);

      if (logIntervals.length === 0) this.checkSyncCompletion();

      this.enqueueBlockTasks();

      this.common.logger.trace({
        service: "historical",
        msg: `Completed FACTORY_LOG_FILTER task adding ${logIntervals.length} BLOCK tasks [${fromBlock}, ${toBlock}] (contract=${factory.contractName}, network=${this.network.name})`,
      });
    });
  };

  private blockTaskWorker = (task: BlockTask) => {
    const { blockNumber, callbacks } = task;

    const stopClock = startClock();

    return request(
      this.network,
      "historical",
      {
        method: "eth_getBlockByNumber",
        params: [toHex(blockNumber), true],
      },
      blockNumber,
    )
      .then((block) => {
        this.common.metrics.ponder_historical_rpc_request_duration.observe(
          { method: "eth_getBlockByNumber", network: this.network.name },
          stopClock(),
        );

        return block;
      })
      .then((block) => {
        if (!block) throw new Error(`Block not found: ${blockNumber}`);
        return block! as HistoricalBlock;
      })
      .then(
        (block): Promise<HistoricalBlock> =>
          Promise.all(callbacks.map((cb) => cb(block))).then(() => block),
      )
      .then((block) => {
        const newBlockCheckpoint = this.blockProgressTracker.addCompletedBlock({
          blockNumber,
          blockTimestamp: hexToNumber(block.timestamp),
        });

        this.checkSyncCompletion();

        if (newBlockCheckpoint) {
          this.emit("historicalCheckpoint", {
            blockTimestamp: newBlockCheckpoint.blockTimestamp,
            chainId: this.network.chainId,
            blockNumber: newBlockCheckpoint.blockNumber,
          });
        }

        this.common.logger.trace({
          service: "historical",
          msg: `Completed BLOCK task ${hexToNumber(block.number!)} with ${
            callbacks.length
          } callbacks (network=${this.network.name})`,
        });
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
  }) => {
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
        this.blockTaskWorker({
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
   * Calls eth_getLogs on the rpc, handles different error types and retries them.
   */
  private _eth_getLogs = (params: {
    address?: Address | Address[];
    topics?: Topics;
    fromBlock: Hex;
    toBlock: Hex;
  }): Promise<RpcLog[]> => {
    let error: LogFilterError | null = null;

    const stopClock = startClock();
    try {
      return request(
        this.network,
        "historical",
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
      error = err as LogFilterError;
    } finally {
      this.common.metrics.ponder_historical_rpc_request_duration.observe(
        { method: "eth_getLogs", network: this.network.name },
        stopClock(),
      );
    }

    const retryRanges = getLogFilterRetryRanges(
      error,
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
  };
}
