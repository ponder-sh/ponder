import type { Ponder } from "@/Ponder";

import { startBackfillForSource } from "./startBackfillForSource";

export const startBackfill = async ({ ponder }: { ponder: Ponder }) => {
  const queueFuncs = await Promise.all(
    ponder.sources
      .filter((source) => source.isIndexed)
      .map(async (source) => {
        const { killQueues, drainQueues } = await startBackfillForSource({
          ponder,
          source,
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
