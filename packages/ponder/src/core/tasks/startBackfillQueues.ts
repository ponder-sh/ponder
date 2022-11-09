import { logger } from "@/common/logger";
import { endBenchmark, startBenchmark } from "@/common/utils";
import type { Ponder } from "@/core/Ponder";
import type { CacheStore } from "@/db/cacheStore";
import type { Source } from "@/sources/base";

import { startSourceBackfillQueues } from "./startSourceBackfillQueues";
import { stats } from "./stats";

export const startBackfillQueues = async ({
  cacheStore,
  sources,
  latestBlockNumberByNetwork,
  ponder,
}: {
  cacheStore: CacheStore;
  sources: Source[];
  latestBlockNumberByNetwork: Record<string, number | undefined>;
  ponder: Ponder;
}) => {
  const startHrt = startBenchmark();

  // Annoying stat logging boilerplate
  stats.sourceTotalCount = sources.length;
  for (const source of sources) {
    stats.sourceStats[source.name] = {
      matchedLogCount: 0,
      handledLogCount: 0,
    };
  }

  logger.info(`\x1b[33m${`Starting backfill...`}\x1b[0m`, "\n"); // yellow

  await Promise.all(
    sources.map(async (source) => {
      const latestBlockNumber = latestBlockNumberByNetwork[source.network.name];
      if (!latestBlockNumber) {
        throw new Error(
          `Internal error: latestBlockNumber not found for network: ${source.network.name}`
        );
      }

      await startSourceBackfillQueues({
        source,
        cacheStore,
        latestBlockNumber,
        ponder,
      });
    })
  );

  stats.syncProgressBar.stop();
  logger.info(
    `\x1b[32m${`Backfill complete (${endBenchmark(startHrt)})`}\x1b[0m`, // green
    "\n"
  );
};
