import type { Common } from "@/Ponder.js";
import type { Network } from "@/config/networks.js";
import {
  type Source,
  sourceIsFactory,
  sourceIsLogFilter,
} from "@/config/sources.js";
import type { SyncStore } from "@/sync-store/store.js";
import { type Checkpoint, maxCheckpoint } from "@/utils/checkpoint.js";
import { poll } from "@/utils/poll.js";
import { type Queue, createQueue } from "@/utils/queue.js";
import { range } from "@/utils/range.js";
import Emittery from "emittery";
import {
  BlockNotFoundError,
  type BlockTag,
  type Hex,
  type RpcBlock,
  type RpcLog,
  hexToBigInt,
  hexToNumber,
  numberToHex,
  zeroHash,
} from "viem";
import { isMatchedLogInBloomFilter } from "./bloom.js";
import { filterLogs } from "./filter.js";
import { type LightBlock, rpcBlockToLightBlock } from "./format.js";

type RealtimeSyncEvents = {
  realtimeCheckpoint: Checkpoint;
  finalityCheckpoint: Checkpoint;
  shallowReorg: Checkpoint;
  deepReorg: { detectedAtBlockNumber: number; minimumDepth: number };
  error: Error;
};

type RealtimeBlock = RpcBlock<Exclude<BlockTag, "pending">, true>;
type RealtimeSyncQueue = Queue<RealtimeBlock>;

export class RealtimeSyncService extends Emittery<RealtimeSyncEvents> {
  private common: Common;
  private syncStore: SyncStore;
  private network: Network;
  private sources: Source[];

  // Queue of unprocessed blocks.
  private queue: RealtimeSyncQueue;
  // Block number of the current finalized block.
  private finalizedBlockNumber: number | undefined = undefined;
  // Local representation of the unfinalized portion of the chain.
  private blocks: LightBlock[] = [];
  // Function to stop polling for new blocks.
  private unpoll?: () => any | Promise<any>;

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

    this.queue = this.buildQueue();
  }

  setup = async () => {
    // Initialize state variables. Required when restarting the service.
    this.blocks = [];

    // Fetch the latest block, and remote chain Id for the network.
    let latestBlock: RealtimeBlock;
    let rpcChainId: number;
    try {
      [latestBlock, rpcChainId] = await Promise.all([
        this.network.requestQueue
          .request(
            {
              method: "eth_getBlockByNumber",
              params: ["latest", true],
            },
            "latest",
          )
          .then((block) => {
            if (block === null)
              throw new BlockNotFoundError({
                blockHash: undefined,
                blockNumber: undefined,
              });

            return block as RealtimeBlock;
          }),
        this.network.requestQueue
          .request({ method: "eth_chainId" }, "latest")
          .then(hexToNumber),
      ]);
    } catch (error_) {
      const error = error_ as Error;
      error.stack = undefined;
      this.common.logger.error({
        service: "historical",
        msg: `Realtime sync setup failed (network=${
          this.network.name
        }, error=${`${error.name}: ${error.message}`})`,
        error,
      });
      throw error_;
    }
    const latestBlockNumber = hexToNumber(latestBlock.number);

    if (rpcChainId !== this.network.chainId)
      this.common.logger.warn({
        service: "realtime",
        msg: `Remote chain ID (${rpcChainId}) does not match configured chain ID (${this.network.chainId}) for network "${this.network.name}"`,
      });

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
    // NOTE: why don't we use the parameter "finalized"?
    const finalizedBlockNumber =
      latestBlockNumber - this.network.finalityBlockCount < 0
        ? undefined
        : latestBlockNumber - this.network.finalityBlockCount;
    this.finalizedBlockNumber = finalizedBlockNumber;

    // Add the latest block to the unfinalized block queue.
    // The queue won't start immediately; see syncUnfinalizedData for details.
    const priority = Number.MAX_SAFE_INTEGER - latestBlockNumber;
    this.queue.addTask(latestBlock!, { priority });

    return { latestBlockNumber, finalizedBlockNumber };
  };

  start = async () => {
    // If an endBlock is specified for every event source on this network, and the
    // latest end blcock is less than the finalized block number, we can stop here.
    // The service won't poll for new blocks and won't emit any events.
    const endBlocks = this.sources.map((f) => f.endBlock);
    if (
      this.finalizedBlockNumber !== undefined &&
      endBlocks.every(
        (endBlock) =>
          endBlock !== undefined && endBlock < this.finalizedBlockNumber!,
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

    // If the latest block was not added to the queue, setup was not completed successfully.
    if (this.queue.size === 0) {
      throw new Error(
        "Unable to start. Must call setup() method before start().",
      );
    }

    // Fetch the block at the finalized block number.
    let finalizedBlock: RealtimeBlock;
    try {
      const block = await this.network.requestQueue.request(
        {
          method: "eth_getBlockByNumber",
          params: ["finalized", true],
        },
        "latest",
      );

      if (block === null)
        throw new BlockNotFoundError({
          blockHash: undefined,
          blockNumber: undefined,
        });

      finalizedBlock = block as RealtimeBlock;
    } catch (error_) {
      const error = error_ as Error;
      if (error_ === undefined) return;
      error.stack = undefined;
      this.common.logger.error({
        service: "historical",
        msg: `Realtime sync failed fetching finalized block (network=${
          this.network.name
        }, error=${`${error.name}: ${error.message}`})`,
        error,
      });

      this.emit("error", error);
      return;
    }

    this.common.logger.info({
      service: "realtime",
      msg: `Fetched finalized block at ${hexToNumber(
        finalizedBlock.number,
      )} (network=${this.network.name})`,
    });

    // Add the finalized block as the first element of the list of unfinalized blocks.
    this.blocks.push(rpcBlockToLightBlock(finalizedBlock));

    // The latest block was already added to the unfinalized block queue during setup(),
    // so here all we need to do is start the queue.
    this.queue.start();

    // Add an empty task the queue (the worker will fetch the latest block).
    // TODO: optimize latency here using filters or subscriptions.
    this.unpoll = poll(() => this.addNewLatestBlock(), {
      emitOnBegin: false,
      interval: this.network.pollingInterval,
    });
  };

  kill = async () => {
    await this.unpoll?.();

    this.queue.pause();
    this.queue.clear();
    await this.onIdle();

    this.common.logger.debug({
      service: "realtime",
      msg: `Killed realtime sync service (network=${this.network.name})`,
    });
  };

  onIdle = async () => {
    await this.queue.onIdle();
  };

  // This method is only public for to support the tests.
  addNewLatestBlock = async () => {
    try {
      const block = await this.network.requestQueue
        .request(
          {
            method: "eth_getBlockByNumber",
            params: ["latest", true],
          },
          null,
        )
        .then((block) => {
          if (block === null)
            throw new BlockNotFoundError({
              blockHash: undefined,
              blockNumber: undefined,
            });

          return block as RealtimeBlock;
        });
      const priority = Number.MAX_SAFE_INTEGER - hexToNumber(block.number);
      this.queue.addTask(block, { priority });
    } catch (error_) {
      if (error_ === undefined) return;
      const error = error_ as Error;
      error.stack = undefined;
      this.common.logger.error({
        service: "historical",
        msg: `Realtime sync failed fetching latest block (network=${
          this.network.name
        }, error=${`${error.name}: ${error.message}`})`,
        error,
      });
      this.emit("error", error);
    }
  };

  private buildQueue = () =>
    createQueue<RealtimeBlock>({
      worker: async ({ task }) => {
        try {
          await this.blockTaskWorker({ block: task });
        } catch (error_) {
          if (error_ === undefined) return;
          const error = error_ as Error;
          error.stack = undefined;
          this.common.logger.error({
            service: "historical",
            msg: `Realtime block task failed(network=${
              this.network.name
            }, error=${`${error.name}: ${error.message}`})`,
            error,
          });
          this.emit("error", error);
        }
      },
      options: { concurrency: 1, autoStart: false },
    });

  private blockTaskWorker = async ({
    block,
  }: {
    block: RealtimeBlock;
  }) => {
    const previousHeadBlock = this.blocks[this.blocks.length - 1];

    // If no block is passed, fetch the latest block.
    const newBlockWithTransactions = block;
    const newBlock = rpcBlockToLightBlock(newBlockWithTransactions);

    // 1) We already saw and handled this block. No-op.
    if (this.blocks.find((b) => b.hash === newBlock.hash)) {
      this.common.logger.trace({
        service: "realtime",
        msg: `Already processed block at ${newBlock.number} (network=${this.network.name})`,
      });
      return;
    }

    // 2) This is the new head block (happy path). Yay!
    if (
      newBlock.number === previousHeadBlock.number + 1 &&
      newBlock.parentHash === previousHeadBlock.hash
    ) {
      this.common.logger.debug({
        service: "realtime",
        msg: `Started processing new head block ${newBlock.number} (network=${this.network.name})`,
      });

      let logs: RpcLog[];
      let matchedLogs: RpcLog[];

      if (!this.sources.some(sourceIsFactory)) {
        // If there are no factory contracts, we can attempt to skip calling eth_getLogs by
        // checking if the block logsBloom matches any of the log filters.
        const doesBlockHaveLogFilterLogs = isMatchedLogInBloomFilter({
          bloom: newBlockWithTransactions.logsBloom!,
          logFilters: this.sources.map((s) => s.criteria),
        });

        if (!doesBlockHaveLogFilterLogs) {
          this.common.logger.debug({
            service: "realtime",
            msg: `No logs found in block ${newBlock.number} using bloom filter (network=${this.network.name})`,
          });
          logs = [];
          matchedLogs = [];
        } else {
          // Block (maybe) contains logs matching the registered log filters.
          logs = await this.network.requestQueue.request(
            {
              method: "eth_getLogs",
              params: [{ blockHash: newBlock.hash }],
            },
            null,
          );

          matchedLogs = filterLogs({
            logs,
            logFilters: this.sources.map((s) => s.criteria),
          });
        }
      } else {
        // The app has factory contracts.
        // Don't attempt to skip calling eth_getLogs, just call it every time.
        logs = await this.network.requestQueue.request(
          {
            method: "eth_getLogs",
            params: [{ blockHash: newBlock.hash }],
          },
          null,
        );

        // Find and insert any new child contracts.
        await Promise.all(
          this.sources.filter(sourceIsFactory).map(async (factory) => {
            const matchedFactoryLogs = filterLogs({
              logs,
              logFilters: [
                {
                  address: factory.criteria.address,
                  topics: [factory.criteria.eventSelector],
                },
              ],
            });

            await this.syncStore.insertFactoryChildAddressLogs({
              chainId: this.network.chainId,
              logs: matchedFactoryLogs,
            });
          }),
        );

        // Find any logs matching log filters or child contract filters.
        // NOTE: It might make sense to just insert all logs rather than introduce
        // a potentially slow DB operation here. It's a tradeoff between sync
        // latency and database growth.
        const factoryLogFilters = await Promise.all(
          this.sources.filter(sourceIsFactory).map(async (factory) => {
            const iterator = this.syncStore.getFactoryChildAddresses({
              chainId: this.network.chainId,
              factory: factory.criteria,
              upToBlockNumber: hexToBigInt(block.number),
            });
            const childContractAddresses: Hex[] = [];
            for await (const batch of iterator) {
              childContractAddresses.push(...batch);
            }
            return {
              address: childContractAddresses,
              topics: factory.criteria.topics,
            };
          }),
        );

        matchedLogs = filterLogs({
          logs,
          logFilters: [
            ...this.sources.filter(sourceIsLogFilter).map((l) => l.criteria),
            ...factoryLogFilters,
          ],
        });
      }

      const matchedLogCount = matchedLogs.length;
      const matchedLogCountText =
        matchedLogCount === 1
          ? "1 matched log"
          : `${matchedLogCount} matched logs`;

      this.common.logger.debug({
        service: "realtime",
        msg: `Got ${logs.length} total and ${matchedLogCountText} in block ${newBlock.number} (network=${this.network.name})`,
      });

      // If there are indeed any matched logs, insert them into the store.
      if (matchedLogCount > 0) {
        // Filter transactions down to those that are required by the matched logs.
        const requiredTransactionHashes = new Set(
          matchedLogs.map((l) => l.transactionHash),
        );
        const filteredTransactions =
          newBlockWithTransactions.transactions.filter((t) =>
            requiredTransactionHashes.has(t.hash),
          );

        // TODO: Maybe rename or at least document behavior
        await this.syncStore.insertRealtimeBlock({
          chainId: this.network.chainId,
          block: newBlockWithTransactions,
          transactions: filteredTransactions,
          logs: matchedLogs,
        });

        this.common.logger.info({
          service: "realtime",
          msg: `Synced ${matchedLogCountText} from block ${newBlock.number} (network=${this.network.name})`,
        });
      }

      this.emit("realtimeCheckpoint", {
        blockTimestamp: hexToNumber(newBlockWithTransactions.timestamp),
        chainId: this.network.chainId,
        blockNumber: hexToNumber(newBlockWithTransactions.number),
      });

      // Add this block the local chain.
      this.blocks.push(newBlock);

      this.common.metrics.ponder_realtime_latest_block_number.set(
        { network: this.network.name },
        newBlock.number,
      );
      this.common.metrics.ponder_realtime_latest_block_timestamp.set(
        { network: this.network.name },
        newBlock.timestamp,
      );

      // If this block moves the finality checkpoint, remove now-finalized blocks from the local chain
      // and mark data as cached in the store.
      if (
        newBlock.number >
        (this.finalizedBlockNumber ?? 0) + 2 * this.network.finalityBlockCount
      ) {
        const newFinalizedBlock = this.blocks.find(
          (block) =>
            block.number ===
            (this.finalizedBlockNumber ?? 0) + this.network.finalityBlockCount,
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
          logFilters: this.sources
            .filter(sourceIsLogFilter)
            .map((l) => l.criteria),
          factories: this.sources
            .filter(sourceIsFactory)
            .map((f) => f.criteria),
          interval: {
            startBlock: BigInt((this.finalizedBlockNumber ?? 0) + 1),
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

    // 3) At least one block is missing.
    // Note that this is the happy path for the first task after setup, because
    // the unfinalized block range must be fetched (eg 32 blocks on mainnet).
    if (newBlock.number > previousHeadBlock.number + 1) {
      const missingBlockNumbers = range(
        previousHeadBlock.number + 1,
        newBlock.number,
      );

      // Fetch all missing blocks
      const missingBlocks = await Promise.all(
        missingBlockNumbers.map(async (number) => {
          return this.network.requestQueue
            .request(
              {
                method: "eth_getBlockByNumber",
                params: [numberToHex(number), true],
              },
              null,
            )
            .then((block) => {
              if (block === null)
                throw new BlockNotFoundError({
                  blockHash: undefined,
                  blockNumber: undefined,
                });
              return block as RealtimeBlock;
            });
        }),
      );

      // Add blocks to the queue from oldest to newest. Include the current block.
      for (const block of [...missingBlocks, newBlockWithTransactions]) {
        const priority = Number.MAX_SAFE_INTEGER - hexToNumber(block.number);
        this.queue.addTask(block, { priority });
      }

      this.common.logger.debug({
        service: "realtime",
        msg: `Fetched missing blocks [${missingBlockNumbers[0]}, ${
          missingBlockNumbers[missingBlockNumbers.length - 1]
        }] (network=${this.network.name})`,
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

    while (canonicalBlock.number > (this.finalizedBlockNumber ?? -1)) {
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
          this.queue.addTask(block, { priority });
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

      // If we reached the end of the chain, break
      if (canonicalBlock.parentHash === zeroHash) break;

      // If the parent block is not present in our local chain, keep traversing up the canonical chain.
      const parentBlock_ = await this.network.requestQueue
        .request(
          {
            method: "eth_getBlockByHash",
            params: [canonicalBlock.parentHash, true],
          },
          null,
        )
        .then((block) => {
          if (block === null)
            throw new BlockNotFoundError({
              blockHash: undefined,
              blockNumber: undefined,
            });

          return block as RealtimeBlock;
        });

      canonicalBlocksWithTransactions.unshift(parentBlock_ as RealtimeBlock);
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
}
