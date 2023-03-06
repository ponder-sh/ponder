import Emittery from "emittery";

import { endBenchmark, p1_excluding_all, startBenchmark } from "@/common/utils";
import { Contract } from "@/config/contracts";
import { Resources } from "@/Ponder";

import { createBlockBackfillQueue } from "./blockBackfillQueue";
import { createLogBackfillQueue } from "./logBackfillQueue";

type BackfillServiceEvents = {
  contractStarted: { contract: string; cacheRate: number };

  logTasksAdded: { contract: string; count: number };
  blockTasksAdded: { contract: string; count: number };

  logTaskFailed: { contract: string; error: Error };
  blockTaskFailed: { contract: string; error: Error };

  logTaskCompleted: { contract: string };
  blockTaskCompleted: { contract: string };

  newEventsAdded: { count: number };

  backfillCompleted: { duration: number };
};

export class BackfillService extends Emittery<BackfillServiceEvents> {
  resources: Resources;

  private queueKillFunctions: (() => void)[] = [];
  private queueDrainFunctions: (() => Promise<void>)[] = [];

  constructor({ resources }: { resources: Resources }) {
    super();
    this.resources = resources;
  }

  async backfill() {
    const backfillStartedAt = startBenchmark();

    await Promise.all(
      this.resources.contracts
        .filter((contract) => contract.isIndexed)
        .map(async (contract) => {
          await this.startBackfillForContract({ contract });
        })
    );

    await Promise.all(this.queueDrainFunctions.map(async (f) => await f()));

    const backfillDuration = endBenchmark(backfillStartedAt);
    this.emit("backfillCompleted", { duration: backfillDuration });
  }

  killQueues() {
    this.queueKillFunctions.forEach((f) => f());
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
      let toBlock = Math.min(fromBlock + contract.blockLimit, endBlock);

      // Handle special case for a one block range. Probably shouldn't need this.
      if (fromBlock === toBlock) {
        logBackfillQueue.push({
          contractAddresses: [contract.address],
          fromBlock,
          toBlock,
        });
        this.emit("logTasksAdded", {
          contract: contract.name,
          count: 1,
        });
        continue;
      }

      while (fromBlock < endBlock) {
        logBackfillQueue.push({
          contractAddresses: [contract.address],
          fromBlock,
          toBlock,
        });

        fromBlock = toBlock + 1;
        toBlock = Math.min(fromBlock + contract.blockLimit, endBlock);
        this.emit("logTasksAdded", {
          contract: contract.name,
          count: 1,
        });
      }
    }

    this.queueKillFunctions.push(() => {
      logBackfillQueue.kill();
      blockBackfillQueue.kill();
    });

    this.queueDrainFunctions.push(async () => {
      if (!logBackfillQueue.idle()) {
        await logBackfillQueue.drained();
      }

      if (!blockBackfillQueue.idle()) {
        await blockBackfillQueue.drained();
      }
    });
  }
}
