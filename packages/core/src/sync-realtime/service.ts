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
  private topics: Hex[];

  // Note: is the just the last item of block?
  private mostRecentBlock: LightBlock = undefined!;

  private isProcessingBlock = false;
  private isProcessBlockQueued = false;

  private lastLogsPerBlock = 0;

  /** Block number of the current finalized block. */
  private finalizedBlockNumber = 0;
  /** Local representation of the unfinalized portion of the chain. */
  private blocks: LightBlock[] = [];
  private logs: LightLog[] = [];
  /** Function to stop polling for new blocks. */
  private unpoll?: () => boolean;
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
    this.address =
      !this.hasFactorySource && isAddressDefined
        ? (sources.flatMap((source) => source.criteria.address) as Address[])
        : undefined;

    this.topics = sources.flatMap((source) => {
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

    // Fetch the latest block, and remote chain Id for the network.
    let latestBlock: RealtimeBlock;
    let finalizedBlock: RealtimeBlock;
    let rpcChainId: number;
    try {
      [latestBlock, finalizedBlock, rpcChainId] = await Promise.all([
        this._eth_getBlockByNumber("latest"),
        this._eth_getBlockByNumber("finalized"),
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
    const finalizedBlockNumber = hexToNumber(finalizedBlock.number);

    this.common.logger.info({
      service: "realtime",
      msg: `Fetched latest block at ${latestBlockNumber} (network=${this.network.name})`,
    });
    this.common.logger.info({
      service: "realtime",
      msg: `Fetched finalized block at ${finalizedBlockNumber} (network=${this.network.name})`,
    });

    this.common.metrics.ponder_realtime_is_connected.set(
      { network: this.network.name },
      1,
    );

    // Note: Could do this same thing with an rpc request
    // Note: Doesn't handle the case when there are no finalized blocks

    this.mostRecentBlock = realtimeBlockToLightBlock(finalizedBlock);

    return { latestBlockNumber, finalizedBlockNumber };
  };

  start = async () => {
    // If an endBlock is specified for every event source on this network, and the
    // latest end blcock is less than the finalized block number, we can stop here.
    // The service won't poll for new blocks and won't emit any events.
    const endBlocks = this.sources.map((f) => f.endBlock);
    if (
      endBlocks.every(
        (endBlock) =>
          endBlock !== undefined && endBlock < this.finalizedBlockNumber,
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
        await this.processBlock();
      },
      { emitOnBegin: false, interval: this.network.pollingInterval },
    );
  };

  kill = () => {
    this.isShuttingDown = true;
    this.unpoll?.();
    this.common.logger.debug({
      service: "realtime",
      msg: `Killed realtime sync service (network=${this.network.name})`,
    });
  };

  processBlock = async () => {
    if (this.isProcessingBlock) {
      this.isProcessBlockQueued = true;
      return;
    }

    try {
      const block = await this._eth_getBlockByNumber("latest");
      await this.blockHandler(block);
    } catch (error_) {
      if (this.isShuttingDown) return;
      const error = error_ as Error;

      this.common.logger.warn({
        service: "realtime",
        msg: `Realtime sync task failed (network=${
          this.network.name
        }, error=${`${error.name}: ${error.message}`})`,
        network: this.network.name,
      });
      // Note: Good spot to throw a fatal error.
    } finally {
      this.isProcessingBlock = false;

      if (this.isProcessBlockQueued) {
        this.isProcessBlockQueued = false;
        await this.processBlock();
      }
    }
  };

  private blockHandler = async (newBlock: RealtimeBlock) => {
    // We already saw and handled this block. No-op.
    if (this.mostRecentBlock.hash === newBlock.hash) {
      this.common.logger.trace({
        service: "realtime",
        msg: `Already processed block at ${hexToNumber(
          newBlock.number,
        )} (network=${this.network.name})`,
      });

      return;
    }

    const sync = this.determineSyncPath(newBlock);
    if (sync === "traverse") await this.syncTraverse(newBlock);
    else await this.syncBatch(newBlock);

    // If this block moves the finality checkpoint, remove now-finalized blocks from the local chain
    // and mark data as cached in the store.
    if (
      hexToNumber(newBlock.number) >
      this.finalizedBlockNumber + 2 * this.network.finalityBlockCount
    ) {
      if (!this.isBlocksComplete()) {
        await this.reorgBatch(hexToNumber(newBlock.number));
      }

      const newFinalizedBlock = this.blocks.find(
        (block) =>
          block.number ===
          this.finalizedBlockNumber + this.network.finalityBlockCount,
      )!;

      this.blocks = this.blocks.filter(
        (block) => block.number >= newFinalizedBlock.number,
      );
      this.logs = this.logs.filter(
        (log) => log.blockNumber >= newFinalizedBlock.number,
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
          startBlock: BigInt(this.finalizedBlockNumber + 1),
          endBlock: BigInt(newFinalizedBlock.number),
        },
      });

      this.finalizedBlockNumber = newFinalizedBlock.number;

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
  private determineSyncPath = (
    newBlock: RealtimeBlock,
  ): "traverse" | "batch" => {
    if (this.hasFactorySource) return "batch";

    const numBlocks =
      hexToNumber(newBlock.number) - this.mostRecentBlock.number;

    // Probability of a log in a block
    const pLog = Math.min(this.lastLogsPerBlock, 1);

    const costBatch = 2 * 75 + 16 * numBlocks * pLog;

    // Probability of no logs in the range of blocks
    const pNoLogs = (1 - pLog) ** numBlocks;
    const costTraverse = 16 * numBlocks + 75 * (1 - pNoLogs);

    if (costBatch > costTraverse) return "traverse";
    else return "batch";
  };

  private syncTraverse = async (newBlock: RealtimeBlock) => {
    const newBlockNumber = hexToNumber(newBlock.number);
    const newBlockTimestamp = hexToNumber(newBlock.timestamp);

    if (newBlockNumber > this.mostRecentBlock.number) {
      const missingBlockRange = range(
        this.mostRecentBlock.number + 1,
        newBlockNumber,
      );
      const newBlocks = await Promise.all(
        missingBlockRange.map(this._eth_getBlockByNumber),
      );
      newBlocks.push(newBlock);

      if (newBlocks[0].parentHash !== this.mostRecentBlock.hash) {
        await this.reorgTraverse(newBlocks[0], hexToNumber(newBlock.number));
      }

      const criteria = this.sources.map((s) => s.criteria);
      // Don't attempt to skip "eth_getLogs" if a factory source is present.
      // Note: this may not be a possible path depending on the implementation of "determineSyncPath".
      const requestLogs = this.hasFactorySource
        ? true
        : newBlocks.some((block) =>
            isMatchedLogInBloomFilter({
              bloom: block.logsBloom,
              logFilters: criteria,
            }),
          );

      if (requestLogs) {
        // Get logs
        const logs = await this._eth_getLogs({
          fromBlock: numberToHex(this.mostRecentBlock.number + 1),
          toBlock: numberToHex(newBlockNumber),
        });

        const matchedLogs = await this.getMatchedLogs(
          logs,
          BigInt(newBlockNumber),
          true,
        );

        // Insert logs + blocks + transactions
        await this.insertRealtimeBlocks(matchedLogs, newBlocks);
      }

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

      this.mostRecentBlock = realtimeBlockToLightBlock(newBlock);
    } else {
      await this.reorgTraverse(newBlock, hexToNumber(newBlock.number));
    }
  };

  private syncBatch = async (newBlock: RealtimeBlock) => {
    const newBlockNumber = hexToNumber(newBlock.number);
    const newBlockTimestamp = hexToNumber(newBlock.timestamp);

    // Get logs
    const logs = await this._eth_getLogs({
      fromBlock: numberToHex(this.mostRecentBlock.number + 1),
      toBlock: numberToHex(newBlockNumber),
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

    // Insert logs + blocks + transactions
    await this.insertRealtimeBlocks(matchedLogs, blocks);

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

    this.mostRecentBlock = realtimeBlockToLightBlock(newBlock);
  };

  /**
   * Attempt to reconcile re-org using only local blocks.
   */
  private reorgTraverse = async (
    newBlock: RealtimeBlock,
    latestBlockNumber: number,
  ) => {
    const commonAncestor = this.blocks.findLast(
      (parent) => parent.hash === newBlock.parentHash,
    );

    if (commonAncestor !== undefined) {
      // Found parent block in local blocks
      this.emit("shallowReorg", {
        blockTimestamp: commonAncestor.timestamp,
        chainId: this.network.chainId,
        blockNumber: commonAncestor.number,
      });

      this.mostRecentBlock = commonAncestor;

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
    } else if (this.isBlocksComplete()) {
      this.emit("deepReorg", {
        detectedAtBlockNumber: latestBlockNumber,
        minimumDepth: latestBlockNumber - this.blocks[0].number,
      });
      // TODO: what to do with local logs and blocks
    } else {
      await this.reorgBatch(latestBlockNumber);
    }
  };

  /**
   * Reconcile re-org by comparing "eth_getLogs" to local logs.
   */
  private reorgBatch = async (latestBlockNumber: number) => {
    // Note: toBlock could be mostRecentBlock
    const logs = await this._eth_getLogs({
      fromBlock: numberToHex(
        this.finalizedBlockNumber - this.network.finalityBlockCount,
      ),
      toBlock: numberToHex(this.finalizedBlockNumber),
    });

    const matchedLogs = await this.getMatchedLogs(
      logs,
      BigInt(this.finalizedBlockNumber),
      false,
    );

    const localLogs = this.logs.filter(
      (log) => log.blockNumber <= this.finalizedBlockNumber,
    );

    for (let i = 0; i < matchedLogs.length; i++) {
      const lightMatchedLog = realtimeLogToLightLog(matchedLogs[i]);
      if (lightMatchedLog.blockHash !== localLogs[i].blockHash) {
        if (i === 0) {
          this.emit("deepReorg", {
            detectedAtBlockNumber: latestBlockNumber,
            minimumDepth: latestBlockNumber - this.blocks[0].number,
          });
          // TODO: what to do with local logs and blocks
        } else {
          const ancestorBlockHash = localLogs[i - 1].blockHash;
          const commonAncestor = this.blocks.find(
            (block) => block.hash === ancestorBlockHash,
          )!;
          this.emit("shallowReorg", {
            blockTimestamp: commonAncestor.timestamp,
            chainId: this.network.chainId,
            blockNumber: commonAncestor.number,
          });

          this.mostRecentBlock = commonAncestor;

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
        }
      }
    }
  };

  /**
   * Helper function for "eth_getBlockByNumber" request.
   */
  private _eth_getBlockByNumber = (
    block: "latest" | "finalized" | Hex | number,
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
          topics: [this.topics],
        },
      ],
    }) as Promise<RealtimeLog[]>;

  private insertRealtimeBlocks = async (
    logs: RealtimeLog[],
    blocks: RealtimeBlock[],
  ) => {
    for (const block of blocks) {
      const blockLogs = logs.filter((l) => l.blockNumber === block.number);
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

    this.logs.push(...logs.map(realtimeLogToLightLog));
    this.blocks.push(...blocks.map(realtimeBlockToLightBlock));

    this.lastLogsPerBlock = this.logs.length / this.blocks.length;
  };

  private getMatchedLogs = async (
    logs: RealtimeLog[],
    toBlockNumber: bigint,
    insertChildAddress: boolean,
  ): Promise<RealtimeLog[]> => {
    if (this.hasFactorySource) {
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
    } else {
      return filterLogs({
        logs,
        logFilters: this.sources.map((s) => s.criteria),
      });
    }
  };

  /** Returns true if "blocks" is not missing any blocks from tip to "finalizedBlockNumber". */
  private isBlocksComplete = (): boolean => {
    for (let i = this.blocks.length - 1; i > 1; i--) {
      if (this.blocks[i].parentHash !== this.blocks[i - 1].hash) return false;
      if (this.blocks[i - 1].number === this.finalizedBlockNumber) break;
    }
    return true;
  };
}
