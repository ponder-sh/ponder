import { Ponder } from "@/Ponder";

export const getLogs = async ({
  ponder,
  fromTimestamp,
}: {
  ponder: Ponder;
  fromTimestamp: number;
}) => {
  const sources = ponder.sources.filter((source) => source.isIndexed);

  // Check the cached metadata for all sources. If the minimum cached block across
  // all sources is greater than the lastHandledLogTimestamp, fetch the newly available
  // logs and add them to the queue.
  const cachedToTimestamps = await Promise.all(
    sources.map(async (source) => {
      const cachedIntervals = await ponder.cacheStore.getCachedIntervals(
        source.address
      );

      // Find the cached interval that includes the source's startBlock.
      const startingCachedInterval = cachedIntervals.find(
        (interval) =>
          interval.startBlock <= source.startBlock &&
          interval.endBlock >= source.startBlock
      );

      // If there is no cached data that includes the start block, return -1.
      if (!startingCachedInterval) return -1;

      return startingCachedInterval.endBlockTimestamp;
    })
  );

  // If any of the sources have no cached data yet, return early
  if (cachedToTimestamps.includes(-1)) {
    return { hasNewLogs: false, logs: [], toTimestamp: fromTimestamp };
  }

  // If the minimum cached timestamp across all sources is less than the
  // latest processed timestamp, we can't process any new logs.
  const toTimestamp = Math.min(...cachedToTimestamps);
  if (toTimestamp <= fromTimestamp) {
    return { hasNewLogs: false, logs: [], toTimestamp: fromTimestamp };
  }

  // NOTE: cacheStore.getLogs is exclusive to the left and inclusive to the right.
  // This is fine because this.latestProcessedTimestamp starts at zero.
  const rawLogs = await Promise.all(
    sources.map((source) =>
      ponder.cacheStore.getLogs(source.address, fromTimestamp, toTimestamp)
    )
  );

  const logs = rawLogs.flat().sort((a, b) => a.logSortKey - b.logSortKey);

  return { hasNewLogs: true, toTimestamp, logs };
};
