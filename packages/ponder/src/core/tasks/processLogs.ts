import { logger } from "@/common/logger";
import type { EventLog } from "@/common/types";
import { endBenchmark, startBenchmark } from "@/common/utils";
import type { HandlerQueue } from "@/core/queues/handlerQueue";
import type { CacheStore } from "@/db/cacheStore";
import type { Source } from "@/sources/base";

import { getPrettyPercentage, resetStats, stats } from "./stats";

export const processLogs = async ({
  sources,
  cacheStore,
  handlerQueue,
}: {
  sources: Source[];
  cacheStore: CacheStore;
  handlerQueue: HandlerQueue;
}) => {
  const startHrt = startBenchmark();

  logger.info(`\x1b[33m${`Processing logs...`}\x1b[0m`); // yellow

  let logsFromAllSources: EventLog[] = [];
  for (const source of sources) {
    const logs = await cacheStore.getLogs([source.address], source.startBlock);
    logsFromAllSources = logsFromAllSources.concat(logs);
  }

  stats.processingProgressBar.start(logsFromAllSources.length, 0);

  const sortedLogs = logsFromAllSources.sort(
    (a, b) => a.logSortKey - b.logSortKey
  );

  // Add sorted logs to the front of the queue (in reverse order).
  for (const log of sortedLogs.reverse()) {
    handlerQueue.unshift({ log });
  }

  handlerQueue.resume();
  // fastq has a strange quirk where, if no tasks have been added to the queue,
  // the drained() method will hang and never resolve. Checking that the queue is
  // not idle() before awaiting drained() seems to solve this issue.
  if (!handlerQueue.idle()) {
    await handlerQueue.drained();
  }

  stats.processingProgressBar.stop();

  logger.info(
    `\x1b[32m${`Log processing complete (${endBenchmark(startHrt)})`}\x1b[0m`, // green
    "\n"
  );

  for (const source of sources) {
    if (!stats.sourceStats[source.name]) {
      stats.sourceStats[source.name] = {
        matchedLogCount: 0,
        handledLogCount: 0,
      };
    }

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

  resetStats();
};
