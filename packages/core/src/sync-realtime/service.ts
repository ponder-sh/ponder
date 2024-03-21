import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import {
  type Factory,
  type LogFilter,
  type Source,
  sourceIsFactory,
  sourceIsLogFilter,
} from "@/config/sources.js";
import type { SyncStore } from "@/sync-store/store.js";
import { type Checkpoint } from "@/utils/checkpoint.js";
import { Emittery } from "@/utils/emittery.js";
import { range } from "@/utils/range.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import { wait } from "@/utils/wait.js";
import { poll } from "@ponder/common";
import {
  type GetLogsRetryHelperParameters,
  getLogsRetryHelper,
} from "@ponder/utils";
import {
  type Address,
  BlockNotFoundError,
  type Hex,
  RpcError,
  hexToBigInt,
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
  sortLogs,
} from "./format.js";

type RealtimeSyncEvents = {
  realtimeCheckpoint: Checkpoint;
  finalityCheckpoint: Checkpoint;
  reorg: Checkpoint;
  idle: undefined;
  fatal: Error;
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
      msg: `Fetched latest block ${latestBlockNumber} (network=${this.network.name})`,
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

    this.emit("finalityCheckpoint", {
      blockTimestamp: this.finalizedBlock.timestamp,
      chainId: this.network.chainId,
      blockNumber: this.finalizedBlock.number,
    });

    this.emit("realtimeCheckpoint", {
      blockTimestamp: this.finalizedBlock.timestamp,
      chainId: this.network.chainId,
      blockNumber: this.finalizedBlock.number,
    });

    return { latestBlockNumber, finalizedBlockNumber };
  };

  start = () => {
    // If an endBlock is specified for every event source on this network, and the
    // latest end block is less than the finalized block number, we can stop here.
    // The service won't poll for new blocks and won't emit any events.
    const endBlocks = this.sources.map((f) => f.endBlock);
    if (
      endBlocks.every((b) => b !== undefined && b < this.finalizedBlock.number)
    ) {
      this.common.logger.warn({
        service: "realtime",
        msg: `No realtime contracts (network=${this.network.name})`,
      });
      this.common.metrics.ponder_realtime_is_connected.set(
        { network: this.network.name },
        0,
      );
      return;
    }

    // TODO: Subscriptions
    this.unpoll = poll(this.process, {
      invokeOnStart: true,
      interval: this.network.pollingInterval,
    });
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

  /**
   * Possible states of process
   *
   * 1) Nothing is being processed
   * 2) Processing block, no follow up invocation
   * 3) Processing block, follow up invocation
   */
  process = async () => {
    if (this.isProcessingBlock) {
      this.isProcessBlockQueued = true;
      return;
    }

    this.isProcessingBlock = true;
    this.isProcessBlockQueued = false;

    for (let i = 0; i < 6; i++) {
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

        if (i === 5) this.emit("fatal", error);
        else {
          const duration = 250 * 2 ** i;
          await wait(duration);
        }
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

    this.common.logger.debug({
      service: "realtime",
      msg: `Syncing new block ${hexToNumber(newBlock.number)} (network=${
        this.network.name
      })`,
    });

    const syncResult = await this.syncTraverse(newBlock);

    if (syncResult.reorg) {
      await this.reconcileReorg();

      this.common.metrics.ponder_realtime_reorg_total.inc({
        network: this.network.name,
      });

      this.isProcessBlockQueued = true;
      return;
    } else {
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

    if (blockMovesFinality) {
      const newFinalizedBlock = this.blocks.findLast(
        (block) =>
          block.number <= latestBlockNumber - this.network.finalityBlockCount,
      )!;

      // Check to see if logs are different when re-requested. Degraded rpc providers
      // have trouble indexing logs near the tip of the chain.
      const hasLogsInconsistency = await this.validateLogs(newFinalizedBlock);
      if (hasLogsInconsistency) {
        this.isProcessBlockQueued = true;
        return;
      }

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

    if (latestLocalBlockNumber >= newBlockNumber) {
      return { reorg: true };
    }

    this.common.logger.trace({
      service: "realtime",
      msg: `Requesting blocks from ${
        latestLocalBlockNumber + 1
      } to ${newBlockNumber} (network=${this.network.name})`,
    });

    const newBlocks = await Promise.all(
      missingBlockRange.map(this._eth_getBlockByNumber),
    );
    newBlocks.push(newBlock);

    // Detect re-org
    if (!this.isChainConsistent([...this.blocks, ...newBlocks])) {
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

    if (canSkipGetLogs) {
      this.common.logger.debug({
        service: "realtime",
        msg: `Skipping eth_getLogs call because of logs bloom filter result (network=${this.network.name}`,
      });
    }

    if (canSkipGetLogs) return { blocks: newBlocks, logs: [], reorg: false };

    this.common.logger.trace({
      service: "realtime",
      msg: `Requesting logs from ${
        latestLocalBlockNumber + 1
      } to ${newBlockNumber} (network=${this.network.name})`,
    });

    const _logs = await this._eth_getLogs({
      fromBlock: numberToHex(latestLocalBlockNumber + 1),
      toBlock: numberToHex(newBlockNumber),
    });
    const logs = sortLogs(_logs);

    const matchedLogs = await this.getMatchedLogs(
      logs,
      BigInt(newBlockNumber),
      true,
    );

    if (matchedLogs.length === 0) {
      this.common.logger.debug({
        service: "realtime",
        msg: `False positive logs bloom filter result for blocks from ${
          latestLocalBlockNumber + 1
        } to ${newBlockNumber} (network=${this.network.name})`,
      });
    }

    this.common.logger.debug({
      service: "realtime",
      msg: `Found ${matchedLogs.length} matched logs (network=${this.network.name})`,
    });

    return { blocks: newBlocks, logs: matchedLogs, reorg: false };
  };

  /**
   * Find common ancestor block and evict local blocks and logs that has been reorged out of the chain.
   */
  reconcileReorg = async () => {
    const hasDeepReorg = await this.validateFinalizedBlock();
    if (hasDeepReorg) return;

    // Find common ancestor block by requesting remote block until you find one that fits in the local chain.
    while (this.blocks.length > 0) {
      const localBlock = this.blocks.pop();
      const remoteBlock = await this._eth_getBlockByNumber(localBlock!.number);
      const parent =
        this.blocks.length === 0
          ? this.finalizedBlock
          : this.blocks[this.blocks.length - 1];

      if (parent.hash === remoteBlock.parentHash) {
        this.common.logger.trace({
          service: "realtime",
          msg: `Found common ancestor block ${parent.number} (network=${this.network.name})`,
        });

        this.logs = this.logs.filter((log) => log.blockNumber <= parent.number);

        await this.syncStore.deleteRealtimeData({
          chainId: this.network.chainId,
          fromBlock: BigInt(parent.number),
        });

        this.emit("reorg", {
          blockTimestamp: parent.timestamp,
          chainId: this.network.chainId,
          blockNumber: parent.number,
        });

        this.common.logger.warn({
          service: "realtime",
          msg: `Detected reorg with common ancestor ${parent.number} (network=${this.network.name})`,
        });

        return;
      }
    }

    throw new Error(
      "Invariant violated: Unable to find common ancestor block in local chain.",
    );
  };

  /**
   * Check if deep re-org occured by comparing remote "finalized" block to local.
   */
  private validateFinalizedBlock = async () => {
    const remoteFinalizedBlock = await this._eth_getBlockByNumber(
      this.finalizedBlock.number,
    );

    if (remoteFinalizedBlock.hash !== this.finalizedBlock.hash) {
      const msg = `Detected unrecoverable reorg at block ${this.finalizedBlock.number} with local hash ${this.finalizedBlock.hash} and remote hash ${remoteFinalizedBlock.hash} (network=${this.network.name})`;
      this.common.logger.warn({ service: "realtime", msg });

      this.emit("fatal", new Error(msg));

      this.blocks = [];
      this.logs = [];

      this.finalizedBlock = realtimeBlockToLightBlock(remoteFinalizedBlock);

      return true;
    }

    this.common.logger.trace({
      service: "realtime",
      msg: `Confirmed local hash matches remote hash at finalized block number ${this.finalizedBlock.number} (network=${this.network.name})`,
    });

    return false;
  };

  /**
   * Check to see if re-requesting logs that we have locally will return a different result.
   * If this occurs, treat it as a reorg.
   */
  private validateLogs = async (newFinalizedBlock: LightBlock) => {
    this.common.logger.debug({
      service: "realtime",
      msg: `Validating local chain from block ${
        this.finalizedBlock.number + 1
      } to ${newFinalizedBlock.number} (network=${this.network.name})`,
    });

    const _logs = await this._eth_getLogs({
      fromBlock: numberToHex(this.finalizedBlock.number + 1),
      toBlock: numberToHex(newFinalizedBlock.number),
    });
    const logs = sortLogs(_logs);

    const matchedLogs = await this.getMatchedLogs(
      logs,
      BigInt(newFinalizedBlock.number),
      false,
    );

    const localLogs = this.logs.filter(
      (log) => log.blockNumber <= newFinalizedBlock.number,
    );

    // Evict local logs and blocks, emit reorg.
    const handleLogsInconsistency = async (
      localSafeBlockNumber: number | undefined,
    ) => {
      let commonAncestor: LightBlock;

      if (localSafeBlockNumber === undefined) {
        commonAncestor = this.finalizedBlock;
      } else {
        commonAncestor =
          this.blocks.findLast((b) => b.number <= localSafeBlockNumber) ??
          this.finalizedBlock;
      }

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

      this.emit("reorg", {
        blockTimestamp: commonAncestor.timestamp,
        chainId: this.network.chainId,
        blockNumber: commonAncestor.number,
      });

      this.common.logger.warn({
        service: "realtime",
        msg: `Detected invalid logs returned by the RPC starting at block ${commonAncestor.number} (network=${this.network.name})`,
      });
    };

    let i = 0;
    for (; i < localLogs.length && i < matchedLogs.length; i++) {
      const lightMatchedLog = realtimeLogToLightLog(matchedLogs[i]);
      if (
        lightMatchedLog.blockHash !== localLogs[i].blockHash ||
        lightMatchedLog.logIndex !== localLogs[i].logIndex
      ) {
        await handleLogsInconsistency(localLogs[i].blockNumber - 1);
        return true;
      }
    }

    if (localLogs.length !== matchedLogs.length) {
      await handleLogsInconsistency(
        localLogs.length === 0
          ? undefined
          : localLogs[localLogs.length - 1].blockNumber - 1,
      );
      return true;
    }

    this.common.logger.debug({
      service: "realtime",
      msg: `No log incosistencies found for blocks from ${
        this.finalizedBlock.number + 1
      } to ${newFinalizedBlock.number} (network=${this.network.name})`,
    });

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
      .then((_block) => {
        if (!_block)
          throw new BlockNotFoundError({
            blockNumber: block as any,
          });
        return _block as RealtimeBlock;
      });

  /**
   * Helper function for "eth_getLogs" rpc request.
   *
   * Note: Consider handling different error types and retry the request if applicable.
   */
  private _eth_getLogs = async (params: {
    fromBlock: Hex;
    toBlock: Hex;
  }): Promise<RealtimeLog[]> => {
    const _params: GetLogsRetryHelperParameters["params"] = [
      {
        fromBlock: params.fromBlock,
        toBlock: params.toBlock,
        address: this.address,
        topics: [this.eventSelectors],
      },
    ];

    try {
      return await this.requestQueue
        .request({
          method: "eth_getLogs",
          params: _params,
        })
        .then((l) => l as RealtimeLog[]);
    } catch (err) {
      const getLogsErrorResponse = getLogsRetryHelper({
        params: _params,
        error: err as RpcError,
      });

      if (!getLogsErrorResponse.shouldRetry) throw err;

      this.common.logger.debug({
        service: "historical",
        msg: `eth_getLogs request failed, retrying with ranges: [${getLogsErrorResponse.ranges
          .map(
            ({ fromBlock, toBlock }) =>
              `[${hexToBigInt(fromBlock).toString()}, ${hexToBigInt(
                toBlock,
              ).toString()}]`,
          )
          .join(", ")}].`,
      });

      return Promise.all(
        getLogsErrorResponse.ranges.map(({ fromBlock, toBlock }) =>
          this._eth_getLogs({
            fromBlock,
            toBlock,
          }),
        ),
      ).then((l) => l.flat());
    }
  };

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
