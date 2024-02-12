import type { Common } from "@/Ponder.js";
import type { Network } from "@/config/networks.js";
import {
  type Factory,
  type LogFilter,
  type Source,
  sourceIsFactory,
  sourceIsLogFilter,
} from "@/config/sources.js";
import type { SyncStore } from "@/sync-store/store.js";
import { type Checkpoint, maxCheckpoint } from "@/utils/checkpoint.js";
import { dedupe } from "@/utils/dedupe.js";
import { Emittery } from "@/utils/emittery.js";
import { poll } from "@/utils/poll.js";
import { range } from "@/utils/range.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import {
  type Address,
  BlockNotFoundError,
  type Hex,
  hexToNumber,
  numberToHex,
} from "viem";
import { isMatchedLogInBloomFilter } from "./bloom.js";
import { filterLogs } from "./filter.js";
import {
  type LightBlock,
  type LightLog,
  type RealtimeBlock,
  type RealtimeLog,
  realtimeBlockToLightBlock,
  realtimeLogToLightLog,
} from "./format.js";

type RealtimeSyncEvents = {
  realtimeCheckpoint: Checkpoint;
  finalityCheckpoint: Checkpoint;
  shallowReorg: Checkpoint;
  deepReorg: { detectedAtBlockNumber: number; minimumDepth: number };
  idle: undefined;
  fatal: undefined;
};

export class RealtimeSyncService extends Emittery<RealtimeSyncEvents> {
  private common: Common;
  private syncStore: SyncStore;
  private network: Network;
  private requestQueue: RequestQueue;
  private sources: Source[];

  /**
   * Derived source state.
   */
  private hasFactorySource: boolean;
  private logFilterSources: LogFilter[];
  private factorySources: Factory[];
  private address: Address[] | undefined;
  private eventSelectors: Hex[];

  private isProcessingBlock = false;
  private isProcessBlockQueued = false;

  private lastLogsPerBlock = 0;

  /** Current finalized block. */
  private finalizedBlock: LightBlock = undefined!;
  /** Local representation of the unfinalized portion of the chain. */
  private blocks: LightBlock[] = [];
  private logs: LightLog[] = [];
  /** Function to stop polling for new blocks. */
  private unpoll = () => {};
  /** If true, failed tasks should not log errors or be retried. */
  private isShuttingDown = false;

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
    sources?: Source[];
  }) {
    super();

    this.common = common;
    this.syncStore = syncStore;
    this.network = network;
    this.requestQueue = requestQueue;
    this.sources = sources;

    this.hasFactorySource = sources.some(sourceIsFactory);
    this.logFilterSources = sources.filter(sourceIsLogFilter);
    this.factorySources = sources.filter(sourceIsFactory);

    const isAddressDefined = this.logFilterSources.every(
      (source) => !!source.criteria.address,
    );

    // If all sources are log filters that define an address, we can pass an address
    // param to our realtime eth_getLogs requests. But, if any of our sources are
    // factories OR any of our log filter sources DON'T specify address, we can't narrow
    // the address field and must pass undefined.
    this.address =
      !this.hasFactorySource && isAddressDefined
        ? (sources.flatMap((source) => source.criteria.address) as Address[])
        : undefined;

    this.eventSelectors = sources.flatMap((source) => {
      const topics: Hex[] = [];

      if (sourceIsFactory(source)) {
        topics.push(source.criteria.eventSelector);
      }

      const topic0 = source.criteria.topics?.[0];
      if (topic0) {
        if (Array.isArray(topic0)) topics.push(...topic0);
        else topics.push(topic0);
      } else {
        topics.push(...(Object.keys(source.abiEvents.bySelector) as Hex[]));
      }
      return topics;
    });
  }

  setup = async () => {
    // Initialize state variables. Required when restarting the service.
    this.blocks = [];
    this.logs = [];

    // Fetch the latest block, and remote chain Id for the network.
    let latestBlock: RealtimeBlock;
    let rpcChainId: number;
    try {
      [latestBlock, rpcChainId] = await Promise.all([
        this._eth_getBlockByNumber("latest"),
        this.requestQueue
          .request({ method: "eth_chainId" })
          .then((c) => hexToNumber(c)),
      ]);
    } catch (error_) {
      throw Error(
        "Failed to fetch initial realtime data. (Hint: Most likely the result of an incapable RPC provider)",
      );
    }

    if (rpcChainId !== this.network.chainId) {
      this.common.logger.warn({
        service: "realtime",
        msg: `Remote chain ID (${rpcChainId}) does not match configured chain ID (${this.network.chainId}) for network "${this.network.name}"`,
      });
    }

    const latestBlockNumber = hexToNumber(latestBlock.number);

    this.common.logger.info({
      service: "realtime",
      msg: `Fetched latest block at ${latestBlockNumber} (network=${this.network.name})`,
    });

    this.common.metrics.ponder_realtime_is_connected.set(
      { network: this.network.name },
      1,
    );

    // Set the finalized block number according to the network's finality threshold.
    // If the finality block count is greater than the latest block number, set to zero.
    // Note: Doesn't handle the case when there are no finalized blocks
    const finalizedBlockNumber = Math.max(
      0,
      latestBlockNumber - this.network.finalityBlockCount,
    );

    this.finalizedBlock = await this._eth_getBlockByNumber(
      finalizedBlockNumber,
    ).then(realtimeBlockToLightBlock);

    return { latestBlockNumber, finalizedBlockNumber };
  };

  start = () => {
    // If an endBlock is specified for every event source on this network, and the
    // latest end blcock is less than the finalized block number, we can stop here.
    // The service won't poll for new blocks and won't emit any events.
    const endBlocks = this.sources.map((f) => f.endBlock);
    if (
      endBlocks.every(
        (endBlock) =>
          endBlock !== undefined && endBlock < this.finalizedBlock.number,
      )
    ) {
      this.common.logger.warn({
        service: "realtime",
        msg: `No realtime contracts (network=${this.network.name})`,
      });

      this.emit("realtimeCheckpoint", {
        ...maxCheckpoint,
        chainId: this.network.chainId,
      });

      this.common.metrics.ponder_realtime_is_connected.set(
        { network: this.network.name },
        0,
      );

      return;
    }

    // TODO: Subscriptions
    this.unpoll = poll(
      async () => {
        await this.process();
      },
      { emitOnBegin: false, interval: this.network.pollingInterval },
    );
  };

  kill = () => {
    this.isShuttingDown = true;
    this.unpoll();
    this.common.logger.debug({
      service: "realtime",
      msg: `Killed realtime sync service (network=${this.network.name})`,
    });
  };

  onIdle = () => {
    if (!this.isProcessingBlock) return Promise.resolve();

    return new Promise<void>((res) => {
      this.on("idle", res);
    });
  };

  process = async () => {
    if (this.isProcessingBlock) {
      this.isProcessBlockQueued = true;
      return;
    }

    this.isProcessingBlock = true;

    for (let i = 0; i < 4; i++) {
      try {
        const block = await this._eth_getBlockByNumber("latest");
        await this.handleNewBlock(block);
        break;
      } catch (error_) {
        const error = error_ as Error;
        if (this.isShuttingDown) return;

        this.common.logger.warn({
          service: "realtime",
          msg: `Realtime sync task failed (network=${
            this.network.name
          }, error=${`${error.name}: ${error.message}`})`,
          network: this.network.name,
        });

        if (i === 3) this.emit("fatal");
      }
    }

    this.isProcessingBlock = false;

    if (this.isProcessBlockQueued) {
      this.isProcessBlockQueued = false;
      await this.process();
    } else {
      this.emit("idle");
    }
  };

  /**
   * 1) Determine sync algorithm to use.
   * 2) Fetch new blocks and logs.
   * 3) Check for re-org, if occurred evict forked blocks and logs, and re-run.
   *    If not re-org, continue.
   * 4) Add blocks, logs, and tx data to store.
   * 5) Move finalized block forward if applicable, insert interval.
   *
   */
  private handleNewBlock = async (newBlock: RealtimeBlock) => {
    const latestLocalBlock = this.getLatestLocalBlock();

    // We already saw and handled this block. No-op.
    if (latestLocalBlock.hash === newBlock.hash) {
      this.common.logger.trace({
        service: "realtime",
        msg: `Already processed block at ${hexToNumber(
          newBlock.number,
        )} (network=${this.network.name})`,
      });

      return;
    }

    const sync = this.determineSyncPath(newBlock);
    const syncResult =
      sync === "traverse"
        ? await this.syncTraverse(newBlock)
        : await this.syncBatch(newBlock);

    if (!syncResult.reorg) {
      await this.insertRealtimeBlocks(syncResult);

      this.logs.push(...syncResult.logs.map(realtimeLogToLightLog));
      this.blocks.push(...syncResult.blocks.map(realtimeBlockToLightBlock));
    }

    // If this block moves the finality checkpoint, remove now-finalized blocks from the local chain
    // and mark data as cached in the store.

    const latestBlockNumber = hexToNumber(newBlock.number);
    const blockMovesFinality =
      latestBlockNumber >=
      this.finalizedBlock.number + 2 * this.network.finalityBlockCount;

    let hasReorg = false;

    if (
      (blockMovesFinality &&
        !this.isChainConsistent([this.finalizedBlock, ...this.blocks])) ||
      syncResult.reorg
    ) {
      hasReorg = await this.reconcileReorg(latestBlockNumber);
    }

    if (hasReorg || syncResult.reorg) {
      this.common.metrics.ponder_realtime_reorg_total.inc({
        network: this.network.name,
      });

      this.isProcessBlockQueued = true;

      return;
    }

    if (blockMovesFinality) {
      const newFinalizedBlock = this.blocks.findLast(
        (block) =>
          block.number <= latestBlockNumber - this.network.finalityBlockCount,
      );

      // Note: double check this
      if (newFinalizedBlock) {
        this.blocks = this.blocks.filter(
          (block) => block.number > newFinalizedBlock.number,
        );
        this.logs = this.logs.filter(
          (log) => log.blockNumber > newFinalizedBlock.number,
        );

        // TODO: Update this to insert:
        // 1) Log filter intervals
        // 2) Factory contract intervals
        // 3) Child filter intervals
        await this.syncStore.insertRealtimeInterval({
          chainId: this.network.chainId,
          logFilters: this.logFilterSources.map((l) => l.criteria),
          factories: this.factorySources.map((f) => f.criteria),
          interval: {
            startBlock: BigInt(this.finalizedBlock.number + 1),
            endBlock: BigInt(newFinalizedBlock.number),
          },
        });

        this.finalizedBlock = newFinalizedBlock;

        this.emit("finalityCheckpoint", {
          blockTimestamp: newFinalizedBlock.timestamp,
          chainId: this.network.chainId,
          blockNumber: newFinalizedBlock.number,
        });

        this.common.logger.debug({
          service: "realtime",
          msg: `Updated finality checkpoint to ${newFinalizedBlock.number} (network=${this.network.name})`,
        });
      }
    }

    const newBlockNumber = hexToNumber(newBlock.number);
    const newBlockTimestamp = hexToNumber(newBlock.timestamp);

    this.emit("realtimeCheckpoint", {
      blockTimestamp: newBlockTimestamp,
      chainId: this.network.chainId,
      blockNumber: newBlockNumber,
    });

    this.common.metrics.ponder_realtime_latest_block_number.set(
      { network: this.network.name },
      newBlockNumber,
    );
    this.common.metrics.ponder_realtime_latest_block_timestamp.set(
      { network: this.network.name },
      newBlockTimestamp,
    );

    this.common.logger.debug({
      service: "realtime",
      msg: `Finished syncing new head block ${hexToNumber(
        newBlock.number,
      )} (network=${this.network.name})`,
    });
  };

  /**
   * Determine which sync algorithm to use.
   */
  determineSyncPath = (newBlock: RealtimeBlock): "traverse" | "batch" => {
    if (this.hasFactorySource) return "batch";

    const latestLocalBlock = this.getLatestLocalBlock();

    const numBlocks = hexToNumber(newBlock.number) - latestLocalBlock.number;

    // Probability of a log in a block
    const pLog = Math.min(this.lastLogsPerBlock, 1);

    const batchCost =
      75 +
      16 * numBlocks * pLog +
      75 * Math.min(1, numBlocks / this.network.finalityBlockCount);

    // Probability of no logs in the range of blocks
    const pNoLogs = (1 - pLog) ** numBlocks;
    const traverseCost = 16 * numBlocks + 75 * (1 - pNoLogs);

    return batchCost > traverseCost ? "traverse" : "batch";
  };

  private syncTraverse = async (
    newBlock: RealtimeBlock,
  ): Promise<
    | { blocks: RealtimeBlock[]; logs: RealtimeLog[]; reorg: false }
    | { reorg: true }
  > => {
    const latestLocalBlock = this.getLatestLocalBlock();
    const latestLocalBlockNumber = latestLocalBlock.number;

    const newBlockNumber = hexToNumber(newBlock.number);

    const missingBlockRange = range(latestLocalBlockNumber + 1, newBlockNumber);
    const newBlocks = await Promise.all(
      missingBlockRange.map(this._eth_getBlockByNumber),
    );
    newBlocks.push(newBlock);

    // Detect re-org

    if (!this.isChainConsistent([latestLocalBlock, ...newBlocks])) {
      return { reorg: true };
    }

    const criteria = this.sources.map((s) => s.criteria);
    // Don't attempt to skip "eth_getLogs" if a factory source is present.
    // Note: this may not be a possible path depending on the implementation of "determineSyncPath".
    const canSkipGetLogs =
      !this.hasFactorySource &&
      newBlocks.every(
        (block) =>
          !isMatchedLogInBloomFilter({
            bloom: block.logsBloom,
            logFilters: criteria,
          }),
      );

    if (canSkipGetLogs) return { blocks: newBlocks, logs: [], reorg: false };

    const logs = await this._eth_getLogs({
      fromBlock: numberToHex(latestLocalBlockNumber + 1),
      toBlock: numberToHex(newBlockNumber),
    });

    const matchedLogs = await this.getMatchedLogs(
      logs,
      BigInt(newBlockNumber),
      true,
    );

    return { blocks: newBlocks, logs: matchedLogs, reorg: false };
  };

  private syncBatch = async (
    newBlock: RealtimeBlock,
  ): Promise<{
    blocks: RealtimeBlock[];
    logs: RealtimeLog[];
    reorg: false;
  }> => {
    const latestLocalBlock = this.getLatestLocalBlock();
    const latestLocalBlockNumber = latestLocalBlock.number;

    const newBlockNumber = hexToNumber(newBlock.number);

    // Get logs
    const logs = await this._eth_getLogs({
      fromBlock: numberToHex(latestLocalBlockNumber + 1),
      toBlock: newBlock.number,
    });

    const matchedLogs = await this.getMatchedLogs(
      logs,
      BigInt(newBlockNumber),
      true,
    );

    // Get blocks
    const missingBlockNumbers = dedupe(
      matchedLogs.map((log) => log.blockNumber!),
    ).filter((b) => b !== newBlock.number);

    const blocks = await Promise.all(
      missingBlockNumbers.map(this._eth_getBlockByNumber),
    );
    blocks.push(newBlock);

    return { blocks: blocks, logs: matchedLogs, reorg: false };
  };

  /**
   * Check if a re-org occurred by comparing remote logs to local.
   *
   * @returns True if a re-org has occurred.
   */
  reconcileReorg = async (latestBlockNumber: number) => {
    const logs = await this._eth_getLogs({
      fromBlock: numberToHex(this.finalizedBlock.number + 1),
      toBlock: numberToHex(latestBlockNumber),
    });

    const matchedLogs = await this.getMatchedLogs(
      logs,
      BigInt(latestBlockNumber),
      false,
    );

    const localLogs = this.logs.filter(
      (log) => log.blockNumber <= latestBlockNumber,
    );

    /**
     * Common ancestor is the block directly before the logs diverge.
     * If the divergence occurred at index 0, check for deep re-org.
     */
    const handleReorg = async (nonMatchingIndex: number) => {
      if (nonMatchingIndex === 0) {
        const hasDeepReorg = await this.reconcileDeepReorg(latestBlockNumber);

        if (hasDeepReorg) return;

        this.blocks = [];
        this.logs = [];

        await this.syncStore.deleteRealtimeData({
          chainId: this.network.chainId,
          fromBlock: BigInt(this.finalizedBlock.number),
        });

        this.emit("shallowReorg", {
          blockTimestamp: this.finalizedBlock.timestamp,
          chainId: this.network.chainId,
          blockNumber: this.finalizedBlock.number,
        });

        const depth = latestBlockNumber - this.finalizedBlock.number;
        this.common.logger.warn({
          service: "realtime",
          msg: `Detected ${depth}-block reorg with common ancestor ${this.finalizedBlock.number} (network=${this.network.name})`,
        });
      } else {
        const ancestorBlockHash = localLogs[nonMatchingIndex - 1].blockHash;
        const commonAncestor = this.blocks.find(
          (block) => block.hash === ancestorBlockHash,
        )!;

        this.blocks = this.blocks.filter(
          (block) => block.number <= commonAncestor.number,
        );
        this.logs = this.logs.filter(
          (log) => log.blockNumber <= commonAncestor.number,
        );

        await this.syncStore.deleteRealtimeData({
          chainId: this.network.chainId,
          fromBlock: BigInt(commonAncestor.number),
        });

        this.emit("shallowReorg", {
          blockTimestamp: commonAncestor.timestamp,
          chainId: this.network.chainId,
          blockNumber: commonAncestor.number,
        });

        const depth = latestBlockNumber - commonAncestor.number;
        this.common.logger.warn({
          service: "realtime",
          msg: `Detected ${depth}-block reorg with common ancestor ${commonAncestor.number} (network=${this.network.name})`,
        });
      }
    };

    let i = 0;
    for (; i < localLogs.length && i < matchedLogs.length; i++) {
      const lightMatchedLog = realtimeLogToLightLog(matchedLogs[i]);
      if (lightMatchedLog.blockHash !== localLogs[i].blockHash) {
        handleReorg(i);
        return true;
      }
    }

    if (localLogs.length !== matchedLogs.length) {
      handleReorg(i);
      return true;
    }

    // If there are no logs to compare, must make sure a deep re-org didn't occur.
    if (localLogs.length === 0) {
      return await this.reconcileDeepReorg(latestBlockNumber);
    } else return false;
  };

  /**
   * Check if deep re-org occured by comparing remote "finalized" block to local.
   */
  private reconcileDeepReorg = async (latestBlockNumber: number) => {
    const remoteFinalizedBlock = await this._eth_getBlockByNumber(
      this.finalizedBlock.number,
    );

    if (remoteFinalizedBlock.hash !== this.finalizedBlock.hash) {
      this.emit("deepReorg", {
        detectedAtBlockNumber: latestBlockNumber,
        minimumDepth: latestBlockNumber - this.blocks[0].number,
      });

      this.common.logger.warn({
        service: "realtime",
        msg: `Unable to reconcile >${
          latestBlockNumber - this.blocks[0].number
        }-block reorg (network=${this.network.name})`,
      });

      this.emit("fatal");

      this.blocks = [];
      this.logs = [];

      this.finalizedBlock = realtimeBlockToLightBlock(remoteFinalizedBlock);

      return true;
    }
    return false;
  };

  /**
   * Helper function for "eth_getBlockByNumber" request.
   */
  private _eth_getBlockByNumber = (
    block: "latest" | Hex | number,
  ): Promise<RealtimeBlock> =>
    this.requestQueue
      .request({
        method: "eth_getBlockByNumber",
        params: [typeof block === "number" ? numberToHex(block) : block, true],
      })
      .then((block) => {
        if (!block) throw new BlockNotFoundError({});
        return block as RealtimeBlock;
      });

  /**
   * Helper function for "eth_getLogs" rpc request.
   *
   * Note: Consider handling different error types and retry the request if applicable.
   */
  private _eth_getLogs = (params: {
    fromBlock: Hex;
    toBlock: Hex;
  }): Promise<RealtimeLog[]> =>
    this.requestQueue.request({
      method: "eth_getLogs",
      params: [
        {
          fromBlock: params.fromBlock,
          toBlock: params.toBlock,
          address: this.address,
          topics: [this.eventSelectors],
        },
      ],
    }) as Promise<RealtimeLog[]>;

  private insertRealtimeBlocks = async ({
    logs,
    blocks,
  }: { logs: RealtimeLog[]; blocks: RealtimeBlock[] }) => {
    for (const block of blocks) {
      const blockLogs = logs.filter((l) => l.blockNumber === block.number);

      if (blockLogs.length === 0) continue;

      const requiredTransactionHashes = new Set(
        blockLogs.map((l) => l.transactionHash),
      );
      const blockTransactions = block.transactions.filter((t) =>
        requiredTransactionHashes.has(t.hash),
      );

      // TODO: Maybe rename or at least document behavior
      await this.syncStore.insertRealtimeBlock({
        chainId: this.network.chainId,
        block: block,
        transactions: blockTransactions,
        logs: blockLogs,
      });

      const matchedLogCountText =
        blockLogs.length === 1
          ? "1 matched log"
          : `${blockLogs.length} matched logs`;
      this.common.logger.info({
        service: "realtime",
        msg: `Synced ${matchedLogCountText} from block ${hexToNumber(
          block.number,
        )} (network=${this.network.name})`,
      });
    }

    this.lastLogsPerBlock = logs.length / blocks.length;
  };

  private getMatchedLogs = async (
    logs: RealtimeLog[],
    toBlockNumber: bigint,
    insertChildAddress: boolean,
  ): Promise<RealtimeLog[]> => {
    if (!this.hasFactorySource) {
      return filterLogs({
        logs,
        logFilters: this.sources.map((s) => s.criteria),
      });
    } else {
      // Find and insert any new child contracts.
      const matchedFactoryLogs = filterLogs({
        logs,
        logFilters: this.factorySources.map((fs) => ({
          address: fs.criteria.address,
          topics: [fs.criteria.eventSelector],
        })),
      });

      if (insertChildAddress) {
        await this.syncStore.insertFactoryChildAddressLogs({
          chainId: this.network.chainId,
          logs: matchedFactoryLogs,
        });
      }

      // Find any logs matching log filters or child contract filters.
      // NOTE: It might make sense to just insert all logs rather than introduce
      // a potentially slow DB operation here. It's a tradeoff between sync
      // latency and database growth.
      // NOTE: Also makes sense to hold factoryChildAddresses in memory rather than
      // a query each interval.
      const factoryLogFilters = await Promise.all(
        this.factorySources.map(async (factory) => {
          const iterator = this.syncStore.getFactoryChildAddresses({
            chainId: this.network.chainId,
            factory: factory.criteria,
            upToBlockNumber: toBlockNumber,
          });
          const childContractAddresses: Address[] = [];
          for await (const batch of iterator) {
            childContractAddresses.push(...batch);
          }
          return {
            address: childContractAddresses,
            topics: factory.criteria.topics,
          };
        }),
      );

      return filterLogs({
        logs,
        logFilters: [
          ...this.logFilterSources.map((l) => l.criteria),
          ...factoryLogFilters,
        ],
      });
    }
  };

  /** Returns true if "blocks" has a valid chain of block.parentHash to block.hash. */
  private isChainConsistent = (
    blocks: (LightBlock | RealtimeBlock)[],
  ): boolean => {
    for (let i = blocks.length - 1; i > 1; i--) {
      if (blocks[i].parentHash !== blocks[i - 1].hash) return false;
    }
    return true;
  };

  private getLatestLocalBlock = (): LightBlock =>
    this.blocks[this.blocks.length - 1] ?? this.finalizedBlock;
}
