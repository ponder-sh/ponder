import Emittery from "emittery";

import { endBenchmark, p1_excluding_all, startBenchmark } from "@/common/utils";
import { LogFilter } from "@/config/logFilters";
import { Resources } from "@/Ponder";

import { createBlockBackfillQueue } from "./blockBackfillQueue";
import { createLogBackfillQueue } from "./logBackfillQueue";

export type BackfillServiceEvents = {
  logFilterStarted: { name: string; cacheRate: number };

  logTasksAdded: { name: string; count: number };
  blockTasksAdded: { name: string; count: number };

  logTaskFailed: { name: string; error: Error };
  blockTaskFailed: { name: string; error: Error };

  logTaskCompleted: { name: string };
  blockTaskCompleted: { name: string };

  eventsAdded: undefined;

  backfillStarted: { logFilterCount: number };
  backfillCompleted: { duration: number };
};

export class BackfillService extends Emittery<BackfillServiceEvents> {
  resources: Resources;

  private killFunctions: (() => Promise<void>)[] = [];
  private drainFunctions: (() => Promise<void>)[] = [];

  constructor({ resources }: { resources: Resources }) {
    super();
    this.resources = resources;
  }

  async backfill() {
    const backfillStartedAt = startBenchmark();

    await Promise.all(
      this.resources.logFilters.map(async (logFilter) => {
        await this.startBackfillForLogFilter({ logFilter });
      })
    );

    this.emit("backfillStarted", {
      logFilterCount: this.resources.logFilters.length,
    });

    await Promise.all(this.drainFunctions.map((f) => f()));

    const backfillDuration = endBenchmark(backfillStartedAt);
    this.emit("backfillCompleted", { duration: backfillDuration });
  }

  async kill() {
    await Promise.all(this.killFunctions.map((f) => f()));
  }

  private async startBackfillForLogFilter({
    logFilter,
  }: {
    logFilter: LogFilter;
  }) {
    if (!logFilter.endBlock) {
      throw new Error(
        `Log filter does not have an end block: ${logFilter.name}`
      );
    }

    // Create queues.
    const blockBackfillQueue = createBlockBackfillQueue({
      backfillService: this,
      logFilter,
    });

    const logBackfillQueue = createLogBackfillQueue({
      backfillService: this,
      logFilter,
      blockBackfillQueue,
    });

    const { startBlock, endBlock } = logFilter;

    if (startBlock > endBlock) {
      throw new Error(
        `Start block number (${startBlock}) is greater than end block number (${endBlock}).
         Are you sure the RPC endpoint is for the correct network?
        `
      );
    }

    const cachedRanges =
      await this.resources.cacheStore.getLogFilterCachedRanges({
        filterKey: logFilter.filterKey,
      });
    const requiredBlockRanges = p1_excluding_all(
      [logFilter.startBlock, logFilter.endBlock],
      cachedRanges.map((r) => [r.startBlock, r.endBlock])
    );

    const requiredBlockCount = requiredBlockRanges.reduce((acc, cur) => {
      return acc + (cur[1] + 1 - cur[0]);
    }, 0);
    const cacheRate = Math.max(
      0,
      1 - requiredBlockCount / (logFilter.endBlock - logFilter.startBlock)
    );

    this.emit("logFilterStarted", {
      name: logFilter.name,
      cacheRate: cacheRate,
    });

    for (const blockRange of requiredBlockRanges) {
      const [startBlock, endBlock] = blockRange;

      let fromBlock = startBlock;
      let toBlock = Math.min(fromBlock + logFilter.blockLimit - 1, endBlock);

      while (fromBlock <= endBlock) {
        logBackfillQueue.addTask({ fromBlock, toBlock, isRetry: false });

        fromBlock = toBlock + 1;
        toBlock = Math.min(fromBlock + logFilter.blockLimit - 1, endBlock);
      }
    }

    this.killFunctions.push(async () => {
      logBackfillQueue.clear();
      await logBackfillQueue.onIdle();
      blockBackfillQueue.clear();
      await blockBackfillQueue.onIdle();
    });

    this.drainFunctions.push(async () => {
      await logBackfillQueue.onIdle();
      await blockBackfillQueue.onIdle();
    });
  }
}
