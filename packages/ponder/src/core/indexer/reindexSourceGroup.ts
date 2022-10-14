import type fastq from "fastq";

import { logger } from "@/common/logger";
import type { CacheStore } from "@/stores/baseCacheStore";

import { createHistoricalBlockRequestQueue } from "./historicalBlockRequestQueue";
import { createHistoricalLogsRequestQueue } from "./historicalLogsRequestQueue";
import { createLiveBlockRequestQueue } from "./liveBlockRequestQueue";
import type { SourceGroup } from "./reindex";
import { stats } from "./stats";
import { p1_excluding_p2 } from "./utils";

export const reindexSourceGroup = async ({
  sourceGroup,
  cacheStore,
  logQueue,
}: {
  sourceGroup: SourceGroup;
  cacheStore: CacheStore;
  logQueue: fastq.queueAsPromised;
}) => {
  const { contracts, provider, chainId, startBlock, blockLimit } = sourceGroup;

  // If hot reloading, we will re-enter this function during the lifecycle
  // of the provider. Must remove the old block listener.
  provider.removeAllListeners("block");

  // Create queues.
  const historicalBlockRequestQueue = createHistoricalBlockRequestQueue({
    cacheStore,
    sourceGroup,
  });

  const historicalLogsRequestQueue = createHistoricalLogsRequestQueue({
    cacheStore,
    sourceGroup,
    historicalBlockRequestQueue,
  });

  const liveBlockRequestQueue = createLiveBlockRequestQueue({
    cacheStore,
    sourceGroup,
    logQueue,
  });

  // Pause the live block request queue, but begin adding tasks to it.
  // Once the historical sync is complete, unpause it to process the backlog of
  // tasks that were added during historical sync and new live logs.
  liveBlockRequestQueue.pause();
  provider.on("block", (blockNumber: number) => {
    liveBlockRequestQueue.push({ blockNumber });
  });

  // Kinda weird but should work to make sure this RPC request gets done
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  let currentBlockNumber: number = null!;
  let isCurrentBlockRequestSuccessful = false;
  while (!isCurrentBlockRequestSuccessful) {
    try {
      const latestBlock = await provider.getBlock("latest");
      currentBlockNumber = latestBlock.number;
      isCurrentBlockRequestSuccessful = true;
    } catch (err) {
      logger.error(`Failed to fetch current block for chainId: ${chainId}`);
      isCurrentBlockRequestSuccessful = false;
    }
  }

  const requestedStartBlock = startBlock;
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

  const cachedBlockRange = await cacheStore.getCachedBlockRange(contracts);

  if (cachedBlockRange) {
    const { maxStartBlock, minEndBlock } = cachedBlockRange;

    const requiredRanges = p1_excluding_p2(
      [requestedStartBlock, requestedEndBlock],
      [maxStartBlock, minEndBlock]
    );

    for (const requiredRange of requiredRanges) {
      blockRanges.push(requiredRange);
    }
  } else {
    blockRanges.push([requestedStartBlock, requestedEndBlock]);
  }

  for (const source of sourceGroup.sources) {
    const metadata = await cacheStore.getContractMetadata(source.address);
    console.log({ metadata });

    stats.tableRows.push({
      "source name": source.name,
      "start block": source.startBlock,
      "end block": requestedEndBlock,
      "cache rate": `>99.9%`,
    });
  }

  stats.totalRequestedBlockCount += requestedEndBlock - requestedStartBlock;
  stats.totalFetchedBlockCount += blockRanges.reduce(
    (total, current) => total + current[1] - current[0],
    0
  );

  logger.debug({
    requestedRange: [requestedStartBlock, requestedEndBlock],
    cachedRange: cachedBlockRange
      ? [cachedBlockRange.maxStartBlock, cachedBlockRange.minEndBlock]
      : null,
    requiredRanges: blockRanges,
  });

  for (const blockRange of blockRanges) {
    const [startBlock, endBlock] = blockRange;
    let fromBlock = startBlock;
    let toBlock = Math.min(fromBlock + blockLimit, endBlock);

    while (fromBlock < endBlock) {
      historicalLogsRequestQueue.push({
        contractAddresses: contracts,
        fromBlock,
        toBlock,
      });

      fromBlock = toBlock + 1;
      toBlock = Math.min(fromBlock + blockLimit, endBlock);
    }
  }

  logger.debug("Waiting for the log request queue to clear...");
  logger.debug({
    logRequestQueueLength: historicalLogsRequestQueue.length(),
    logRequestQueueIdle: historicalLogsRequestQueue.idle(),
  });

  if (!historicalLogsRequestQueue.idle()) {
    await historicalLogsRequestQueue.drained();
  }

  logger.debug("Waiting for the block request queue to clear...");
  logger.debug({
    blockRequestQueueLength: historicalBlockRequestQueue.length(),
    blockRequestQueueIdle: historicalBlockRequestQueue.idle(),
  });

  if (!historicalBlockRequestQueue.idle()) {
    await historicalBlockRequestQueue.drained();
  }

  // Process live blocks, including any blocks that were fetched and enqueued during
  // the historical sync.
  liveBlockRequestQueue.resume();
};
