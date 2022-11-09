import { logger } from "@/common/logger";
import { p1_excluding_all } from "@/common/utils";
import type { Ponder } from "@/core/Ponder";
import type { CacheStore } from "@/db/cacheStore";
import type { Source } from "@/sources/base";

import { createBlockBackfillQueue } from "../queues/blockBackfillQueue";
import { createLogBackfillQueue } from "../queues/logBackfillQueue";
import { getPrettyPercentage, stats } from "./stats";

export const startSourceBackfillQueues = async ({
  source,
  cacheStore,
  latestBlockNumber,
  ponder,
}: {
  source: Source;
  cacheStore: CacheStore;
  latestBlockNumber: number;
  ponder: Ponder;
}) => {
  // Create queues.
  const blockBackfillQueue = createBlockBackfillQueue({
    cacheStore,
    source,
  });

  const logBackfillQueue = createLogBackfillQueue({
    cacheStore,
    source,
    blockBackfillQueue,
    ponder,
  });

  const requestedStartBlock = source.startBlock;
  const requestedEndBlock = latestBlockNumber;

  if (requestedStartBlock > latestBlockNumber) {
    throw new Error(
      `Start block number (${requestedStartBlock}) is greater than latest block number (${latestBlockNumber}).
       Are you sure the RPC endpoint is for the correct network?
      `
    );
  }

  const cachedIntervals = await cacheStore.getCachedIntervals(source.address);
  const requiredBlockIntervals = p1_excluding_all(
    [requestedStartBlock, requestedEndBlock],
    cachedIntervals.map((i) => [i.startBlock, i.endBlock])
  );

  logger.debug({
    requestedInterval: [requestedStartBlock, requestedEndBlock],
    requiredBlockIntervals: requiredBlockIntervals,
  });

  const fetchedCount = requiredBlockIntervals.reduce(
    (t, c) => t + c[1] - c[0],
    0
  );
  const totalCount = requestedEndBlock - requestedStartBlock;
  const cachedCount = totalCount - fetchedCount;
  // const logRequestCount = fetchedCount / blockLimit;

  stats.requestPlanTable.addRow({
    "source name": source.name,
    "start block": source.startBlock,
    "end block": requestedEndBlock,
    "cache rate": getPrettyPercentage(cachedCount, totalCount),
    // Leaving this out for now because they are a bit misleading.
    // Reintroduce after implementing contract-level log fetches.
    // "RPC requests":
    //   logRequestCount === 0 ? "1" : `~${Math.round(logRequestCount * 2)}`,
  });
  stats.sourceCount += 1;
  if (stats.sourceCount === stats.sourceTotalCount) {
    logger.info("Backfill plan");
    logger.info(stats.requestPlanTable.render(), "\n");
    // stats.syncProgressBar.start(0, 0);
  }

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
      stats.syncProgressBar.setTotal(stats.syncProgressBar.getTotal() + 1);
      return;
    }

    while (fromBlock < endBlock) {
      logBackfillQueue.push({
        contractAddresses: [source.address],
        fromBlock,
        toBlock,
      });

      fromBlock = toBlock + 1;
      toBlock = Math.min(fromBlock + source.blockLimit, endBlock);

      stats.syncProgressBar.setTotal(stats.syncProgressBar.getTotal() + 1);
    }
  }

  logger.debug(`Processing ${logBackfillQueue.length()} log backfill tasks...`);
  if (!logBackfillQueue.idle()) {
    await logBackfillQueue.drained();
  }

  logger.debug(
    `Processing ${blockBackfillQueue.length()} block backfill tasks...`
  );
  if (!blockBackfillQueue.idle()) {
    await blockBackfillQueue.drained();
  }
};
