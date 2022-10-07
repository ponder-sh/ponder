import type { Log } from "@ethersproject/providers";
import type fastq from "fastq";

import { logger } from "@/common/logger";
import type { CacheStore } from "@/stores/baseCacheStore";

import { createHistoricalBlockRequestQueue } from "./historicalBlockRequestQueue";
import { createHistoricalLogsRequestQueue } from "./historicalLogsRequestQueue";
import { createLiveBlockRequestQueue } from "./liveBlockRequestQueue";
import type { SourceGroup } from "./reindex";
import { reindexStatistics } from "./reindex";

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
  });

  const historicalLogsRequestQueue = createHistoricalLogsRequestQueue({
    cacheStore,
    historicalBlockRequestQueue,
  });

  const liveBlockRequestQueue = createLiveBlockRequestQueue({
    cacheStore,
    logQueue,
  });

  // Store stuff for stat calcs.
  let totalRequestedBlockCount = 0;
  let cachedBlockCount = 0;

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

  console.log("got current block number:", { currentBlockNumber });

  const requestedStartBlock = startBlock;
  const requestedEndBlock = currentBlockNumber;
  totalRequestedBlockCount += requestedEndBlock - requestedStartBlock;

  // Build an array of block ranges that need to be fetched for this group of contracts.
  const blockRanges: { startBlock: number; endBlock: number }[] = [];

  const cachedBlockRange = await cacheStore.getCachedBlockRange(contracts);

  console.log({ requestedStartBlock, requestedEndBlock, cachedBlockRange });
  logger.debug({
    requestedStartBlock,
    requestedEndBlock,
    cachedBlockRange,
  });

  if (!cachedBlockRange) {
    blockRanges.push({
      startBlock: requestedStartBlock,
      endBlock: requestedEndBlock,
    });
  } else {
    const { maxStartBlock, minEndBlock } = cachedBlockRange;

    // If there is overlap between cached range and requested range
    if (requestedStartBlock < maxStartBlock) {
      blockRanges.push({
        startBlock: requestedStartBlock,
        endBlock: maxStartBlock,
      });
    }

    // This will basically always be true.
    if (requestedEndBlock > minEndBlock) {
      blockRanges.push({
        startBlock: minEndBlock,
        endBlock: requestedEndBlock,
      });
    }

    cachedBlockCount += minEndBlock - maxStartBlock;
  }

  logger.debug({ blockRanges });

  for (const blockRange of blockRanges) {
    const { startBlock, endBlock } = blockRange;
    let fromBlock = startBlock;
    let toBlock = Math.min(fromBlock + blockLimit, endBlock);

    while (fromBlock < endBlock) {
      historicalLogsRequestQueue.push({
        contractAddresses: contracts,
        fromBlock,
        toBlock,
        provider,
      });

      fromBlock = toBlock + 1;
      toBlock = Math.min(fromBlock + blockLimit, endBlock);
    }
  }

  if (totalRequestedBlockCount - cachedBlockCount > blockLimit) {
    logger.info(
      `\x1b[33m${`FETCHING LOGS IN ~${Math.round(
        totalRequestedBlockCount / blockLimit
      )}`} LOG BATCHES` // yellow
    );
  }

  reindexStatistics.cacheHitRate = cachedBlockCount / totalRequestedBlockCount;

  logger.debug({
    logRequestQueueLength: historicalLogsRequestQueue.length(),
    logRequestQueueIdle: historicalLogsRequestQueue.idle(),
    blockRequestQueueLength: historicalBlockRequestQueue.length(),
    blockRequestQueueIdle: historicalBlockRequestQueue.idle(),
  });

  if (!historicalLogsRequestQueue.idle()) {
    await historicalLogsRequestQueue.drained();
  }

  logger.debug({
    logRequestQueueLength: historicalLogsRequestQueue.length(),
    logRequestQueueIdle: historicalLogsRequestQueue.idle(),
    blockRequestQueueLength: historicalBlockRequestQueue.length(),
    blockRequestQueueIdle: historicalBlockRequestQueue.idle(),
  });

  if (!historicalBlockRequestQueue.idle()) {
    await historicalBlockRequestQueue.drained();
  }

  const historicalLogs = await cacheStore.getLogs(contracts, startBlock);

  const getLogIndex = (log: Log) =>
    Number(log.blockNumber) * 10000 + Number(log.logIndex);
  const sortedLogs = historicalLogs.sort(
    (a, b) => getLogIndex(a) - getLogIndex(b)
  );

  // Add sorted historical logs to the front of the queue (in reverse order).
  for (let i = sortedLogs.length - 1; i >= 0; i--) {
    const log = sortedLogs[i];
    logQueue.unshift(log);
  }

  logger.debug(
    `Running user handlers against ${sortedLogs.length} historical logs`
  );

  // Process historical logs (note the await).
  logQueue.resume();
  await logQueue.drained();

  provider.on("block", (blockNumber: number) => {
    liveBlockRequestQueue.push({ blockNumber, sourceGroup });
  });
};
