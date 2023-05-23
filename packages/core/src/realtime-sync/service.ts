import Emittery from "emittery";
import pLimit from "p-limit";
import { hexToNumber, numberToHex } from "viem";

import { type Queue, createQueue } from "@/common/queue";
import type { LogFilter } from "@/config/logFilters";
import type { Network } from "@/config/networks";
import type { EventStore } from "@/event-store/store";
import { poll } from "@/utils/poll";
import { range } from "@/utils/range";

import {
  type BlockWithTransactions,
  type LightBlock,
  rpcBlockToLightBlock,
} from "./format";

type BlockTask = {
  block: BlockWithTransactions;
};

type RealtimeSyncQueue = Queue<BlockTask>;

type RealtimeSyncMetrics = {
  startedAt?: [number, number];
  duration?: number;
  logFilters: Record<
    string,
    {
      totalBlockCount: number;
      cachedBlockCount: number;

      logTaskStartedCount: number;
      logTaskErrorCount: number;
      logTaskCompletedCount: number;

      blockTaskStartedCount: number;
      blockTaskErrorCount: number;
      blockTaskCompletedCount: number;
    }
  >;
};

type RealtimeSyncEvents = {
  newBlock: undefined;
  finalityCheckpoint: { newFinalizedBlockNumber: number };
  shallowReorg: { commonAncestorBlockNumber: number; depth: number };
  deepReorg: { minimumDepth: number };
};

export class RealtimeSyncService extends Emittery<RealtimeSyncEvents> {
  private store: EventStore;
  private logFilters: LogFilter[];
  private network: Network;

  metrics: RealtimeSyncMetrics;

  // Queue of unprocessed blocks.
  private queue: RealtimeSyncQueue;
  // Block number of the current finalized block.
  private finalizedBlockNumber = 0;
  // Local representation of the unfinalized portion of the chain.
  private blocks: LightBlock[] = [];
  // Function to stop polling for new blocks.
  private unwatch?: () => any | Promise<any>;

  constructor({
    store,
    logFilters,
    network,
  }: {
    store: EventStore;
    logFilters: LogFilter[];
    network: Network;
  }) {
    super();

    this.store = store;
    this.logFilters = logFilters;
    this.network = network;

    this.queue = this.buildQueue();
    this.metrics = { logFilters: {} };

    logFilters.forEach((logFilter) => {
      this.metrics.logFilters[logFilter.name] = {
        totalBlockCount: 0,
        cachedBlockCount: 0,
        logTaskStartedCount: 0,
        logTaskErrorCount: 0,
        logTaskCompletedCount: 0,
        blockTaskStartedCount: 0,
        blockTaskErrorCount: 0,
        blockTaskCompletedCount: 0,
      };
    });
  }

  setup = async () => {
    // Fetch the latest block for the network.
    const latestBlock = await this.getLatestBlock();

    // Set the finalized block number according to the network's finality threshold.
    // If the finality block count is greater than the latest block number, set to zero.
    const finalizedBlockNumber = Math.max(
      0,
      hexToNumber(latestBlock.number) - this.network.finalityBlockCount
    );
    this.finalizedBlockNumber = finalizedBlockNumber;

    // Add the latest block to the unfinalized block queue.
    // The queue won't start immediately; see syncUnfinalizedData for details.
    this.queue.addTask({ block: latestBlock }, { front: true });

    return { finalizedBlockNumber };
  };

  start = async () => {
    // If the latest block was not added to the queue, setup was not completed successfully.
    if (this.queue.size === 0) {
      throw new Error(
        `Unable to start. Must call setup() method before start().`
      );
    }

    // Fetch the block at the finalized block number.
    const finalizedBlock = await this.network.client.request({
      method: "eth_getBlockByNumber",
      params: [numberToHex(this.finalizedBlockNumber), false],
    });
    if (!finalizedBlock) throw new Error(`Unable to fetch finalized block`);

    // Add the finalized block as the first element of the list of unfinalized blocks.
    this.blocks.push(rpcBlockToLightBlock(finalizedBlock));

    // The latest block was already added to the unfinalized block queue during setup(),
    // so here all we need to do is start the queue.
    this.queue.start();

    // Fetch the latest block on the network on an interval, and add it to the queue.
    // TODO: optimistically optimize latency here using filters or subscriptions.
    this.unwatch = poll(
      async () => {
        const block = await this.getLatestBlock();
        this.queue.addTask({ block }, { front: true });
      },
      {
        emitOnBegin: true,
        interval: this.network.pollingInterval,
      }
    );
  };

  async kill() {
    this.unwatch?.();
    this.queue.clear();
    await this.queue.onIdle();
  }

  private buildQueue = () => {
    const worker = async ({ task }: { task: BlockTask }) => {
      await this.blockTaskWorker(task);
    };

    const queue = createQueue<BlockTask>({
      worker,
      options: { concurrency: 10, autoStart: false },
      onError: ({ error, task, queue }) => {
        // Default to a retry (uses the retry options passed to the queue).
        queue.addTask(task, { retry: true });
      },
      onComplete: ({ task }) => {
        // const { logFilter } = task;
        // if (task.kind === "LOG_SYNC") {
        //   this.metrics.logFilters[logFilter.name].logTaskCompletedCount += 1;
        // } else {
        //   this.metrics.logFilters[logFilter.name].blockTaskCompletedCount += 1;
        // }
      },
    });

    return queue;
  };

  private fetchLatestBlockTaskWorker = async () => {
    const previousHeadBlock = this.blocks[this.blocks.length - 1];

    const block = await this.getLatestBlock();
    const lightBlock = rpcBlockToLightBlock(block);

    // If we already saw and handled this block, it's a no-op.
    if (this.blocks.find((b) => b.hash === lightBlock.hash)) return;
  };

  private blockTaskWorker = async ({
    block,
  }: {
    block: BlockWithTransactions;
  }) => {
    const newBlockFull = block;
    const headBlock = this.blocks[this.blocks.length - 1];
    const newBlock = rpcBlockToLightBlock(block);

    console.log("in block worker with:", {
      newBlock,
      blocks: this.blocks,
    });

    // 1) We already saw and handled this block. No-op.
    if (this.blocks.find((b) => b.hash === newBlock.hash)) {
      return;
    }

    // 2) At least one block is missing. Note that this is the happy path for the first task after setup.
    if (newBlock.number > headBlock.number + 1) {
      const requiredBlockNumbers = range(headBlock.number + 1, newBlock.number);

      console.log("in 2)", { requiredBlockNumbers });

      // Fetch all missing blocks using a request concurrency limit of 10.
      const limit = pLimit(10);

      const blockRequests = requiredBlockNumbers.map((number) => {
        return limit(async () => {
          const block = await this.network.client.request({
            method: "eth_getBlockByNumber",
            params: [numberToHex(number), true],
          });
          if (!block)
            throw new Error(`Failed to fetch block number: ${number}`);
          return block as BlockWithTransactions;
        });
      });

      const blocks = await Promise.all(blockRequests);

      // Add all blocks to the queue, prioritizing oldest blocks first.
      // Include the block currently being handled.
      for (const block of [...blocks, newBlockFull]) {
        this.queue.addTask({ block }, { front: true });
      }

      return;
    }

    // 3) This is the new head block (happy path). Yay! Fetch logs that match the
    // registered log filters, then emit the `unfinalizedBlock`.
    if (
      newBlock.number == headBlock.number + 1 &&
      newBlock.parentHash == headBlock.hash
    ) {
      console.log("in 3)");

      // TODO: Check if newBlock.logsBloom matches the registered log filters before fetching logs.
      const logs = await this.network.client.request({
        method: "eth_getLogs",
        params: [
          {
            blockHash: newBlock.hash,
          },
        ],
      });

      // TODO: filter for the logs we care about client-side using registered log filters.
      await this.store.insertUnfinalizedBlock({
        chainId: this.network.chainId,
        block: newBlockFull,
        transactions: newBlockFull.transactions,
        logs,
      });
      this.emit("newBlock");

      // Add this block the local chain.
      this.blocks.push(newBlock);

      // If this block moves the finality checkpoint, remove now-finalized blocks from the local chain
      // and mark data as finalized in the store.
      if (
        newBlock.number >
        this.finalizedBlockNumber + 2 * this.network.finalityBlockCount
      ) {
        const newFinalizedBlockNumber =
          this.finalizedBlockNumber + this.network.finalityBlockCount;

        // Remove now-finalized blocks from the local chain (except for the block at newFinalizedBlockNumber).
        this.blocks = this.blocks.filter(
          (block) => block.number >= newFinalizedBlockNumber
        );

        await this.store.finalizeData({
          chainId: this.network.chainId,
          toBlockNumber: newFinalizedBlockNumber,
        });
        this.emit("finalityCheckpoint", { newFinalizedBlockNumber });
      }

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
    const canonicalFullBlocks = [newBlockFull];

    // Keep track of the current canonical block
    let canonicalBlock = newBlock;
    let depth = 0;

    while (canonicalBlock.number > this.finalizedBlockNumber) {
      const commonAncestorBlockNumber = this.blocks.find(
        (b) => b.hash === canonicalBlock.parentHash
      )?.number;

      // If the common ancestor block is present in our local chain, this is a short reorg.
      if (commonAncestorBlockNumber) {
        // Remove all non-canonical blocks from the local chain.
        this.blocks = this.blocks.filter(
          (block) => block.number > commonAncestorBlockNumber
        );

        // Clear the queue of all blocks (some might be from the non-canonical chain).
        this.queue.clear();

        // Add blocks from the canonical chain (they've already been fetched).
        for (const block of canonicalFullBlocks) {
          this.queue.addTask({ block }, { front: true });
        }

        this.store.deleteUnfinalizedData({
          chainId: this.network.chainId,
          fromBlockNumber: commonAncestorBlockNumber + 1,
        });

        this.emit("shallowReorg", { commonAncestorBlockNumber, depth });
        return;
      }

      const parentBlock_ = await this.network.client.request({
        method: "eth_getBlockByHash",
        params: [canonicalBlock.parentHash, true],
      });
      if (!parentBlock_)
        throw new Error(
          `Failed to fetch parent block with hash: ${canonicalBlock.parentHash}`
        );

      canonicalFullBlocks.unshift(parentBlock_ as BlockWithTransactions);
      depth += 1;
      canonicalBlock = rpcBlockToLightBlock(parentBlock_);
    }

    // 5) If the common ancestor was not found in our local chain, this is a deep reorg.
    this.emit("deepReorg", { minimumDepth: depth });
  };

  private async getLatestBlock() {
    // Fetch the latest block for the network.
    const latestBlock_ = await this.network.client.request({
      method: "eth_getBlockByNumber",
      params: ["latest", true],
    });
    if (!latestBlock_) throw new Error(`Unable to fetch latest block`);
    return latestBlock_ as BlockWithTransactions;
  }
}
