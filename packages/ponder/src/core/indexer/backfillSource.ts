import { logger } from "@/common/logger";
import { p1_excluding_all } from "@/common/utils";
import type { CacheStore } from "@/db/cacheStore";
import type { Source } from "@/sources/base";

import { createHistoricalBlockRequestQueue } from "./historicalBlockRequestQueue";
import { createHistoricalLogsRequestQueue } from "./historicalLogsRequestQueue";
import { getPrettyPercentage, stats } from "./stats";

export const backfillSource = async ({
  source,
  cacheStore,
  currentBlockNumber,
  isHotReload,
}: {
  source: Source;
  cacheStore: CacheStore;
  currentBlockNumber: number;
  isHotReload: boolean;
}) => {
  // Create queues.
  const historicalBlockRequestQueue = createHistoricalBlockRequestQueue({
    cacheStore,
    source,
  });

  const historicalLogsRequestQueue = createHistoricalLogsRequestQueue({
    cacheStore,
    source,
    historicalBlockRequestQueue,
  });

  const requestedStartBlock = source.startBlock;
  const requestedEndBlock = currentBlockNumber;

  if (requestedStartBlock > currentBlockNumber) {
    throw new Error(
      `Start block number (${requestedStartBlock}) is greater than latest block number (${currentBlockNumber}).
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
    cachedIntervals,
    requiredInterval: requiredBlockIntervals,
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
  if (!isHotReload && stats.sourceCount === stats.sourceTotalCount) {
    logger.info("Backfill plan");
    logger.info(stats.requestPlanTable.render(), "\n");
    stats.syncProgressBar.start(0, 0);
  }

  for (const blockInterval of requiredBlockIntervals) {
    const [startBlock, endBlock] = blockInterval;
    let fromBlock = startBlock;
    let toBlock = Math.min(fromBlock + source.blockLimit, endBlock);

    while (fromBlock < endBlock) {
      historicalLogsRequestQueue.push({
        contractAddresses: [source.address],
        fromBlock,
        toBlock,
      });

      fromBlock = toBlock + 1;
      toBlock = Math.min(fromBlock + source.blockLimit, endBlock);

      stats.syncProgressBar.setTotal(stats.syncProgressBar.getTotal() + 1);
    }
  }

  logger.debug("Waiting for the log request queue to clear...");
  logger.debug({
    logRequestQueueLength: historicalLogsRequestQueue.length(),
  });

  if (!historicalLogsRequestQueue.idle()) {
    await historicalLogsRequestQueue.drained();
  }

  logger.debug("Waiting for the block request queue to clear...");
  logger.debug({
    blockRequestQueueLength: historicalBlockRequestQueue.length(),
  });

  if (!historicalBlockRequestQueue.idle()) {
    await historicalBlockRequestQueue.drained();
  }
};
