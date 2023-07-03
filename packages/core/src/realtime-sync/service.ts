import Emittery from "emittery";
import pLimit from "p-limit";
import { hexToNumber, numberToHex } from "viem";

import type { LogFilter } from "@/config/logFilters";
import type { Network } from "@/config/networks";
import { QueueError } from "@/errors/queue";
import type { EventStore } from "@/event-store/store";
import { Resources } from "@/Ponder";
import { poll } from "@/utils/poll";
import { type Queue, createQueue } from "@/utils/queue";
import { range } from "@/utils/range";
import { startClock } from "@/utils/timer";

import { isMatchedLogInBloomFilter } from "./bloom";
import { filterLogs } from "./filter";
import {
  type BlockWithTransactions,
  type LightBlock,
  rpcBlockToLightBlock,
} from "./format";

type RealtimeSyncEvents = {
  realtimeCheckpoint: { timestamp: number };
  finalityCheckpoint: { timestamp: number };
  shallowReorg: { commonAncestorTimestamp: number };
  deepReorg: { detectedAtBlockNumber: number; minimumDepth: number };
  error: { error: Error };
};

type RealtimeSyncStats = {
  // Block number -> log filter name -> matched log count.
  // Note that finalized blocks are removed from this object.
  blocks: Record<
    number,
    {
      bloom: {
        hit: boolean;
        falsePositive: boolean;
      };
      matchedLogCount: number;
    }
  >;
};

type RealtimeBlockTask = BlockWithTransactions;
type RealtimeSyncQueue = Queue<RealtimeBlockTask>;

export class RealtimeSyncService extends Emittery<RealtimeSyncEvents> {
  private resources: Resources;
  private eventStore: EventStore;
  private logFilters: LogFilter[];
  private network: Network;

  stats: RealtimeSyncStats;

  // Queue of unprocessed blocks.
  private queue: RealtimeSyncQueue;
  // Block number of the current finalized block.
  private finalizedBlockNumber = 0;
  // Local representation of the unfinalized portion of the chain.
  private blocks: LightBlock[] = [];
  // Function to stop polling for new blocks.
  private unpoll?: () => any | Promise<any>;

  constructor({
    resources,
    eventStore,
    logFilters,
    network,
  }: {
    resources: Resources;
    eventStore: EventStore;
    logFilters: LogFilter[];
    network: Network;
  }) {
    super();

    this.resources = resources;
    this.eventStore = eventStore;
    this.logFilters = logFilters;
    this.network = network;

    this.queue = this.buildQueue();
    this.stats = { blocks: {} };
  }

  setup = async () => {
    // Fetch the latest block for the network.
    const latestBlock = await this.getLatestBlock();

    this.resources.logger.info({
      service: "realtime",
      msg: `Fetched latest block at ${hexToNumber(
        latestBlock.number
      )} (network=${this.network.name})`,
    });

    this.resources.metrics.ponder_realtime_is_connected.set(
      { network: this.network.name },
      1
    );

    // Set the finalized block number according to the network's finality threshold.
    // If the finality block count is greater than the latest block number, set to zero.
    const finalizedBlockNumber = Math.max(
      0,
      hexToNumber(latestBlock.number) - this.network.finalityBlockCount
    );
    this.finalizedBlockNumber = finalizedBlockNumber;

    // Add the latest block to the unfinalized block queue.
    // The queue won't start immediately; see syncUnfinalizedData for details.
    const priority = Number.MAX_SAFE_INTEGER - hexToNumber(latestBlock.number);
    this.queue.addTask(latestBlock, { priority });

    return { finalizedBlockNumber };
  };

  start = async () => {
    // If an endBlock is specified for every log filter on this network, and the
    // latest end blcock is less than the finalized block number, we can stop here.
    // The service won't poll for new blocks and won't emit any events.
    const endBlocks = this.logFilters.map((f) => f.filter.endBlock);
    if (
      endBlocks.every(
        (endBlock) =>
          endBlock !== undefined && endBlock < this.finalizedBlockNumber
      )
    ) {
      this.resources.logger.warn({
        service: "realtime",
        msg: `No realtime log filters found (network=${this.network.name})`,
      });
      this.resources.metrics.ponder_realtime_is_connected.set(
        { network: this.network.name },
        0
      );
      return;
    }

    // If the latest block was not added to the queue, setup was not completed successfully.
    if (this.queue.size === 0) {
      throw new Error(
        `Unable to start. Must call setup() method before start().`
      );
    }

    // Fetch the block at the finalized block number.
    const stopClock = startClock();
    const finalizedBlock = await this.network.client.request({
      method: "eth_getBlockByNumber",
      params: [numberToHex(this.finalizedBlockNumber), false],
    });
    if (!finalizedBlock) throw new Error(`Unable to fetch finalized block`);
    this.resources.metrics.ponder_realtime_rpc_request_duration.observe(
      {
        method: "eth_getBlockByNumber",
        network: this.network.name,
      },
      stopClock()
    );

    this.resources.logger.info({
      service: "realtime",
      msg: `Fetched finalized block at ${hexToNumber(
        finalizedBlock.number!
      )} (network=${this.network.name})`,
    });

    // Add the finalized block as the first element of the list of unfinalized blocks.
    this.blocks.push(rpcBlockToLightBlock(finalizedBlock));

    // The latest block was already added to the unfinalized block queue during setup(),
    // so here all we need to do is start the queue.
    this.queue.start();

    // Add an empty task the queue (the worker will fetch the latest block).
    // TODO: optimistically optimize latency here using filters or subscriptions.
    this.unpoll = poll(
      async () => {
        await this.addNewLatestBlock();
      },
      {
        emitOnBegin: false,
        interval: this.network.pollingInterval,
      }
    );
  };

  kill = async () => {
    this.unpoll?.();
    this.queue.pause();
    this.queue.clear();
    // TODO: Figure out if it's necessary to wait for the queue to be idle before killing it.
    // await this.onIdle();

    this.resources.logger.debug({
      service: "realtime",
      msg: `Killed realtime sync service (network=${this.network.name})`,
    });
  };

  onIdle = async () => {
    await this.queue.onIdle();
  };

  private getLatestBlock = async () => {
    // Fetch the latest block for the network.
    const stopClock = startClock();
    const latestBlock_ = await this.network.client.request({
      method: "eth_getBlockByNumber",
      params: ["latest", true],
    });
    if (!latestBlock_) throw new Error(`Unable to fetch latest block`);
    this.resources.metrics.ponder_realtime_rpc_request_duration.observe(
      {
        method: "eth_getBlockByNumber",
        network: this.network.name,
      },
      stopClock()
    );
    return latestBlock_ as BlockWithTransactions;
  };

  addNewLatestBlock = async () => {
    const block = await this.getLatestBlock();
    const priority = Number.MAX_SAFE_INTEGER - hexToNumber(block.number);
    this.queue.addTask(block, { priority });
  };

  private buildQueue = () => {
    const queue = createQueue<RealtimeBlockTask>({
      worker: async ({ task }: { task: RealtimeBlockTask }) => {
        await this.blockTaskWorker(task);
      },
      options: { concurrency: 1, autoStart: false },
      onError: ({ error, task }) => {
        const queueError = new QueueError({
          queueName: "Realtime sync queue",
          task: {
            hash: task.hash,
            parentHash: task.parentHash,
            number: task.number,
            timestamp: task.timestamp,
            transactionCount: task.transactions.length,
          },
          cause: error,
        });
        this.emit("error", { error: queueError });

        // Default to a retry (uses the retry options passed to the queue).
        // queue.addTask(task, { retry: true });
      },
    });

    return queue;
  };

  private blockTaskWorker = async (block: BlockWithTransactions) => {
    const previousHeadBlock = this.blocks[this.blocks.length - 1];

    // If no block is passed, fetch the latest block.
    const newBlockWithTransactions = block;
    const newBlock = rpcBlockToLightBlock(newBlockWithTransactions);

    // 1) We already saw and handled this block. No-op.
    if (this.blocks.find((b) => b.hash === newBlock.hash)) {
      this.resources.logger.debug({
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
      // First, check if the new block _might_ contain any logs that match the registered filters.
      const isMatchedLogPresentInBlock = isMatchedLogInBloomFilter({
        bloom: newBlockWithTransactions.logsBloom!,
        logFilters: this.logFilters.map((l) => l.filter),
      });

      let matchedLogCount = 0;

      if (isMatchedLogPresentInBlock) {
        // If there's a potential match, fetch the logs from the block.
        const stopClock = startClock();
        const logs = await this.network.client.request({
          method: "eth_getLogs",
          params: [
            {
              blockHash: newBlock.hash,
            },
          ],
        });
        this.resources.metrics.ponder_realtime_rpc_request_duration.observe(
          {
            method: "eth_getLogs",
            network: this.network.name,
          },
          stopClock()
        );

        // Filter logs down to those that actually match the registered filters.
        const filteredLogs = filterLogs({
          logs,
          logFilters: this.logFilters.map((l) => l.filter),
        });
        matchedLogCount = filteredLogs.length;

        // Filter transactions down to those that are required by the matched logs.
        const requiredTransactionHashes = new Set(
          filteredLogs.map((l) => l.transactionHash)
        );
        const filteredTransactions =
          newBlockWithTransactions.transactions.filter((t) =>
            requiredTransactionHashes.has(t.hash)
          );

        // If there are indeed any matched logs, insert them into the store.
        if (filteredLogs.length > 0) {
          await this.eventStore.insertUnfinalizedBlock({
            chainId: this.network.chainId,
            block: newBlockWithTransactions,
            transactions: filteredTransactions,
            logs: filteredLogs,
          });
        }
      }

      this.emit("realtimeCheckpoint", {
        timestamp: hexToNumber(newBlockWithTransactions.timestamp),
      });

      // Add this block the local chain.
      this.blocks.push(newBlock);

      this.resources.metrics.ponder_realtime_latest_block_number.set(
        { network: this.network.name },
        newBlock.number
      );
      this.resources.metrics.ponder_realtime_latest_block_timestamp.set(
        { network: this.network.name },
        newBlock.timestamp
      );

      this.resources.logger.debug({
        service: "realtime",
        msg: `Processed new head block at ${newBlock.number} (network=${this.network.name})`,
      });

      if (matchedLogCount > 0) {
        this.resources.logger.info({
          service: "realtime",
          msg: `Found ${
            matchedLogCount === 1
              ? "1 matched log"
              : `${matchedLogCount} matched logs`
          } in new head block ${newBlock.number} (network=${
            this.network.name
          })`,
        });
      }

      this.stats.blocks[newBlock.number] = {
        bloom: {
          hit: isMatchedLogPresentInBlock,
          falsePositive: isMatchedLogPresentInBlock && matchedLogCount === 0,
        },
        matchedLogCount,
      };

      // If this block moves the finality checkpoint, remove now-finalized blocks from the local chain
      // and mark data as finalized in the store.
      if (
        newBlock.number >
        this.finalizedBlockNumber + 2 * this.network.finalityBlockCount
      ) {
        const newFinalizedBlock = this.blocks.find(
          (block) =>
            block.number ===
            this.finalizedBlockNumber + this.network.finalityBlockCount
        )!;

        // Remove now-finalized blocks from the local chain (except for the block at newFinalizedBlockNumber).
        this.blocks = this.blocks.filter(
          (block) => block.number >= newFinalizedBlock.number
        );

        // Clean up metrics for now-finalized blocks.
        for (const blockNumber in this.stats.blocks) {
          if (Number(blockNumber) < newFinalizedBlock.number) {
            delete this.stats.blocks[blockNumber];
          }
        }

        await this.eventStore.finalizeData({
          chainId: this.network.chainId,
          toBlockNumber: newFinalizedBlock.number,
        });

        this.finalizedBlockNumber = newFinalizedBlock.number;

        this.emit("finalityCheckpoint", {
          timestamp: newFinalizedBlock.timestamp,
        });

        this.resources.logger.debug({
          service: "realtime",
          msg: `Updated finality checkpoint to ${newFinalizedBlock.number} (network=${this.network.name})`,
          matchedLogCount,
        });
      }

      return;
    }

    // 3) At least one block is missing. Note that this is the happy path for the first task after setup.
    if (newBlock.number > previousHeadBlock.number + 1) {
      const missingBlockNumbers = range(
        previousHeadBlock.number + 1,
        newBlock.number
      );

      // Fetch all missing blocks using a request concurrency limit of 10.
      const limit = pLimit(10);

      const missingBlockRequests = missingBlockNumbers.map((number) => {
        return limit(async () => {
          const stopClock = startClock();
          const block = await this.network.client.request({
            method: "eth_getBlockByNumber",
            params: [numberToHex(number), true],
          });
          if (!block) {
            throw new Error(`Failed to fetch block number: ${number}`);
          }
          this.resources.metrics.ponder_realtime_rpc_request_duration.observe(
            {
              method: "eth_getBlockByNumber",
              network: this.network.name,
            },
            stopClock()
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

      this.resources.logger.info({
        service: "realtime",
        msg: `Fetched unfinalized block range [${missingBlockNumbers[0]}, ${
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

    while (canonicalBlock.number > this.finalizedBlockNumber) {
      const commonAncestorBlock = this.blocks.find(
        (b) => b.hash === canonicalBlock.parentHash
      );

      // If the common ancestor block is present in our local chain, this is a short reorg.
      if (commonAncestorBlock) {
        // Remove all non-canonical blocks from the local chain.
        this.blocks = this.blocks.filter(
          (block) => block.number <= commonAncestorBlock.number
        );

        await this.eventStore.deleteUnfinalizedData({
          chainId: this.network.chainId,
          fromBlockNumber: commonAncestorBlock.number + 1,
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
          commonAncestorTimestamp: commonAncestorBlock.timestamp,
        });

        this.resources.logger.info({
          service: "realtime",
          msg: `Reconciled ${depth}-block reorg with common ancestor block ${commonAncestorBlock.number} (network=${this.network.name})`,
        });

        return;
      }

      // If the parent block is not present in our local chain, keep traversing up the canonical chain.
      const stopClock = startClock();
      const parentBlock_ = await this.network.client.request({
        method: "eth_getBlockByHash",
        params: [canonicalBlock.parentHash, true],
      });
      this.resources.metrics.ponder_realtime_rpc_request_duration.observe(
        {
          method: "eth_getBlockByHash",
          network: this.network.name,
        },
        stopClock()
      );

      if (!parentBlock_)
        throw new Error(
          `Failed to fetch parent block with hash: ${canonicalBlock.parentHash}`
        );

      canonicalBlocksWithTransactions.unshift(
        parentBlock_ as BlockWithTransactions
      );
      depth += 1;
      canonicalBlock = rpcBlockToLightBlock(parentBlock_);
    }

    // 5) If the common ancestor was not found in our local chain, this is a deep reorg.
    this.emit("deepReorg", {
      detectedAtBlockNumber: newBlock.number,
      minimumDepth: depth,
    });

    this.resources.logger.warn({
      service: "realtime",
      msg: `Unable to reconcile >${depth}-block reorg (network=${this.network.name})`,
    });
  };
}
