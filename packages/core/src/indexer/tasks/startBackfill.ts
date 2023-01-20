import type { Ponder } from "@/Ponder";

import { startBackfillForContract } from "./startBackfillForContract";

export const startBackfill = async ({ ponder }: { ponder: Ponder }) => {
  const queueFuncs = await Promise.all(
    ponder.contracts
      .filter((contract) => contract.isIndexed)
      .map(async (contract) => {
        const { killQueues, drainQueues } = await startBackfillForContract({
          ponder,
          contract,
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
