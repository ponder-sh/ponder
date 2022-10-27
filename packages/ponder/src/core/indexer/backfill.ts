import { logger } from "@/common/logger";
import { endBenchmark, startBenchmark } from "@/common/utils";
import type { LogQueue } from "@/core/indexer/logQueue";
import type { CacheStore } from "@/db/cacheStore";
import type { Source } from "@/sources/base";

import { backfillSource } from "./backfillSource";
import type { CachedProvider } from "./CachedProvider";
import {
  createLiveBlockRequestQueue,
  LiveBlockRequestQueue,
} from "./liveBlockRequestQueue";
import { stats } from "./stats";

let previousProviders: CachedProvider[] = [];

export interface LiveNetworkInfo {
  networkName: string;
  currentBlockNumber: number;
  liveBlockRequestQueue: LiveBlockRequestQueue;
}

export const backfill = async ({
  cacheStore,
  sources,
  logQueue,
  isHotReload,
}: {
  cacheStore: CacheStore;
  sources: Source[];
  logQueue: LogQueue;
  isHotReload: boolean;
}) => {
  const startHrt = startBenchmark();

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

  if (!isHotReload) {
    logger.info(`\x1b[33m${`Starting backfill...`}\x1b[0m`, "\n"); // yellow
  }

  const uniqueNetworks = [
    ...new Map(sources.map((s) => s.network).map((n) => [n.name, n])).values(),
  ];

  const liveNetworkInfos: LiveNetworkInfo[] = await Promise.all(
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
      // Once the backfill is complete, unpause it to process the backlog of
      // tasks that were added during historical sync + new live logs.
      liveBlockRequestQueue.pause();
      network.provider.on("block", (blockNumber: number) => {
        // Messy way to avoid double-processing currentBlockNumber.
        // Also noticed taht this approach sometimes skips the block
        // immediately after currentBlockNumber.
        if (blockNumber > currentBlockNumber) {
          liveBlockRequestQueue.push({ blockNumber });
        }
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
      const liveBlockRequestQueueInfo = liveNetworkInfos.find(
        (info) => info.networkName === source.network.name
      );
      if (!liveBlockRequestQueueInfo) {
        throw new Error(
          `Internal error: liveBlockRequestQueueInfo not found for network name: ${source.network.name}`
        );
      }
      const { currentBlockNumber } = liveBlockRequestQueueInfo;

      await backfillSource({
        source,
        cacheStore,
        currentBlockNumber,
        isHotReload,
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

  const startLiveIndexing = () => {
    // Begin processing live blocks for all source groups. This includes
    // any blocks that were fetched and enqueued during the backfill.
    liveNetworkInfos.forEach((info) => {
      info.liveBlockRequestQueue.resume();
    });
  };

  return {
    startLiveIndexing,
  };
};
