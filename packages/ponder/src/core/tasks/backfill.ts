import { logger } from "@/common/logger";
import { endBenchmark, startBenchmark } from "@/common/utils";
import type { CacheStore } from "@/db/cacheStore";
import type { Source } from "@/sources/base";

import { backfillSource } from "./backfillSource";
import { stats } from "./stats";

export const backfill = async ({
  cacheStore,
  sources,
  latestBlockNumberByNetwork,
  isHotReload,
}: {
  cacheStore: CacheStore;
  sources: Source[];
  latestBlockNumberByNetwork: Record<string, number | undefined>;
  isHotReload: boolean;
}) => {
  const startHrt = startBenchmark();

  await cacheStore.migrate();

  // Annoying stat logging boilerplate
  stats.sourceTotalCount = sources.length;
  for (const source of sources) {
    stats.sourceStats[source.name] = {
      matchedLogCount: 0,
      handledLogCount: 0,
    };
  }

  if (!isHotReload) {
    logger.info(`\x1b[33m${`Starting backfill...`}\x1b[0m`, "\n"); // yellow
  }

  await Promise.all(
    sources.map(async (source) => {
      const latestBlockNumber = latestBlockNumberByNetwork[source.network.name];
      if (!latestBlockNumber) {
        throw new Error(
          `Internal error: latestBlockNumber not found for network: ${source.network.name}`
        );
      }

      await backfillSource({
        source,
        cacheStore,
        latestBlockNumber,
        isHotReload,
      });
    })
  );

  if (!isHotReload) {
    stats.syncProgressBar.stop();
    logger.info(
      `\x1b[32m${`Backfill complete (${endBenchmark(startHrt)})`}\x1b[0m`, // green
      "\n"
    );
  }
};
