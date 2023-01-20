import type { EvmNetwork } from "@/config/networks";
import type { Ponder } from "@/Ponder";

export const getLatestBlockForNetwork = async ({
  network,
  ponder,
}: {
  network: EvmNetwork;
  ponder: Ponder;
}) => {
  // Kinda weird but should work to make sure this RPC request gets done
  let latestBlockRequestCount = 0;
  let latestBlockNumber: number | null = null;
  let latestBlockTimestamp: number | null = null;

  while (latestBlockNumber === null || latestBlockTimestamp === null) {
    try {
      const latestBlock = await network.provider.getBlock("latest");
      latestBlockNumber = latestBlock.number;
      latestBlockTimestamp = latestBlock.timestamp;
    } catch (err) {
      ponder.logger.warn(
        `Failed to fetch latest block for network [${network.name}], retrying...`
      );
      latestBlockRequestCount += 1;
      if (latestBlockRequestCount > 5) {
        ponder.logger.error(`Unable to get latest block after 5 retries:`);
        throw err;
      }
    }
  }

  ponder.emit("backfill_networkConnected", {
    network: network.name,
    blockNumber: latestBlockNumber,
    blockTimestamp: latestBlockTimestamp,
  });

  return latestBlockNumber;
};
