import { endBenchmark, startBenchmark } from "@/common/utils";
import type { Ponder } from "@/Ponder";

import { startBackfillForSource } from "./startBackfillForSource";

export const startBackfill = async ({
  ponder,
  latestBlockNumberByNetwork,
}: {
  ponder: Ponder;
  latestBlockNumberByNetwork: Record<string, number | undefined>;
}) => {
  const startHrt = startBenchmark();

  await Promise.all(
    ponder.sources.map(async (source) => {
      const latestBlockNumber = latestBlockNumberByNetwork[source.network.name];
      if (!latestBlockNumber) {
        throw new Error(
          `Internal error: latestBlockNumber not found for network: ${source.network.name}`
        );
      }

      await startBackfillForSource({
        ponder,
        source,
        latestBlockNumber,
      });
    })
  );

  const duration = endBenchmark(startHrt);

  return { duration };
};
