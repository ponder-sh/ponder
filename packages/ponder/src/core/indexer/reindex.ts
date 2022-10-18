import { logger } from "@/common/logger";
import { endBenchmark, startBenchmark } from "@/common/utils";
import { createLogQueue } from "@/core/indexer/logQueue";
import type { Handlers } from "@/core/readHandlers";
import type { PonderSchema } from "@/core/schema/types";
import type { Source } from "@/sources/base";
import type { CacheStore } from "@/stores/baseCacheStore";
import type { EntityStore } from "@/stores/baseEntityStore";
import type { CachedLog } from "@/stores/utils";

import type { CachedProvider } from "./CachedProvider";
import { createLiveBlockRequestQueue } from "./liveBlockRequestQueue";
import { reindexSource } from "./reindexSource";
import { getPrettyPercentage, resetStats, stats } from "./stats";

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

  await entityStore.migrate(schema);
  await cacheStore.migrate();

  // Unregister block listeners for stale providers.
  for (const provider of previousProviders) {
    provider.removeAllListeners();
  }
  previousProviders = [];
  for (const source of sources) {
    previousProviders.push(source.network.provider);
  }

  // Annoying stat logging boilerplate
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
  });
  logQueue.pause();

  if (!isHotReload) {
    logger.info(`\x1b[33m${`Starting historical sync...`}\x1b[0m`, "\n"); // yellow
  }

  const uniqueNetworks = [
    ...new Map(sources.map((s) => s.network).map((n) => [n.name, n])).values(),
  ];

  const liveBlockRequestQueueInfos = await Promise.all(
    uniqueNetworks.map(async (network) => {
      const contractAddresses = sources
        .filter((s) => s.network.name === network.name)
        .map((source) => source.address);

      // Kinda weird but should work to make sure this RPC request gets done
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      let currentBlockNumber: number = null!;
      let isCurrentBlockRequestSuccessful = false;
      while (!isCurrentBlockRequestSuccessful) {
        try {
          const latestBlock = await network.provider.getBlock("latest");
          currentBlockNumber = latestBlock.number;
          isCurrentBlockRequestSuccessful = true;
        } catch (err) {
          logger.error(
            `Failed to fetch current block for network [${network.name}], retrying...`
          );
          isCurrentBlockRequestSuccessful = false;
        }
      }

      const liveBlockRequestQueue = createLiveBlockRequestQueue({
        cacheStore,
        network,
        contractAddresses,
        logQueue,
      });

      // Pause the live block request queue, but begin adding tasks to it.
      // Once the historical sync is complete, unpause it to process the backlog of
      // tasks that were added during historical sync + new live logs.
      liveBlockRequestQueue.pause();
      network.provider.on("block", (blockNumber: number) => {
        liveBlockRequestQueue.push({ blockNumber });
      });

      return {
        networkName: network.name,
        currentBlockNumber,
        liveBlockRequestQueue,
      };
    })
  );

  await Promise.all(
    sources.map(async (source) => {
      const liveBlockRequestQueueInfo = liveBlockRequestQueueInfos.find(
        (info) => info.networkName === source.network.name
      );
      if (!liveBlockRequestQueueInfo) {
        throw new Error(
          `Internal error: liveBlockRequestQueueInfo not found for network name: ${source.network.name}`
        );
      }
      const { currentBlockNumber, liveBlockRequestQueue } =
        liveBlockRequestQueueInfo;

      await reindexSource({
        source,
        cacheStore,
        currentBlockNumber,
        liveBlockRequestQueue,
      });
    })
  );

  if (!isHotReload) {
    stats.syncProgressBar.stop();
    logger.info(
      `\x1b[32m${`Historical sync complete (${endBenchmark(
        startHrt
      )})`}\x1b[0m`, // green
      "\n"
    );
  }
  startHrt = startBenchmark();

  logger.info(`\x1b[33m${`Processing logs...`}\x1b[0m`); // yellow

  let logsFromAllSources: CachedLog[] = [];
  for (const source of sources) {
    const logs = await cacheStore.getLogs([source.address], source.startBlock);
    logsFromAllSources = logsFromAllSources.concat(logs);
  }

  stats.processingProgressBar.start(logsFromAllSources.length, 0);

  const sortedLogs = logsFromAllSources.sort(
    (a, b) => a.logSortKey - b.logSortKey
  );

  // Add sorted historical logs to the front of the queue (in reverse order).
  for (const log of sortedLogs.reverse()) {
    logQueue.unshift({ log });
  }

  logQueue.resume();
  // fastq has a strange quirk where, if no tasks have been added to the queue,
  // the drained() method will hang and never resolve. Checking that the queue is
  // not idle() before awaiting drained() seems to solve this issue.
  if (!logQueue.idle()) {
    await logQueue.drained();
  }

  stats.processingProgressBar.stop();

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
        String(s.network.chainId) === chainId &&
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

  if (Object.keys(stats.contractCallStats).length > 0) {
    logger.info("Contract call summary");
    logger.info(stats.contractCallsTable.render(), "\n");
  }

  // Begin processing live blocks for all source groups. This includes
  // any blocks that were fetched and enqueued during the historical sync.
  liveBlockRequestQueueInfos.forEach((info) => {
    info.liveBlockRequestQueue.resume();
  });

  resetStats();
  isHotReload = true;
};
