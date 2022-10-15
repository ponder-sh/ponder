import type { Log, StaticJsonRpcProvider } from "@ethersproject/providers";

import { logger } from "@/common/logger";
import { endBenchmark, startBenchmark } from "@/common/utils";
import { createLogQueue } from "@/core/indexer/logQueue";
import type { Handlers } from "@/core/readHandlers";
import type { PonderSchema } from "@/core/schema/types";
import type { Source } from "@/sources/base";
import type { CacheStore } from "@/stores/baseCacheStore";
import type { EntityStore } from "@/stores/baseEntityStore";

import { CachedProvider } from "./CachedProvider";
import { reindexSourceGroup } from "./reindexSourceGroup";
import { getPrettyPercentage, resetStats, stats } from "./stats";
import { getLogIndex } from "./utils";

export type SourceGroup = {
  chainId: number;
  provider: StaticJsonRpcProvider;
  contracts: string[];
  startBlock: number;
  blockLimit: number;
  sources: Source[];
};

export let isHotReload = false;
let previousProviders: CachedProvider[] = [];

export const handleReindex = async (
  cacheStore: CacheStore,
  entityStore: EntityStore,
  sources: Source[],
  schema: PonderSchema,
  userHandlers: Handlers
) => {
  let startHrt = startBenchmark();

  // Prepare user store.
  await entityStore.migrate(schema);

  // Prepare cache store.
  await cacheStore.migrate();

  // Unregister block listeners for stale providers.
  for (const provider of previousProviders) {
    provider.removeAllListeners();
  }
  previousProviders = [];

  // Indexing runs on a per-provider basis so we can batch eth_getLogs calls across contracts.
  const uniqueChainIds = [...new Set(sources.map((s) => s.chainId))];

  const cachedProvidersByChainId: Record<number, CachedProvider | undefined> =
    {};

  const sourceGroups: SourceGroup[] = uniqueChainIds.map((chainId) => {
    const sourcesInGroup = sources.filter((s) => s.chainId === chainId);

    const startBlock = Math.min(...sourcesInGroup.map((s) => s.startBlock));
    const blockLimit = Math.min(...sourcesInGroup.map((s) => s.blockLimit));
    const contractAddresses = sourcesInGroup.map((s) => s.address);

    let provider = cachedProvidersByChainId[chainId];
    if (!provider) {
      provider = new CachedProvider(
        cacheStore,
        sourcesInGroup[0].rpcUrl,
        chainId
      );
      cachedProvidersByChainId[chainId] = provider;
    }
    previousProviders.push(provider);

    return {
      chainId,
      provider,
      contracts: contractAddresses,
      startBlock,
      blockLimit,
      sources: sourcesInGroup,
    };
  });

  stats.sourceTotalCount = sources.length;
  for (const source of sources) {
    stats.sourceStats[source.name] = {
      matchedLogCount: 0,
      handledLogCount: 0,
    };
  }

  const logQueue = createLogQueue({
    cacheStore,
    entityStore,
    sources,
    schema,
    userHandlers,
    cachedProvidersByChainId,
  });
  logQueue.pause();

  if (!isHotReload) {
    logger.info(`\x1b[33m${`Starting historical sync...`}\x1b[0m`, "\n"); // yellow
  }

  const liveBlockRequestQueues = await Promise.all(
    sourceGroups.map((sourceGroup) =>
      reindexSourceGroup({ cacheStore, logQueue, sourceGroup })
    )
  );

  if (!isHotReload) {
    stats.progressBar.stop();
    logger.info(
      `\x1b[32m${`Historical sync complete (${endBenchmark(
        startHrt
      )})`}\x1b[0m`, // green
      "\n"
    );
  }
  startHrt = startBenchmark();

  logger.info(`\x1b[33m${`Processing logs...`}\x1b[0m`); // yellow

  let logsFromAllSources: Log[] = [];
  for (const sourceGroup of sourceGroups) {
    const logs = await cacheStore.getLogs(
      sourceGroup.contracts,
      sourceGroup.startBlock
    );
    logsFromAllSources = logsFromAllSources.concat(logs);
  }

  const sortedLogs = logsFromAllSources.sort(
    (a, b) => getLogIndex(a) - getLogIndex(b)
  );

  // Add sorted historical logs to the front of the queue (in reverse order).
  for (const log of sortedLogs.reverse()) {
    logQueue.unshift(log);
  }

  // Process historical logs (note the await).
  logQueue.resume();
  await logQueue.drained();

  logger.info(
    `\x1b[32m${`Log processing complete (${endBenchmark(startHrt)})`}\x1b[0m`, // green
    "\n"
  );

  for (const source of sources) {
    stats.resultsTable.addRow({
      "source name": source.name,
      "all logs": stats.sourceStats[source.name].matchedLogCount,
      "handled logs": stats.sourceStats[source.name].handledLogCount,
    });
  }

  logger.info("Log summary");
  logger.info(stats.resultsTable.render(), "\n");

  for (const [key, val] of Object.entries(stats.contractCallStats)) {
    const [chainId, address] = key.split("-");

    const source = sources.find(
      (s) =>
        String(s.chainId) === chainId &&
        s.address.toLowerCase() === address.toLowerCase()
    );

    stats.contractCallsTable.addRow({
      contract: `${address}${source && ` (${source.name})`}`,
      "call count": val.contractCallTotalCount,
      "cache hit rate": getPrettyPercentage(
        val.contractCallCacheHitCount,
        val.contractCallTotalCount
      ),
    });
  }

  logger.info("Contract call summary");
  logger.info(stats.contractCallsTable.render(), "\n");

  // Begin processing live blocks for all source groups. This includes
  // any blocks that were fetched and enqueued during the historical sync.
  liveBlockRequestQueues.forEach((queue) => queue.resume());

  resetStats();
  isHotReload = true;
};
