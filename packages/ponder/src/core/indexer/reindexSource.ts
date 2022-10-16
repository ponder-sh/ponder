import { logger } from "@/common/logger";
import { Source } from "@/sources/base";
import type { CacheStore } from "@/stores/baseCacheStore";

import { createHistoricalBlockRequestQueue } from "./historicalBlockRequestQueue";
import { createHistoricalLogsRequestQueue } from "./historicalLogsRequestQueue";
import type { LiveBlockRequestQueue } from "./liveBlockRequestQueue";
import { isHotReload } from "./reindex";
import { getPrettyPercentage, stats } from "./stats";
import { p1_excluding_p2 } from "./utils";

export const reindexSource = async ({
  source,
  cacheStore,
  liveBlockRequestQueue,
  currentBlockNumber,
}: {
  source: Source;
  cacheStore: CacheStore;
  liveBlockRequestQueue: LiveBlockRequestQueue;
  currentBlockNumber: number;
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

  // Build an array of block ranges that need to be fetched for this group of contracts.
  const blockRanges: number[][] = [];

  const cachedBlockRange = await cacheStore.getCachedBlockRange([
    source.address,
  ]);

  if (cachedBlockRange) {
    const { maxStartBlock, minEndBlock } = cachedBlockRange;

    const requiredRanges = p1_excluding_p2(
      [requestedStartBlock, requestedEndBlock],
      [maxStartBlock, minEndBlock]
    );

    blockRanges.push(...requiredRanges);
  } else {
    blockRanges.push([requestedStartBlock, requestedEndBlock]);
  }

  logger.debug({
    requestedRange: [requestedStartBlock, requestedEndBlock],
    cachedRange: cachedBlockRange
      ? [cachedBlockRange.maxStartBlock, cachedBlockRange.minEndBlock]
      : null,
    requiredRanges: blockRanges,
  });

  const fetchedCount = blockRanges.reduce((t, c) => t + c[1] - c[0], 0);
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
    logger.info("Historical sync plan");
    logger.info(stats.requestPlanTable.render(), "\n");
    stats.progressBar.start(0, 0);
  }

  for (const blockRange of blockRanges) {
    const [startBlock, endBlock] = blockRange;
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

      stats.progressBar.setTotal(stats.progressBar.getTotal() + 1);
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

  return liveBlockRequestQueue;
};
