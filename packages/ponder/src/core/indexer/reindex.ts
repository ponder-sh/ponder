import type { Log, StaticJsonRpcProvider } from "@ethersproject/providers";

import { logger } from "@/common/logger";
import { endBenchmark, startBenchmark } from "@/common/utils";
import { createLogQueue } from "@/core/indexer/logQueue";
import type { Handlers } from "@/core/readHandlers";
import type { PonderSchema } from "@/core/schema/types";
import type { Source } from "@/sources/base";
import type { CacheStore } from "@/stores/baseCacheStore";
import type { EntityStore } from "@/stores/baseEntityStore";

import { reindexSourceGroup } from "./reindexSourceGroup";
import { printStats, resetStats, stats } from "./stats";
import { getLogIndex } from "./utils";

export type SourceGroup = {
  chainId: number;
  provider: StaticJsonRpcProvider;
  contracts: string[];
  startBlock: number;
  blockLimit: number;
  sources: Source[];
};

let isInitialIndexing = true;

export const handleReindex = async (
  cacheStore: CacheStore,
  entityStore: EntityStore,
  sources: Source[],
  schema: PonderSchema,
  userHandlers: Handlers
) => {
  const startHrt = startBenchmark();
  if (isInitialIndexing) {
    logger.info(`\x1b[33m${`Fetching historical data...`}\x1b[0m`); // yellow
  }

  // Prepare user store.
  await entityStore.migrate(schema);

  // Prepare cache store.
  await cacheStore.migrate();

  // Indexing runs on a per-provider basis so we can batch eth_getLogs calls across contracts.
  const uniqueChainIds = [...new Set(sources.map((s) => s.chainId))];
  const sourceGroups: SourceGroup[] = uniqueChainIds.map((chainId) => {
    const sourcesInGroup = sources.filter((s) => s.chainId === chainId);

    const startBlock = Math.min(...sourcesInGroup.map((s) => s.startBlock));
    const blockLimit = Math.min(...sourcesInGroup.map((s) => s.blockLimit));
    const contractAddresses = sourcesInGroup.map((s) => s.address);

    return {
      chainId,
      provider: sourcesInGroup[0].provider,
      contracts: contractAddresses,
      startBlock,
      blockLimit,
      sources: sourcesInGroup,
    };
  });

  const logQueue = createLogQueue({
    cacheStore,
    entityStore,
    sources,
    schema,
    userHandlers,
  });
  logQueue.pause();

  await Promise.all(
    sourceGroups.map((sourceGroup) =>
      reindexSourceGroup({ cacheStore, logQueue, sourceGroup })
    )
  );

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

  logger.debug(
    `Running user handlers against ${sortedLogs.length} historical logs`
  );

  // Process historical logs (note the await).
  logQueue.resume();
  await logQueue.drained();

  const diff = endBenchmark(startHrt);

  printStats({ duration: diff });

  // if (isInitialIndexing) {
  //   logger.info(
  //     `\x1b[32m${`Historical sync complete ${statsString}`}\x1b[0m`, // green
  //     "\n"
  //   );
  // } else {
  //   logger.info(
  //     `\x1b[32m${`Reload complete ${statsString}`}\x1b[0m`, // green
  //     "\n"
  //   );
  // }

  resetStats();
  isInitialIndexing = false;
};
