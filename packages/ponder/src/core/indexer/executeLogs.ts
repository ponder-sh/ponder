import type { Log, StaticJsonRpcProvider } from "@ethersproject/providers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { LogWorker } from "@/core/indexer/buildLogWorker";
import type { Source } from "@/sources/base";

import { cacheStore } from "./cacheStore";
import { createNewFilter } from "./createNewFilter";
import { blockRequestQueue } from "./fetchBlock";
import { logRequestQueue } from "./fetchLogs";
import { reindexStatistics } from "./reindex";

export type LogGroup = {
  chainId: number;
  provider: StaticJsonRpcProvider;
  contracts: string[];
  startBlock: number;
};

const BLOCK_LIMIT = 2_000;

const executeLogs = async (sources: Source[], logWorker: LogWorker) => {
  // Indexing runs on a per-provider basis so we can batch eth_getLogs calls across contracts.
  const uniqueChainIds = [...new Set(sources.map((s) => s.chainId))];
  const logGroups: LogGroup[] = uniqueChainIds.map((chainId) => {
    const sourcesInGroup = sources.filter((s) => s.chainId === chainId);

    const startBlock = Math.min(...sourcesInGroup.map((s) => s.startBlock));
    const contractAddresses = sourcesInGroup.map((s) => s.address);

    return {
      chainId,
      provider: sourcesInGroup[0].provider,
      contracts: contractAddresses,
      startBlock,
    };
  });

  // Create a queue for historical logs.
  const historicalLogQueue = fastq.promise(logWorker, 1);
  historicalLogQueue.pause();

  // Create a queue for live logs.
  const liveLogQueue = fastq.promise(logWorker, 1);
  liveLogQueue.pause();

  // Store stuff for stat calcs.
  let totalRequestedBlockCount = 0;
  let cachedBlockCount = 0;

  // Kick off log requests for each log group.
  for (const logGroup of logGroups) {
    const { provider, contracts } = logGroup;

    // Call eth_newFilter for all events emitted by the specified contracts.
    const { filterStartBlock } = await createNewFilter(logGroup, liveLogQueue);

    const requestedStartBlock = logGroup.startBlock;
    const requestedEndBlock = filterStartBlock;
    totalRequestedBlockCount += requestedEndBlock - requestedStartBlock;

    // Build an array of block ranges that need to be fetched for this group of contracts.
    const blockRanges: { startBlock: number; endBlock: number }[] = [];

    const cachedBlockRange = await cacheStore.getCachedBlockRange(contracts);

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
      let toBlock = Math.min(fromBlock + BLOCK_LIMIT, endBlock);

      while (fromBlock < endBlock) {
        logRequestQueue.push({
          contractAddresses: contracts,
          fromBlock,
          toBlock,
          provider,
        });

        fromBlock = toBlock + 1;
        toBlock = Math.min(fromBlock + BLOCK_LIMIT, endBlock);
      }
    }
  }

  if (totalRequestedBlockCount - cachedBlockCount > 2000) {
    logger.info(
      `\x1b[33m${`FETCHING LOGS IN ~${Math.round(
        totalRequestedBlockCount / BLOCK_LIMIT
      )}`} LOG BATCHES` // yellow
    );
  }

  reindexStatistics.cacheHitRate = cachedBlockCount / totalRequestedBlockCount;

  logger.debug({
    logQueueLength: logRequestQueue.length(),
    logQueueIdle: logRequestQueue.idle(),
    blockQueueLength: blockRequestQueue.length(),
    blockQueueIdle: blockRequestQueue.idle(),
  });

  if (!logRequestQueue.idle()) {
    await logRequestQueue.drained();
  }

  logger.debug({
    logQueueLength: logRequestQueue.length(),
    logQueueIdle: logRequestQueue.idle(),
    blockQueueLength: blockRequestQueue.length(),
    blockQueueIdle: blockRequestQueue.idle(),
  });

  if (!blockRequestQueue.idle()) {
    await blockRequestQueue.drained();
  }

  // Get logs from cache.
  const logs: Log[] = [];
  await Promise.all(
    logGroups.map(async (group) => {
      const historicalLogs = await cacheStore.getLogs(
        group.contracts,
        group.startBlock
      );
      logs.push(...historicalLogs);
    })
  );

  // Combine and sort logs from all sources.
  // Filter out logs present in the cache that are not part of the current set of logs.
  const getLogIndex = (log: Log) =>
    Number(log.blockNumber) * 10000 + Number(log.logIndex);
  const sortedLogs = logs.sort((a, b) => getLogIndex(a) - getLogIndex(b));

  // Add sorted historical logs to the front of the queue (in reverse order).
  for (let i = sortedLogs.length - 1; i >= 0; i--) {
    const log = sortedLogs[i];
    historicalLogQueue.unshift(log);
  }

  logger.debug(
    `Running user handlers against ${historicalLogQueue.length()} historical logs`
  );

  // Process historical logs (note the await).
  historicalLogQueue.resume();
  await historicalLogQueue.drained();

  liveLogQueue.resume();

  return {
    logCount: sortedLogs.length,
  };
};

export { executeLogs };
