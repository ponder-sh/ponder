import { logger } from "@/common/logger";
import type { Ponder } from "@/Ponder";

import { createBlockFrontfillQueue } from "../queues/blockFrontfillQueue";

export const startFrontfill = async ({ ponder }: { ponder: Ponder }) => {
  const uniqueNetworks = [
    ...new Map(
      ponder.sources.map((s) => s.network).map((n) => [n.name, n])
    ).values(),
  ];

  const blockNumberByNetwork: Record<string, number | undefined> = {};

  const killQueueFuncs = await Promise.all(
    uniqueNetworks.map(async (network) => {
      const contractAddresses = ponder.sources
        .filter((s) => s.network.name === network.name)
        .map((source) => source.address);

      // Kinda weird but should work to make sure this RPC request gets done
      let latestBlockRequestCount = 0;
      let isLatestBlockRequestSuccessful = false;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      let latestBlockNumber: number = null!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      let latestBlockTimestamp: number = null!;

      while (!isLatestBlockRequestSuccessful) {
        try {
          const latestBlock = await network.provider.getBlock("latest");
          latestBlockNumber = latestBlock.number;
          latestBlockTimestamp = latestBlock.timestamp;

          isLatestBlockRequestSuccessful = true;
        } catch (err) {
          logger.warn(
            `Failed to fetch latest block for network [${network.name}], retrying...`
          );
          latestBlockRequestCount += 1;
          if (latestBlockRequestCount > 5) {
            logger.error(`Unable to get latest block after 5 retries:`);
            throw err;
          }
        }
      }

      ponder.emit("newNetworkConnected", {
        network: network.name,
        blockNumber: latestBlockNumber,
        blockTimestamp: latestBlockTimestamp,
      });

      blockNumberByNetwork[network.name] = latestBlockNumber;

      const liveBlockRequestQueue = createBlockFrontfillQueue({
        ponder,
        network,
        contractAddresses,
      });

      const blockListener = (blockNumber: number) => {
        // Messy way to avoid double-processing latestBlockNumber.
        // Also noticed taht this approach sometimes skips the block
        // immediately after latestBlockNumber.
        if (blockNumber > latestBlockNumber) {
          liveBlockRequestQueue.push({ blockNumber });
        }
      };

      network.provider.on("block", blockListener);

      const killQueue = () => {
        liveBlockRequestQueue.kill();
        network.provider.off("block", blockListener);
      };

      return killQueue;
    })
  );

  const killFrontfillQueues = () => {
    killQueueFuncs.forEach((c) => c());
  };

  return {
    blockNumberByNetwork,
    killFrontfillQueues,
  };
};
