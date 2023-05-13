import Emittery from "emittery";
import pLimit from "p-limit";
import { hexToNumber, numberToHex, PublicClient, RpcBlock, RpcLog } from "viem";

import { createQueue, Queue } from "@/common/createQueue";
import { FullBlock, LightBlock, rpcBlockToLightBlock } from "@/types/block";
import { LogFilter } from "@/types/filter";
import { poll } from "@/utils/poll";
import { range } from "@/utils/range";

export type UnfinalizedIndexerEvents = {
  /*
   * Emitted when the finalization checkpoint moves forward.
   *
   * Consumers should respond to this event by marking any data _older_ than
   * newFinalizedBlockNumber as finalized.
   */
  finalizationCheckpoint: { newFinalizedBlockNumber: number };

  /*
   * Emitted when the service detects a chain reorganization with a common ancestor block
   * in the unfinalized block range.
   *
   * This event will be followed by a series of `newUnfinalizedBlock` events
   * containing blocks from the new canonical chain starting with commonAncestorBlockNumber + 1.
   *
   * Consumers should respond to this event by deleting any data _newer_ than
   * commonAncestorBlockNumber.
   */
  shallowReorg: { commonAncestorBlockNumber: number; depth: number };

  /*
   * Emitted when the service detects a chain reorganization with a common ancestor block
   * that is in the finalized block range. If this occurs, it means the finalityThreshold was incorrect.
   *
   * Consumers should consider deleting all cached blockchain data.
   */
  deepReorg: { minimumDepth: number };

  /*
   * Emitted when a new block and any matched logs have been fetched.
   *
   * Consumers can assume that the block included in the event body is the latest
   * block that this service has processed.
   *
   * If there is a shallow reorg, this event will be emitted after the `shallowReorg` event
   * for each new canonical block.
   */
  unfinalizedBlock: { block: RpcBlock; matchedLogs: RpcLog[] };
};

export class UnfinalizedIndexerService extends Emittery<UnfinalizedIndexerEvents> {
  // Service configuration.
  private logFilters: LogFilter[];
  private client: PublicClient;
  private pollingIntervalInMs: number;
  private finalityBlockCount: number;

  // Block number of the current finalized block.
  private finalizedBlockNumber = 0;
  // Local representation of the unfinalized portion of the chain.
  private blocks: LightBlock[] = [];
  // Queue of unprocessed blocks.
  private unfinalizedBlockQueue: Queue<FullBlock>;
  // Functions that should run when the service is killed.
  private unwatchers: (() => any | Promise<any>)[] = [];

  constructor({
    logFilters,
    client,
    finalityBlockCount = 10,
    pollingIntervalInMs = 1_000,
  }: {
    logFilters: LogFilter[];
    client: PublicClient;
    finalityBlockCount?: number;
    pollingIntervalInMs?: number;
  }) {
    super();

    this.logFilters = logFilters;
    this.client = client;
    this.finalityBlockCount = finalityBlockCount;
    this.pollingIntervalInMs = pollingIntervalInMs;

    this.unfinalizedBlockQueue = createQueue({
      worker: this.blockWorker,
      context: {},
      options: {
        concurrency: 1,
        autoStart: false,
      },
    });

    this.unfinalizedBlockQueue.on("error", ({ error }) => {
      console.log({ error });
    });

    this.unwatchers.push(async () => {
      this.unfinalizedBlockQueue.clear();
      await this.unfinalizedBlockQueue.onIdle();
    });
  }

  /*
   * Fetches and stores the initial finalization block number for the network.
   * Must happen before starting the finalized or unfinalized data sync.
   */
  setup = async () => {
    // Fetch the latest block for the network.
    const latestBlock = await this.getLatestBlock();

    // Set the finalized block number according to the network's finality threshold.
    // If the finality block count is greater than the latest block number, set to zero.
    const finalizedBlockNumber = Math.max(
      0,
      hexToNumber(latestBlock.number) - this.finalityBlockCount
    );
    this.finalizedBlockNumber = finalizedBlockNumber;

    // Add the latest block to the unfinalized block queue.
    // The queue won't start immediately; see syncUnfinalizedData for details.
    this.unfinalizedBlockQueue.addTask(latestBlock, {
      priority: Number.MAX_SAFE_INTEGER - hexToNumber(latestBlock.number),
    });

    return { finalizedBlockNumber };
  };

  /*
   * Gracefully shuts down the service.
   */
  async kill() {
    await Promise.all(this.unwatchers);
  }

  /*
   * Begins polling for live logs matching each configured log filter.
   * Emits the `newFinalizationCheckpoint`, `newReorganization`, and `newEvents` events.
   */
  start = async () => {
    // If the latest block was not added to the queue, setup was not completed successfully.
    if (this.unfinalizedBlockQueue.size === 0) {
      throw new Error(
        `Unable to start. Must call setup() method before start().`
      );
    }

    // Fetch the block at the finalized block number.
    const finalizedBlock = await this.client.request({
      method: "eth_getBlockByNumber",
      params: [numberToHex(this.finalizedBlockNumber), false],
    });
    if (!finalizedBlock) throw new Error(`Unable to fetch finalized block`);

    // Add the finalized block as the first element of the list of unfinalized blocks.
    this.blocks.push(rpcBlockToLightBlock(finalizedBlock));

    // The latest block was already added to the unfinalized block queue during setup(),
    // so here all we need to do is start the queue.
    this.unfinalizedBlockQueue.start();

    // Fetch the latest block on the network on an interval, and add it to the queue.
    // TODO: optimistically optimize latency here using filters or subscriptions.
    const unwatch = poll(
      async () => {
        const block = await this.getLatestBlock();
        const priority = Number.MAX_SAFE_INTEGER - hexToNumber(block.number);
        this.unfinalizedBlockQueue.addTask(block, { priority });
      },
      {
        emitOnBegin: true,
        interval: this.pollingIntervalInMs,
      }
    );

    this.unwatchers.push(unwatch);
  };

  private blockWorker = async ({ task }: { task: FullBlock }) => {
    const newBlockFull = task;
    const headBlock = this.blocks[this.blocks.length - 1];
    const newBlock = rpcBlockToLightBlock(task);

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
          const block = await this.client.request({
            method: "eth_getBlockByNumber",
            params: [numberToHex(number), true],
          });
          if (!block)
            throw new Error(`Failed to fetch block number: ${number}`);
          return block as FullBlock;
        });
      });

      const blocks = await Promise.all(blockRequests);

      // Add all blocks to the queue, prioritizing oldest blocks first.
      // Include the block currently being handled.
      for (const block of [...blocks, newBlockFull]) {
        const priority = Number.MAX_SAFE_INTEGER - hexToNumber(block.number);
        this.unfinalizedBlockQueue.addTask(block, { priority });
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
      const logs = await this.client.request({
        method: "eth_getLogs",
        params: [
          {
            blockHash: newBlock.hash,
          },
        ],
      });

      // TODO: filter for the logs we care about client-side using registered log filters.

      this.emit("unfinalizedBlock", {
        matchedLogs: logs,
        block: newBlockFull,
      });

      // Add this block the local chain.
      this.blocks.push(newBlock);

      // If this block moves the finality checkpoint, remove now-finalized blocks from the local chain
      // and mark data as finalized in the store.
      if (
        newBlock.number >
        this.finalizedBlockNumber + 2 * this.finalityBlockCount
      ) {
        const newFinalizedBlockNumber =
          this.finalizedBlockNumber + this.finalityBlockCount;

        // Remove now-finalized blocks from the local chain (except for the block at newFinalizedBlockNumber).
        this.blocks = this.blocks.filter(
          (block) => block.number >= newFinalizedBlockNumber
        );

        this.emit("finalizationCheckpoint", {
          newFinalizedBlockNumber,
        });
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
        this.unfinalizedBlockQueue.clear();

        // Add blocks from the canonical chain (they've already been fetched).
        for (const block of canonicalFullBlocks) {
          const priority = Number.MAX_SAFE_INTEGER - hexToNumber(block.number);
          this.unfinalizedBlockQueue.addTask(block, { priority });
        }

        this.emit("shallowReorg", { commonAncestorBlockNumber, depth });
        return;
      }

      const parentBlock_ = await this.client.request({
        method: "eth_getBlockByHash",
        params: [canonicalBlock.parentHash, true],
      });
      if (!parentBlock_)
        throw new Error(
          `Failed to fetch parent block with hash: ${canonicalBlock.parentHash}`
        );

      canonicalFullBlocks.unshift(parentBlock_ as FullBlock);
      depth += 1;
      canonicalBlock = rpcBlockToLightBlock(parentBlock_);
    }

    // 5) If the common ancestor was not found in our local chain, this is a deep reorg.
    this.emit("deepReorg", { minimumDepth: depth });
  };

  private async getLatestBlock() {
    // Fetch the latest block for the network.
    const latestBlock_ = await this.client.request({
      method: "eth_getBlockByNumber",
      params: ["latest", true],
    });
    if (!latestBlock_) throw new Error(`Unable to fetch latest block`);
    return latestBlock_ as FullBlock;
  }
}
