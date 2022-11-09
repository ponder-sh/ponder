import { logger } from "@/common/logger";
import { endBenchmark, startBenchmark } from "@/common/utils";
import type { Ponder } from "@/core/Ponder";

import { startSourceBackfillQueues } from "./startSourceBackfillQueues";

export const startBackfillQueues = async ({
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

      await startSourceBackfillQueues({
        ponder,
        source,
        latestBlockNumber,
      });
    })
  );

  const duration = endBenchmark(startHrt);

  logger.info("\n");
  logger.info(
    `\x1b[32m${`Backfill complete (${duration})`}\x1b[0m`, // green
    "\n"
  );
};
