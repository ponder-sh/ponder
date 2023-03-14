import Emittery from "emittery";

import { endBenchmark, p1_excluding_all, startBenchmark } from "@/common/utils";
import { Contract } from "@/config/contracts";
import { Resources } from "@/Ponder";

import { createBlockBackfillQueue } from "./blockBackfillQueue";
import { createLogBackfillQueue } from "./logBackfillQueue";

export type BackfillServiceEvents = {
  contractStarted: { contract: string; cacheRate: number };

  logTasksAdded: { contract: string; count: number };
  blockTasksAdded: { contract: string; count: number };

  logTaskFailed: { contract: string; error: Error };
  blockTaskFailed: { contract: string; error: Error };

  logTaskCompleted: { contract: string };
  blockTaskCompleted: { contract: string };

  newEventsAdded: { count: number };

  backfillStarted: { contractCount: number };
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

    const indexedContracts = this.resources.contracts.filter(
      (contract) => contract.isIndexed
    );

    await Promise.all(
      indexedContracts.map(async (contract) => {
        await this.startBackfillForContract({ contract });
      })
    );

    this.emit("backfillStarted", { contractCount: indexedContracts.length });

    await Promise.all(this.drainFunctions.map((f) => f()));

    const backfillDuration = endBenchmark(backfillStartedAt);
    this.emit("backfillCompleted", { duration: backfillDuration });
  }

  async kill() {
    await Promise.all(this.killFunctions.map((f) => f()));
  }

  private async startBackfillForContract({ contract }: { contract: Contract }) {
    if (!contract.endBlock) {
      throw new Error(`Contract does not have an end block: ${contract.name}`);
    }

    // Create queues.
    const blockBackfillQueue = createBlockBackfillQueue({
      backfillService: this,
      contract,
    });

    const logBackfillQueue = createLogBackfillQueue({
      backfillService: this,
      contract,
      blockBackfillQueue,
    });

    if (contract.startBlock > contract.endBlock) {
      throw new Error(
        `Start block number (${contract.startBlock}) is greater than latest block number (${contract.endBlock}).
         Are you sure the RPC endpoint is for the correct network?
        `
      );
    }

    const cachedIntervals = await this.resources.cacheStore.getCachedIntervals(
      contract.address
    );
    const requiredBlockIntervals = p1_excluding_all(
      [contract.startBlock, contract.endBlock],
      cachedIntervals.map((i) => [i.startBlock, i.endBlock])
    );

    const requiredBlockCount = requiredBlockIntervals.reduce((acc, cur) => {
      return acc + (cur[1] + 1 - cur[0]);
    }, 0);
    const cacheRate = Math.max(
      0,
      1 - requiredBlockCount / (contract.endBlock - contract.startBlock)
    );

    this.emit("contractStarted", {
      contract: contract.name,
      cacheRate: cacheRate,
    });

    for (const blockInterval of requiredBlockIntervals) {
      const [startBlock, endBlock] = blockInterval;

      let fromBlock = startBlock;
      let toBlock = Math.min(fromBlock + contract.blockLimit - 1, endBlock);

      while (fromBlock <= endBlock) {
        logBackfillQueue.addTask({ fromBlock, toBlock, isRetry: false });

        fromBlock = toBlock + 1;
        toBlock = Math.min(fromBlock + contract.blockLimit - 1, endBlock);
        this.emit("logTasksAdded", {
          contract: contract.name,
          count: 1,
        });
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
