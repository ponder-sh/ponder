import type { JsonRpcProvider, Log } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import fastq from "fastq";

import { logger } from "@/common/logger";
import type { LogWorker } from "@/core/buildLogWorker";
import { Source } from "@/sources/base";

import { readLogCache, writeLogCache } from "./cache";
import { fetchLogs } from "./fetchLogs";

type LogQueue = fastq.queueAsPromised<Log>;

type LogGroup = {
  chainId: number;
  provider: JsonRpcProvider;
  contracts: string[];
  startBlock: number;
  cacheKey: string;
};

const executeLogs = async (sources: Source[], logWorker: LogWorker) => {
  // Indexing runs on a per-provider basis so we can batch eth_getLogs calls across contracts.
  const uniqueChainIds = [...new Set(sources.map((s) => s.chainId))];
  const logGroups: LogGroup[] = uniqueChainIds.map((chainId) => {
    const sourcesInGroup = sources.filter((s) => s.chainId === chainId);

    const startBlock = Math.min(
      ...sourcesInGroup.map((s) => s.startBlock || 0)
    );
    const contractAddresses = sourcesInGroup.map((source) => source.address);

    const cacheKey = `${chainId}_${startBlock}${contractAddresses.map(
      (contract) => `-${contract}`
    )}`;

    return {
      chainId,
      provider: sourcesInGroup[0].provider,
      contracts: contractAddresses,
      startBlock,
      cacheKey,
    };
  });

  // Read cached logs from disk.
  const logCache = await readLogCache();

  // Create a queue which we will add logs to (paused at first).
  const queue = fastq.promise(logWorker, 1);
  queue.pause();

  for (const logGroup of logGroups) {
    const { provider, contracts, cacheKey } = logGroup;

    // Call eth_newFilter for all events emitted by the specified contracts.
    const { filterStartBlock, filterId } = await createNewFilter(logGroup);

    // Register a block listener that adds new logs to the queue.
    registerBlockListener(logGroup, filterId, queue);

    // Get cached log data for this source (may be empty/undefined).
    const cachedLogData = logCache[cacheKey];
    const cachedLogs = cachedLogData?.logs || [];

    if (cachedLogs.length > 0) {
      logger.info(
        `\x1b[34m${`LOADED ${cachedLogs.length} LOGS FROM CACHE`}\x1b[0m`
      ); // green
    }

    // If there are cached logs, pick up where they leave off.
    const fromBlock = cachedLogData
      ? cachedLogData.toBlock
      : logGroup.startBlock;

    // Get logs between the end of the cached logs and the beginning of the active filter.
    const toBlock = filterStartBlock;
    const { logs: newLogs, requestCount } = await fetchLogs(
      provider,
      contracts,
      fromBlock,
      toBlock
    );

    if (newLogs.length > 0) {
      logger.info(
        `\x1b[35m${`FETCHED FROM RPC: ${newLogs.length} LOGS IN ${requestCount} REQUESTS`}\x1b[0m`
      ); // magenta
    }

    // Combine cached logs and new logs to get the full list of historical logs.
    // TODO: De-dupe and validate some shit probably?
    const historicalLogs = [...(cachedLogData?.logs || []), ...newLogs];

    // Add the full list of historical logs to the cache.
    logCache[cacheKey] = {
      fromBlock: fromBlock,
      toBlock: filterStartBlock,
      logs: historicalLogs,
    };
  }

  // Side effect: Now that the historical logs have been fetched
  // for all sources, write the updated log cache to disk. Don't await.
  await writeLogCache(logCache);

  // Combine and sort logs from all sources.
  // Filter out logs present in the cache that are not part of the current set of logs.
  const latestRunCacheKeys = new Set(logGroups.map((p) => p.cacheKey));
  const sortedLogsForAllSources = Object.entries(logCache)
    .filter(([cacheKey]) => latestRunCacheKeys.has(cacheKey))
    .map(([, logData]) => logData?.logs || [])
    .flat()
    .sort((a, b) => getLogIndex(a) - getLogIndex(b));

  // Add sorted historical logs to the front of the queue (in reverse order).
  for (let i = sortedLogsForAllSources.length - 1; i >= 0; i--) {
    const log = sortedLogsForAllSources[i];
    queue.unshift(log);
  }

  // Begin processing logs in the correct order.
  queue.resume();

  // NOTE: Wait the queue to be drained to allow callers to take action once
  // all historical logs have been fetched and processed (indexing is complete).
  await queue.drained();

  return {
    logCount: sortedLogsForAllSources.length,
  };
};

const createNewFilter = async (logGroup: LogGroup) => {
  const { provider, contracts } = logGroup;

  const latestBlock = await provider.getBlock("latest");
  const filterStartBlock = latestBlock.number;

  const filterId: string = await provider.send("eth_newFilter", [
    {
      fromBlock: BigNumber.from(filterStartBlock).toHexString(),
      address: contracts,
    },
  ]);

  return { filterStartBlock, filterId };
};

const blockHandlers: { [key: string]: () => Promise<void> | undefined } = {};

const registerBlockListener = (
  logGroup: LogGroup,
  filterId: string,
  queue: LogQueue
) => {
  const { cacheKey, provider } = logGroup;

  // If a block listener was already registered for this provider, remove it.
  const oldBlockHandler = blockHandlers[cacheKey];
  if (oldBlockHandler) {
    provider.off("block", oldBlockHandler);
  }

  // TODO: Fix suspected issue where if the user starts and then stops using a given provider/chainId
  // during hot reloading, the stale provider's listeners never get un-registered.
  // This happens because this code only un-registers stale listeners for the current set of logGroups.

  const blockHandler = async () => {
    const logs: Log[] = await provider.send("eth_getFilterChanges", [filterId]);
    logs.forEach(queue.push);
  };
  provider.on("block", blockHandler);

  blockHandlers[cacheKey] = blockHandler;
};

const getLogIndex = (log: Log) => {
  return Number(log.blockNumber) * 10000 + Number(log.logIndex);
};

export { executeLogs };
