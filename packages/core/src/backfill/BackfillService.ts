import { EventEmitter } from "@/common/EventEmitter";
import { p1_excluding_all } from "@/common/utils";
import { Contract } from "@/config/contracts";
import { Resources } from "@/Ponder2";

import { createBlockBackfillQueue } from "./blockBackfillQueue";
import { createLogBackfillQueue } from "./logBackfillQueue";

type BackfillServiceEvents = {
  backfill_contractStarted: (arg: {
    contract: string;
    cacheRate: number;
  }) => void;
  backfill_logTasksAdded: (arg: {
    contract: string;
    taskCount: number;
  }) => void;
  backfill_blockTasksAdded: (arg: {
    contract: string;
    taskCount: number;
  }) => void;
  backfill_logTaskFailed: (arg: { contract: string; error: Error }) => void;
  backfill_blockTaskFailed: (arg: { contract: string; error: Error }) => void;
  backfill_logTaskDone: (arg: { contract: string }) => void;
  backfill_blockTaskDone: (arg: { contract: string }) => void;
  backfill_newLogs: () => void;
};

export class BackfillService extends EventEmitter<BackfillServiceEvents> {
  resources: Resources;

  private queueKillFunctions: (() => void)[] = [];
  private queueDrainFunctions: (() => Promise<void>)[] = [];

  constructor({ resources }: { resources: Resources }) {
    super();
    this.resources = resources;
  }

  async startBackfill() {
    await Promise.all(
      this.resources.contracts
        .filter((contract) => contract.isIndexed)
        .map(async (contract) => {
          await this.startBackfillForContract({ contract });
        })
    );
  }

  killQueues() {
    this.queueKillFunctions.forEach((f) => f());
  }

  async drainQueues() {
    await Promise.all(this.queueDrainFunctions.map(async (f) => await f()));
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
    this.emit("backfill_contractStarted", {
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
        this.emit("backfill_logTasksAdded", {
          contract: contract.name,
          taskCount: 1,
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
        this.emit("backfill_logTasksAdded", {
          contract: contract.name,
          taskCount: 1,
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
