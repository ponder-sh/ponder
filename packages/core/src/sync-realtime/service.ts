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
import { type LightBlock, type RealtimeBlock } from "./format.js";

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
  private isQueued = false;

  /** Block number of the current finalized block. */
  private finalizedBlockNumber = 0;
  /** Local representation of the unfinalized portion of the chain. */
  private blocks: LightBlock[] = [];
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
  }): Promise<RpcLog[]> => {
    return this.requestQueue.request({
      method: "eth_getLogs",
      params: [
        {
          fromBlock: params.fromBlock,
          toBlock: params.toBlock,
          address: this.address,
          topics: this.topics,
        },
      ],
    });
  };

  processBlock = async () => {
    if (this.isProcessingBlock) {
      this.isQueued = true;
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
    } finally {
      this.isProcessingBlock = false;

      if (this.isQueued) {
        this.isQueued = false;
        await this.processBlock();
      }
    }
  };

  private blockHandler = async (newBlock: RealtimeBlock) => {
    // We already saw and handled this block. No-op.
    // Note: Need to handle blocks getting removed from chain tip.
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

    // 2) This is the new head block (happy path). Yay!
    if (
      newBlock.number === previousHeadBlock.number + 1 &&
      newBlock.parentHash === previousHeadBlock.hash
    ) {
      // If this block moves the finality checkpoint, remove now-finalized blocks from the local chain
      // and mark data as cached in the store.
      if (
        newBlock.number >
        this.finalizedBlockNumber + 2 * this.network.finalityBlockCount
      ) {
        const newFinalizedBlock = this.blocks.find(
          (block) =>
            block.number ===
            this.finalizedBlockNumber + this.network.finalityBlockCount,
        )!;

        // Remove now-finalized blocks from the local chain (except for the block at newFinalizedBlockNumber).
        this.blocks = this.blocks.filter(
          (block) => block.number >= newFinalizedBlock.number,
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
        msg: `Finished syncing new head block ${newBlock.number} (network=${this.network.name})`,
      });

      return;
    }

    // 4) There has been a reorg, because:
    //   a) newBlock.number <= headBlock + 1.
    //   b) newBlock.hash is not found in our local chain.
    // which means newBlock is on a fork of our local chain.
    //
    // To reconcile, traverse up the remote (canonical) chain until we find the first
    // block that is present in both chains (the common ancestor block).

    // Store the block objects as we fetch them.
    // Once we find the common ancestor, we will add these blocks to the queue.
    const canonicalBlocksWithTransactions = [newBlockWithTransactions];

    // Keep track of the current canonical block
    let canonicalBlock = newBlock;
    let depth = 0;

    this.common.logger.warn({
      service: "realtime",
      msg: `Detected reorg with forked block (${canonicalBlock.number}, ${canonicalBlock.hash}) (network=${this.network.name})`,
    });

    while (canonicalBlock.number > this.finalizedBlockNumber) {
      const commonAncestorBlock = this.blocks.find(
        (b) => b.hash === canonicalBlock.parentHash,
      );

      // If the common ancestor block is present in our local chain, this is a short reorg.
      if (commonAncestorBlock) {
        this.common.logger.warn({
          service: "realtime",
          msg: `Found common ancestor block on local chain at height ${commonAncestorBlock.number} (network=${this.network.name})`,
        });

        // Remove all non-canonical blocks from the local chain.
        this.blocks = this.blocks.filter(
          (block) => block.number <= commonAncestorBlock.number,
        );

        await this.syncStore.deleteRealtimeData({
          chainId: this.network.chainId,
          fromBlock: BigInt(commonAncestorBlock.number),
        });

        // Clear the queue of all blocks (some might be from the non-canonical chain).
        // TODO: Figure out if this is indeed required by some edge case.
        this.queue.clear();

        // Add blocks from the canonical chain (they've already been fetched).
        for (const block of canonicalBlocksWithTransactions) {
          const priority = Number.MAX_SAFE_INTEGER - hexToNumber(block.number);
          this.queue.addTask({ block }, { priority });
        }

        // Also add a new latest block, so we don't have to wait for the next poll to
        // start fetching any newer blocks on the canonical chain.
        await this.addNewLatestBlock();
        this.emit("shallowReorg", {
          blockTimestamp: commonAncestorBlock.timestamp,
          chainId: this.network.chainId,
          blockNumber: commonAncestorBlock.number,
        });

        this.common.logger.info({
          service: "realtime",
          msg: `Reconciled ${depth}-block reorg with common ancestor block ${commonAncestorBlock.number} (network=${this.network.name})`,
        });

        return;
      }

      // If the parent block is not present in our local chain, keep traversing up the canonical chain.
      const parentBlock_ = await this.requestQueue.request({
        method: "eth_getBlockByHash",
        params: [canonicalBlock.parentHash, true],
      });

      if (!parentBlock_)
        throw new Error(
          `Failed to fetch parent block with hash: ${canonicalBlock.parentHash}`,
        );

      canonicalBlocksWithTransactions.unshift(
        parentBlock_ as BlockWithTransactions,
      );
      depth += 1;
      canonicalBlock = rpcBlockToLightBlock(parentBlock_);

      this.common.logger.warn({
        service: "realtime",
        msg: `Fetched canonical block at height ${canonicalBlock.number} while reconciling reorg (network=${this.network.name})`,
      });
    }

    // 5) If the common ancestor was not found in our local chain, this is a deep reorg.
    this.emit("deepReorg", {
      detectedAtBlockNumber: newBlock.number,
      minimumDepth: depth,
    });

    this.common.logger.warn({
      service: "realtime",
      msg: `Unable to reconcile >${depth}-block reorg (network=${this.network.name})`,
    });
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

      // TODO: Check for re-org by checking linked block.parentHash -> block.hash

      const criteria = this.sources.map((s) => s.criteria);
      // Don't attempt to skip "eth_getLogs" if a factory source is present.
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

        const matchedLogs = await this.getMatchedLogs(logs, newBlock);

        // Insert logs + blocks + transactions
        await this.insertRealtimeBlocks(matchedLogs, newBlocks);

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
      }
    } else {
      // re-org detected
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

    const matchedLogs = await this.getMatchedLogs(logs, newBlock);

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

  /**
   * Determine whether to sync missing block ranges with individual traversal or batch "eth_getLogs".
   *
   * Algorithm depends on:
   *   number of blocks to sync
   *   expected event density
   *   number of sources
   *   if sources include factories
   */
  private determineSyncPath = (
    newBlock: RealtimeBlock,
  ): "traverse" | "batch" => {
    const numBlocks =
      hexToNumber(newBlock.number) - hexToNumber(this.mostRecentBlock.number);

    if (numBlocks > 5) return "batch";
    return "traverse";
  };

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
  };

  private getMatchedLogs = async (
    logs: RpcLog[],
    newBlock: RealtimeBlock,
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
      await this.syncStore.insertFactoryChildAddressLogs({
        chainId: this.network.chainId,
        logs: matchedFactoryLogs,
      });

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
            upToBlockNumber: hexToBigInt(newBlock.number),
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
