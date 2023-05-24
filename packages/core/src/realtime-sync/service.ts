import Emittery from "emittery";
import pLimit from "p-limit";
import { hexToNumber, numberToHex } from "viem";

import { type Queue, createQueue } from "@/common/queue";
import type { LogFilter } from "@/config/logFilters";
import type { Network } from "@/config/networks";
import type { EventStore } from "@/event-store/store";
import { poll } from "@/utils/poll";
import { range } from "@/utils/range";

import { isMatchedLogInBloomFilter } from "./bloom";
import { filterLogs } from "./filter";
import {
  type BlockWithTransactions,
  type LightBlock,
  rpcBlockToLightBlock,
} from "./format";

type RealtimeBlockTask = BlockWithTransactions;

type RealtimeSyncQueue = Queue<RealtimeBlockTask>;

type RealtimeSyncMetrics = {
  // Block number -> log filter name -> matched log count.
  // Note that finalized blocks are removed from this object.
  blocks: Record<
    number,
    {
      matchedLogCount: number;
      falsePositiveBloomFilter: boolean;
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
  private unpoll?: () => any | Promise<any>;

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
    this.metrics = { blocks: {} };
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
    this.queue.addTask(latestBlock);

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

    // Add an empty task the queue (the worker will fetch the latest block).
    // TODO: optimistically optimize latency here using filters or subscriptions.
    this.unpoll = poll(
      async () => {
        console.log("in poll function");
        const block = await this.getLatestBlock();
        this.queue.addTask(block);
      },
      {
        emitOnBegin: false,
        interval: 10_000,
      }
    );
  };

  async kill() {
    this.unpoll?.();
    this.queue.clear();
    await this.queue.onIdle();
  }

  async onIdle() {
    await this.queue.onIdle();
  }

  private buildQueue = () => {
    const queue = createQueue<RealtimeBlockTask>({
      worker: async ({ task }: { task: RealtimeBlockTask }) => {
        await this.blockTaskWorker(task);
      },
      options: { concurrency: 1, autoStart: false },
      onError: ({ error }) => {
        console.log("in error handler");
        console.log({ error });
        // Default to a retry (uses the retry options passed to the queue).
        // queue.addTask(task, { retry: true });
      },
      // onComplete: ({}) => {
      // const { logFilter } = task;
      // if (task.kind === "LOG_SYNC") {
      //   this.metrics.logFilters[logFilter.name].logTaskCompletedCount += 1;
      // } else {
      //   this.metrics.logFilters[logFilter.name].blockTaskCompletedCount += 1;
      // }
      // },
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
        const logs = await this.network.client.request({
          method: "eth_getLogs",
          params: [
            {
              blockHash: newBlock.hash,
            },
          ],
        });

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
          await this.store.insertUnfinalizedBlock({
            chainId: this.network.chainId,
            block: newBlockWithTransactions,
            transactions: filteredTransactions,
            logs: filteredLogs,
          });
        }
      }

      this.emit("newBlock");

      // Add this block the local chain.
      this.blocks.push(newBlock);

      this.metrics.blocks[newBlock.number] = {
        matchedLogCount,
        falsePositiveBloomFilter:
          isMatchedLogPresentInBlock && matchedLogCount === 0,
      };

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

        // Clean up metrics for now-finalized blocks.
        for (const n in this.metrics.blocks) {
          if (Number(n) < newFinalizedBlockNumber) {
            delete this.metrics.blocks[n];
          }
        }

        await this.store.finalizeData({
          chainId: this.network.chainId,
          toBlockNumber: newFinalizedBlockNumber,
        });
        this.emit("finalityCheckpoint", { newFinalizedBlockNumber });
      }

      return;
    }

    // 3) At least one block is missing. Note that this is the happy path for the first task after setup.
    if (newBlock.number > previousHeadBlock.number + 1) {
      const requiredBlockNumbers = range(
        previousHeadBlock.number + 1,
        newBlock.number
      );

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

      const rawBlocks = await Promise.all(blockRequests);

      const blocks = [...rawBlocks, newBlockWithTransactions].sort(
        (a, b) => hexToNumber(a.number) - hexToNumber(b.number)
      );

      // console.log(blocks.map((t) => hexToNumber(t.number)));

      // Add all blocks to the queue, prioritizing oldest blocks first.
      // Include the block currently being handled.
      // for (const block of blocks) {
      //   console.log(
      //     "adding task for block with number: ",
      //     hexToNumber(block.number)
      //   );
      //   this.queue.addTask({ block }, { front: true });
      // }

      for (const block of blocks) {
        this.queue.addTask(block);
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
    const canonicalBlocksWithTransactions = [newBlockWithTransactions];

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
        for (const block of canonicalBlocksWithTransactions) {
          this.queue.addTask(block);
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

      canonicalBlocksWithTransactions.unshift(
        parentBlock_ as BlockWithTransactions
      );
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
