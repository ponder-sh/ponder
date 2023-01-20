import { p1_excluding_all } from "@/common/utils";
import type { Contract } from "@/config/contracts";
import type { Ponder } from "@/Ponder";

import { createBlockBackfillQueue } from "../queues/blockBackfillQueue";
import { createLogBackfillQueue } from "../queues/logBackfillQueue";

export const startBackfillForContract = async ({
  ponder,
  contract,
}: {
  ponder: Ponder;
  contract: Contract;
}) => {
  if (!contract.endBlock) {
    throw new Error(`Contract does not have an end block: ${contract.name}`);
  }

  // Create queues.
  const blockBackfillQueue = createBlockBackfillQueue({
    ponder,
    contract,
  });

  const logBackfillQueue = createLogBackfillQueue({
    ponder,
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

  const cachedIntervals = await ponder.cacheStore.getCachedIntervals(
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
  ponder.emit("backfill_contractStarted", {
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
      ponder.emit("backfill_logTasksAdded", {
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
      ponder.emit("backfill_logTasksAdded", {
        contract: contract.name,
        taskCount: 1,
      });
    }
  }

  const killQueues = () => {
    logBackfillQueue.kill();
    blockBackfillQueue.kill();
  };

  const drainQueues = async () => {
    if (!logBackfillQueue.idle()) {
      await logBackfillQueue.drained();
    }

    if (!blockBackfillQueue.idle()) {
      await blockBackfillQueue.drained();
    }
  };

  return { killQueues, drainQueues };
};
