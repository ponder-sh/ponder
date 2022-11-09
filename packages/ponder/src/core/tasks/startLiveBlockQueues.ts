import { logger } from "@/common/logger";
import type { Ponder } from "@/core/Ponder";

import type { CachedProvider } from "../../networks/CachedProvider";
import { createBlockFrontfillQueue } from "../queues/blockFrontfillQueue";

let previousProviders: CachedProvider[] = [];

export const startLiveBlockQueues = async ({ ponder }: { ponder: Ponder }) => {
  // Unregister block listeners for stale providers.
  for (const provider of previousProviders) {
    provider.removeAllListeners();
  }
  previousProviders = [];
  for (const source of ponder.sources) {
    previousProviders.push(source.network.provider);
  }

  const uniqueNetworks = [
    ...new Map(
      ponder.sources.map((s) => s.network).map((n) => [n.name, n])
    ).values(),
  ];

  const latestBlockNumberByNetwork: Record<string, number | undefined> = {};

  const liveNetworkStatuses = await Promise.all(
    uniqueNetworks.map(async (network) => {
      const contractAddresses = ponder.sources
        .filter((s) => s.network.name === network.name)
        .map((source) => source.address);

      // Kinda weird but should work to make sure this RPC request gets done
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      let latestBlockNumber: number = null!;
      let isLatestBlockRequestSuccessful = false;
      while (!isLatestBlockRequestSuccessful) {
        try {
          const latestBlock = await network.provider.getBlock("latest");
          latestBlockNumber = latestBlock.number;
          isLatestBlockRequestSuccessful = true;
        } catch (err) {
          logger.error(
            `Failed to fetch latest block for network [${network.name}], retrying...`
          );
          isLatestBlockRequestSuccessful = false;
        }
      }

      latestBlockNumberByNetwork[network.name] = latestBlockNumber;

      const liveBlockRequestQueue = createBlockFrontfillQueue({
        ponder,
        network,
        contractAddresses,
      });

      // Pause the live block request queue, but begin adding tasks to it.
      // Once the backfill is complete, unpause it to process the backlog of
      // tasks that were added during backfill + new live logs.
      liveBlockRequestQueue.pause();
      network.provider.on("block", (blockNumber: number) => {
        // Messy way to avoid double-processing latestBlockNumber.
        // Also noticed taht this approach sometimes skips the block
        // immediately after latestBlockNumber.
        if (blockNumber > latestBlockNumber) {
          liveBlockRequestQueue.push({ blockNumber });
        }
      });

      return {
        networkName: network.name,
        latestBlockNumber,
        liveBlockRequestQueue,
      };
    })
  );

  const resumeLiveBlockQueues = () => {
    // Begin processing live blocks for all source groups. This includes
    // any blocks that were fetched and enqueued during the backfill.
    liveNetworkStatuses.forEach((status) => {
      status.liveBlockRequestQueue.resume();
    });
  };

  return {
    latestBlockNumberByNetwork,
    resumeLiveBlockQueues,
  };
};
