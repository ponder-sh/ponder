import { p1_excluding_all } from "@/common/utils";
import type { Ponder } from "@/Ponder";
import type { Source } from "@/sources/base";

import { createBlockBackfillQueue } from "../queues/blockBackfillQueue";
import { createLogBackfillQueue } from "../queues/logBackfillQueue";

export const startBackfillForSource = async ({
  ponder,
  source,
}: {
  ponder: Ponder;
  source: Source;
}) => {
  if (!source.endBlock) {
    throw new Error(`Source does not have an end block: ${source.name}`);
  }

  // Create queues.
  const blockBackfillQueue = createBlockBackfillQueue({
    ponder,
    source,
  });

  const logBackfillQueue = createLogBackfillQueue({
    ponder,
    source,
    blockBackfillQueue,
  });

  if (source.startBlock > source.endBlock) {
    throw new Error(
      `Start block number (${source.startBlock}) is greater than latest block number (${source.endBlock}).
       Are you sure the RPC endpoint is for the correct network?
      `
    );
  }

  const cachedIntervals = await ponder.cacheStore.getCachedIntervals(
    source.address
  );
  const requiredBlockIntervals = p1_excluding_all(
    [source.startBlock, source.endBlock],
    cachedIntervals.map((i) => [i.startBlock, i.endBlock])
  );

  const requiredBlockCount = requiredBlockIntervals.reduce((acc, cur) => {
    return acc + (cur[1] + 1 - cur[0]);
  }, 0);
  const cacheRate = Math.max(
    0,
    1 - requiredBlockCount / (source.endBlock - source.startBlock)
  );
  ponder.emit("backfill_sourceStarted", {
    source: source.name,
    cacheRate: cacheRate,
  });

  for (const blockInterval of requiredBlockIntervals) {
    const [startBlock, endBlock] = blockInterval;
    let fromBlock = startBlock;
    let toBlock = Math.min(fromBlock + source.blockLimit, endBlock);

    // Handle special case for a one block range. Probably shouldn't need this.
    if (fromBlock === toBlock) {
      logBackfillQueue.push({
        contractAddresses: [source.address],
        fromBlock,
        toBlock,
      });
      ponder.emit("backfill_logTasksAdded", {
        source: source.name,
        taskCount: 1,
      });
      continue;
    }

    while (fromBlock < endBlock) {
      logBackfillQueue.push({
        contractAddresses: [source.address],
        fromBlock,
        toBlock,
      });

      fromBlock = toBlock + 1;
      toBlock = Math.min(fromBlock + source.blockLimit, endBlock);
      ponder.emit("backfill_logTasksAdded", {
        source: source.name,
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
