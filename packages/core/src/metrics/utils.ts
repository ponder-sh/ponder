import type { Source } from "@/config/sources.js";
import type { MetricsService } from "./service.js";

export async function getHistoricalSyncStats({
  sources,
  metrics,
}: {
  sources: Source[];
  metrics: MetricsService;
}) {
  const startTimestampMetric = (
    await metrics.ponder_historical_start_timestamp.get()
  ).values?.[0]?.value;
  const cachedBlocksMetric = (
    await metrics.ponder_historical_cached_blocks.get()
  ).values;
  const totalBlocksMetric = (await metrics.ponder_historical_total_blocks.get())
    .values;
  const completedBlocksMetric = (
    await metrics.ponder_historical_completed_blocks.get()
  ).values;

  return sources.map((source) => {
    const { contractName, networkName } = source;

    const totalBlocks = totalBlocksMetric.find(
      ({ labels }) =>
        labels.contract === contractName && labels.network === networkName,
    )?.value;
    const cachedBlocks = cachedBlocksMetric.find(
      ({ labels }) =>
        labels.contract === contractName && labels.network === networkName,
    )?.value;
    const completedBlocks =
      completedBlocksMetric.find(
        ({ labels }) =>
          labels.contract === contractName && labels.network === networkName,
      )?.value ?? 0;

    // If the total_blocks metric is set and equals zero, the sync was skipped and
    // should be considered complete.
    if (totalBlocks === 0) {
      return {
        network: networkName,
        contract: contractName,
        rate: 1,
        eta: 0,
      };
    }

    // Any of these mean setup is not complete.
    if (
      totalBlocks === undefined ||
      cachedBlocks === undefined ||
      !startTimestampMetric
    ) {
      return { network: networkName, contract: contractName, rate: 0 };
    }

    const rate = (cachedBlocks + completedBlocks) / totalBlocks;

    // If fewer than 3 blocks have been processsed, the ETA will be low quality.
    if (completedBlocks < 3)
      return { network: networkName, contract: contractName, rate };

    // If rate is 1, sync is complete, so set the ETA to zero.
    if (rate === 1)
      return {
        network: networkName,
        contract: contractName,
        rate,
        eta: 0,
      };

    // (time elapsed) / (% completion of remaining block range)
    const elapsed = Date.now() - startTimestampMetric;
    const estimatedTotalDuration =
      elapsed / (completedBlocks / (totalBlocks - cachedBlocks));
    const estimatedTimeRemaining = estimatedTotalDuration - elapsed;

    return {
      network: networkName,
      contract: contractName,
      rate,
      eta: estimatedTimeRemaining,
    };
  });
}
