import { logger } from "@/common/logger";
import type { Ponder } from "@/Ponder";

import { createBlockFrontfillQueue } from "../queues/blockFrontfillQueue";

export const startFrontfill = async ({ ponder }: { ponder: Ponder }) => {
  const uniqueNetworks = [
    ...new Map(
      ponder.sources.map((s) => s.network).map((n) => [n.name, n])
    ).values(),
  ];

  const latestBlockNumberByNetwork: Record<string, number | undefined> = {};

  await Promise.all(
    uniqueNetworks.map(async (network) => {
      const contractAddresses = ponder.sources
        .filter((s) => s.network.name === network.name)
        .map((source) => source.address);

      // Kinda weird but should work to make sure this RPC request gets done
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
          isLatestBlockRequestSuccessful = false;
        }
      }

      ponder.emit("newNetworkConnected", {
        network: network.name,
        blockNumber: latestBlockNumber,
        blockTimestamp: latestBlockTimestamp,
      });

      latestBlockNumberByNetwork[network.name] = latestBlockNumber;

      const liveBlockRequestQueue = createBlockFrontfillQueue({
        ponder,
        network,
        contractAddresses,
      });

      // Pause the live block request queue, but begin adding tasks to it.
      // Once the backfill is complete, unpause it to process the backlog of
      // tasks that were added during backfill + new live logs.
      // liveBlockRequestQueue.pause();
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

  return {
    latestBlockNumberByNetwork,
  };
};
