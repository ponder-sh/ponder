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
  type RpcLog,
  hexToBigInt,
  hexToNumber,
  numberToHex,
} from "viem";
import { isMatchedLogInBloomFilter } from "./bloom.js";
import { filterLogs } from "./filter.js";
import { type RealtimeBlock } from "./format.js";

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

  private mostRecentBlock: RealtimeBlock = undefined!;

  private isProcessingBlock = false;
  private isProcessBlockQueued = false;

  private lastLogsPerBlock = 0;

  /** Block number of the current finalized block. */
  private finalizedBlockNumber = 0;
  /** Local representation of the unfinalized portion of the chain. */
  // TODO: use light blocks
  private blocks: RealtimeBlock[] = [];
  private logs: RpcLog[] = [];
  /** True if blocks is a complete valid chain */
  private isBlocksComplete = false;
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

    this.mostRecentBlock = finalizedBlock;

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
      // if (!blocksReorgSafe)
      await this.reorgBatch();

      const newFinalizedBlock = this.blocks.find(
        (block) =>
          hexToNumber(block.number) ===
          this.finalizedBlockNumber + this.network.finalityBlockCount,
      )!;

      this.blocks = this.blocks.filter(
        (block) =>
          hexToNumber(block.number) >= hexToNumber(newFinalizedBlock.number),
      );
      this.logs = this.logs.filter(
        (log) =>
          hexToNumber(log.blockNumber!) >=
          hexToNumber(newFinalizedBlock.number),
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
          endBlock: hexToBigInt(newFinalizedBlock.number),
        },
      });

      this.finalizedBlockNumber = hexToNumber(newFinalizedBlock.number);

      this.emit("finalityCheckpoint", {
        blockTimestamp: hexToNumber(newFinalizedBlock.timestamp),
        chainId: this.network.chainId,
        blockNumber: hexToNumber(newFinalizedBlock.number),
      });

      this.common.logger.debug({
        service: "realtime",
        msg: `Updated finality checkpoint to ${hexToNumber(
          newFinalizedBlock.number,
        )} (network=${this.network.name})`,
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
   * Determine whether to sync missing block ranges with individual traversal or batch "eth_getLogs".
   *
   * Algorithm depends on:
   *   if sources include factories
   *   number of blocks to sync
   *   expected logs per block
   */
  private determineSyncPath = (
    newBlock: RealtimeBlock,
  ): "traverse" | "batch" => {
    if (this.hasFactorySource) return "batch";

    const numBlocks =
      hexToNumber(newBlock.number) - hexToNumber(this.mostRecentBlock.number);

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
    const mostRecentBlockNumber = hexToNumber(this.mostRecentBlock.number);

    if (newBlockNumber > mostRecentBlockNumber) {
      const missingBlockRange = range(
        mostRecentBlockNumber + 1,
        newBlockNumber,
      );
      const newBlocks = await Promise.all(
        missingBlockRange.map(this._eth_getBlockByNumber),
      );
      newBlocks.push(newBlock);

      if (newBlocks[0].parentHash !== this.mostRecentBlock.hash) {
        this.reorgTraverse(newBlocks[0]);
        // attempt to find parent in local store
        // if found
        // shallow re-org
        // mostRecentBlock = commonAncestor
        // deleteRealtimeData
        // re-run this algorithm
        // ---
        // if store is complete and not found
        // deep re-org
        // continue
        // if store is not complete and not found
        // run fallback re-org detection
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
          fromBlock: numberToHex(mostRecentBlockNumber + 1),
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

      this.mostRecentBlock = newBlock;
    } else {
      this.reorgTraverse(newBlock);
    }
  };

  private syncBatch = async (newBlock: RealtimeBlock) => {
    const newBlockNumber = hexToNumber(newBlock.number);
    const newBlockTimestamp = hexToNumber(newBlock.timestamp);
    const mostRecentBlockNumber = hexToNumber(this.mostRecentBlock.number);

    // Get logs
    const logs = await this._eth_getLogs({
      fromBlock: numberToHex(mostRecentBlockNumber + 1),
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

    this.mostRecentBlock = newBlock;
  };

  private reorgTraverse = async (newBlock: RealtimeBlock) => {
    const commonAncestor = this.blocks.findLast(
      (parent) => parent.hash === newBlock.parentHash,
    );

    if (commonAncestor !== undefined) {
      this.emit("shallowReorg", {
        blockTimestamp: hexToNumber(commonAncestor.timestamp),
        chainId: this.network.chainId,
        blockNumber: hexToNumber(commonAncestor.number),
      });

      this.mostRecentBlock = commonAncestor;
      // TODO: get rid of blocks and logs in front of this?

      await this.syncStore.deleteRealtimeData({
        chainId: this.network.chainId,
        fromBlock: hexToBigInt(commonAncestor.number),
      });

      // re-run syncTraversal algorithm
    } else if (this.isBlocksComplete) {
      // deep re-org
      this.emit("deepReorg", {
        // TODO: use real values
        detectedAtBlockNumber: hexToNumber(newBlock.number),
        minimumDepth: hexToNumber(newBlock.number),
      });
    } else {
      this.reorgBatch();
    }

    // ---
    // if store is complete and not found
    // deep re-org
    // continue
    // if store is not complete and not found
    // run fallback re-org detection
  };

  private reorgBatch = async () => {
    // fallback re-org detection
    // call eth_getLogs from finalized - finalizedCount to mostRecentBlock
    // if divergent, re-org is detected, find common ancestor
    // keep extra last log to determine shallow re-org or deep re-org

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

    // TODO: determine if local logs are equal to matched logs
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
   * Note: Consider handline different error types and retry the request if applicable.
   */
  private _eth_getLogs = (params: {
    fromBlock: Hex;
    toBlock: Hex;
  }): Promise<RpcLog[]> =>
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
    });

  private insertRealtimeBlocks = async (
    logs: RpcLog[],
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

    this.logs.push(...logs);
    this.blocks.push(...blocks);

    this.lastLogsPerBlock = this.logs.length / this.blocks.length;
  };

  private getMatchedLogs = async (
    logs: RpcLog[],
    toBlockNumber: bigint,
    insertChildAddress: boolean,
  ): Promise<RpcLog[]> => {
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
}
