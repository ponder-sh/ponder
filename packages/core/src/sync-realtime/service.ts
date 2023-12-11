import Emittery from "emittery";
import pLimit from "p-limit";
import {
  type Hex,
  hexToBigInt,
  hexToNumber,
  numberToHex,
  type RpcLog,
} from "viem";

import type { Network } from "@/config/networks.js";
import {
  type Source,
  sourceIsFactory,
  sourceIsLogFilter,
} from "@/config/sources.js";
import type { Common } from "@/Ponder.js";
import type { SyncStore } from "@/sync-store/store.js";
import type { Checkpoint } from "@/utils/checkpoint.js";
import { poll } from "@/utils/poll.js";
import { createQueue, type Queue } from "@/utils/queue.js";
import { range } from "@/utils/range.js";
import { getErrorMessage, request, requestWithRetry } from "@/utils/request.js";
import { startClock } from "@/utils/timer.js";

import { isMatchedLogInBloomFilter } from "./bloom.js";
import { filterLogs } from "./filter.js";
import {
  type BlockWithTransactions,
  type LightBlock,
  rpcBlockToLightBlock,
} from "./format.js";

type RealtimeSyncEvents = {
  realtimeCheckpoint: Checkpoint;
  finalityCheckpoint: Checkpoint;
  shallowReorg: Checkpoint;
  deepReorg: { detectedAtBlockNumber: number; minimumDepth: number };
};

type RealtimeBlockTask = BlockWithTransactions;
type RealtimeSyncQueue = Queue<RealtimeBlockTask>;

export class RealtimeSyncService extends Emittery<RealtimeSyncEvents> {
  private common: Common;
  private syncStore: SyncStore;
  private network: Network;
  private sources: Source[];

  // Queue of unprocessed blocks.
  private queue: RealtimeSyncQueue;
  // Block number of the current finalized block.
  private finalizedBlockNumber = 0;
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
    const [latestBlock, rpcChainId_] = await Promise.all([
      requestWithRetry(() => this.getLatestBlock(undefined)),
      requestWithRetry(() =>
        request(this.network, { body: { method: "eth_chainId" } }),
      ),
    ]);
    const latestBlockNumber = hexToNumber(latestBlock.number);
    const rpcChainId = hexToNumber(rpcChainId_);

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
    const finalizedBlockNumber = Math.max(
      0,
      latestBlockNumber - this.network.finalityBlockCount,
    );
    this.finalizedBlockNumber = finalizedBlockNumber;

    // Add the latest block to the unfinalized block queue.
    // The queue won't start immediately; see syncUnfinalizedData for details.
    const priority = Number.MAX_SAFE_INTEGER - latestBlockNumber;
    this.queue.addTask(latestBlock, { priority });

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
      this.common.metrics.ponder_realtime_is_connected.set(
        { network: this.network.name },
        0,
      );
      return;
    }

    // If the latest block was not added to the queue, setup was not completed successfully.
    if (this.queue.size === 0) {
      throw new Error(
        `Unable to start. Must call setup() method before start().`,
      );
    }

    // Fetch the block at the finalized block number.
    const stopClock = startClock();
    const finalizedBlock = await request(this.network, {
      body: {
        method: "eth_getBlockByNumber",
        params: [numberToHex(this.finalizedBlockNumber), false],
      },
    });
    if (!finalizedBlock) throw new Error(`Unable to fetch finalized block`);
    this.common.metrics.ponder_realtime_rpc_request_duration.observe(
      { method: "eth_getBlockByNumber", network: this.network.name },
      stopClock(),
    );

    this.common.logger.info({
      service: "realtime",
      msg: `Fetched finalized block at ${hexToNumber(
        finalizedBlock.number!,
      )} (network=${this.network.name})`,
    });

    // Add the finalized block as the first element of the list of unfinalized blocks.
    this.blocks.push(rpcBlockToLightBlock(finalizedBlock));

    // The latest block was already added to the unfinalized block queue during setup(),
    // so here all we need to do is start the queue.
    this.queue.start();

    // Add an empty task the queue (the worker will fetch the latest block).
    // TODO: optimize latency here using filters or subscriptions.
    this.unpoll = poll(
      async () => {
        await this.addNewLatestBlock();
      },
      { emitOnBegin: false, interval: this.network.pollingInterval },
    );
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

  private getLatestBlock = async (signal: AbortSignal | undefined) => {
    // Fetch the latest block for the network.
    const stopClock = startClock();
    const latestBlock_ = await request(this.network, {
      body: {
        method: "eth_getBlockByNumber",
        params: ["latest", true],
      },
      fetchOptions: { signal },
    });
    if (!latestBlock_) throw new Error(`Unable to fetch latest block`);
    this.common.metrics.ponder_realtime_rpc_request_duration.observe(
      { method: "eth_getBlockByNumber", network: this.network.name },
      stopClock(),
    );
    return latestBlock_ as BlockWithTransactions;
  };

  // This method is only public for to support the tests.
  addNewLatestBlock = async (signal: AbortSignal | undefined = undefined) => {
    try {
      const block = await this.getLatestBlock(signal);
      const priority = Number.MAX_SAFE_INTEGER - hexToNumber(block.number);
      this.queue.addTask(block, { priority });
    } catch (error) {
      // Do nothing, log the error. Might consider a retry limit here after which the service should die.
      const message = getErrorMessage(error as Error);
      this.common.logger.warn({
        service: "realtime",
        msg: `Error while fetching latest block (error=${message})`,
      });
    }
  };

  private buildQueue = () => {
    const queue = createQueue<RealtimeBlockTask>({
      worker: async ({ task, signal }) => {
        await this.blockTaskWorker({ block: task, signal });
      },
      options: { concurrency: 1, autoStart: false },
      onError: ({ error, task }) => {
        const message = getErrorMessage(error);

        this.common.logger.warn({
          service: "realtime",
          msg: `Realtime sync task failed (network=${this.network.name}, error=${message})`,
          network: this.network.name,
          hash: task.hash,
          parentHash: task.parentHash,
          number: task.number,
          timestamp: task.timestamp,
        });

        // Default to a retry (uses the retry options passed to the queue).
        queue.addTask(task, { retry: true });
      },
    });

    return queue;
  };

  private blockTaskWorker = async ({
    block,
    signal,
  }: {
    block: BlockWithTransactions;
    signal: AbortSignal;
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
      newBlock.number == previousHeadBlock.number + 1 &&
      newBlock.parentHash == previousHeadBlock.hash
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
          const stopClock = startClock();
          logs = await request(this.network, {
            body: {
              method: "eth_getLogs",
              params: [{ blockHash: newBlock.hash }],
            },
            fetchOptions: { signal },
          });
          this.common.metrics.ponder_realtime_rpc_request_duration.observe(
            { method: "eth_getLogs", network: this.network.name },
            stopClock(),
          );

          matchedLogs = filterLogs({
            logs,
            logFilters: this.sources.map((s) => s.criteria),
          });
        }
      } else {
        // The app has factory contracts.
        // Don't attempt to skip calling eth_getLogs, just call it every time.
        const stopClock = startClock();
        logs = await request(this.network, {
          body: {
            method: "eth_getLogs",
            params: [{ blockHash: newBlock.hash }],
          },
          fetchOptions: { signal },
        });
        this.common.metrics.ponder_realtime_rpc_request_duration.observe(
          { method: "eth_getLogs", network: this.network.name },
          stopClock(),
        );

        // Find and insert any new child contracts.
        await Promise.all(
          this.sources.filter(sourceIsFactory).map(async (factory) => {
            const matchedFactoryLogs = filterLogs({
              logs,
              logFilters: [
                {
                  address: factory.criteria.address,
                  topics: [factory.criteria.eventSelector, null, null, null],
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
              upToBlockNumber: hexToBigInt(block.number!),
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
          logFilters: this.sources
            .filter(sourceIsLogFilter)
            .map((l) => l.criteria),
          factories: this.sources
            .filter(sourceIsFactory)
            .map((f) => f.criteria),
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

    // 3) At least one block is missing.
    // Note that this is the happy path for the first task after setup, because
    // the unfinalized block range must be fetched (eg 32 blocks on mainnet).
    if (newBlock.number > previousHeadBlock.number + 1) {
      const missingBlockNumbers = range(
        previousHeadBlock.number + 1,
        newBlock.number,
      );

      // Fetch all missing blocks using a request concurrency limit of 10.
      const limit = pLimit(10);

      const missingBlockRequests = missingBlockNumbers.map((number) => {
        return limit(async () => {
          const stopClock = startClock();
          const block = await request(this.network, {
            body: {
              method: "eth_getBlockByNumber",
              params: [numberToHex(number), true],
            },
            fetchOptions: { signal },
          });
          if (!block) {
            throw new Error(`Failed to fetch block number: ${number}`);
          }
          this.common.metrics.ponder_realtime_rpc_request_duration.observe(
            {
              method: "eth_getBlockByNumber",
              network: this.network.name,
            },
            stopClock(),
          );
          return block as BlockWithTransactions;
        });
      });

      const missingBlocks = await Promise.all(missingBlockRequests);

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
          this.queue.addTask(block, { priority });
        }

        // Also add a new latest block, so we don't have to wait for the next poll to
        // start fetching any newer blocks on the canonical chain.
        await this.addNewLatestBlock(signal);
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
      const stopClock = startClock();
      const parentBlock_ = await request(this.network, {
        body: {
          method: "eth_getBlockByHash",
          params: [canonicalBlock.parentHash, true],
        },
        fetchOptions: { signal },
      });
      this.common.metrics.ponder_realtime_rpc_request_duration.observe(
        {
          method: "eth_getBlockByHash",
          network: this.network.name,
        },
        stopClock(),
      );

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
}
