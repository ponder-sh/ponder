import type { Ponder } from "@/Ponder";

import { createBlockFrontfillQueue } from "../queues/blockFrontfillQueue";

export const startFrontfill = ({ ponder }: { ponder: Ponder }) => {
  const killQueueFuncs = ponder.frontfillNetworks.map((frontfillNetwork) => {
    const { network, latestBlockNumber } = frontfillNetwork;

    const contractAddresses = ponder.contracts
      .filter((contract) => contract.network.name === network.name)
      .map((contract) => contract.address);

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
  });

  const killFrontfillQueues = () => {
    killQueueFuncs.forEach((c) => c());
  };

  return { killFrontfillQueues };
};
