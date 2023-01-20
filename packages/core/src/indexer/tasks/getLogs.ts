import { Ponder } from "@/Ponder";

export const getLogs = async ({
  ponder,
  fromTimestamp,
}: {
  ponder: Ponder;
  fromTimestamp: number;
}) => {
  const contracts = ponder.contracts.filter((contract) => contract.isIndexed);

  // Check the cached metadata for all contracts. If the minimum cached block across
  // all contracts is greater than the lastHandledLogTimestamp, fetch the newly available
  // logs and add them to the queue.
  const cachedToTimestamps = await Promise.all(
    contracts.map(async (contract) => {
      const cachedIntervals = await ponder.cacheStore.getCachedIntervals(
        contract.address
      );

      // Find the cached interval that includes the contract's startBlock.
      const startingCachedInterval = cachedIntervals.find(
        (interval) =>
          interval.startBlock <= contract.startBlock &&
          interval.endBlock >= contract.startBlock
      );

      // If there is no cached data that includes the start block, return -1.
      if (!startingCachedInterval) return -1;

      return startingCachedInterval.endBlockTimestamp;
    })
  );

  // If any of the contracts have no cached data yet, return early
  if (cachedToTimestamps.includes(-1)) {
    return { hasNewLogs: false, logs: [], toTimestamp: fromTimestamp };
  }

  // If the minimum cached timestamp across all contracts is less than the
  // latest processed timestamp, we can't process any new logs.
  const toTimestamp = Math.min(...cachedToTimestamps);
  if (toTimestamp <= fromTimestamp) {
    return { hasNewLogs: false, logs: [], toTimestamp: fromTimestamp };
  }

  // NOTE: cacheStore.getLogs is exclusive to the left and inclusive to the right.
  // This is fine because this.latestProcessedTimestamp starts at zero.
  const rawLogs = await Promise.all(
    contracts.map((contract) =>
      ponder.cacheStore.getLogs(contract.address, fromTimestamp, toTimestamp)
    )
  );

  const logs = rawLogs.flat().sort((a, b) => a.logSortKey - b.logSortKey);

  return { hasNewLogs: true, toTimestamp, logs };
};
