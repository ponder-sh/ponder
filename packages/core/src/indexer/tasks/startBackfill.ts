import type { Ponder } from "@/Ponder";

import { startBackfillForSource } from "./startBackfillForSource";

export const startBackfill = async ({
  ponder,
  blockNumberByNetwork,
}: {
  ponder: Ponder;
  blockNumberByNetwork: Record<string, number | undefined>;
}) => {
  const queueFuncs = await Promise.all(
    ponder.sources.map(async (source) => {
      const latestBlockNumber = blockNumberByNetwork[source.network.name];
      if (!latestBlockNumber) {
        throw new Error(
          `Internal error: latestBlockNumber not found for network: ${source.network.name}`
        );
      }

      const { killQueues, drainQueues } = await startBackfillForSource({
        ponder,
        source,
        latestBlockNumber,
      });

      return { killQueues, drainQueues };
    })
  );

  const killBackfillQueues = () => {
    queueFuncs.map((f) => f.killQueues());
  };

  const drainBackfillQueues = async () => {
    await Promise.all(queueFuncs.map((f) => f.drainQueues()));
  };

  return { killBackfillQueues, drainBackfillQueues };
};
