import { utils } from "ethers";

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

  // For UI/reporting purposes, also keep track of the total number of logs
  // found (not just those being handled)
  let totalLogCount = 0;

  // NOTE: cacheStore.getLogs is exclusive to the left and inclusive to the right.
  // This is fine because this.latestProcessedTimestamp starts at zero.
  const rawLogs = await Promise.all(
    contracts.map(async (contract) => {
      const handlers = ponder.handlers ?? {};

      const contractHandlers = handlers[contract.name] ?? {};
      const eventNames = Object.keys(contractHandlers);

      const eventSigHashes = eventNames
        .map((eventName) => {
          try {
            const fragment = contract.abiInterface.getEvent(eventName);
            const signature = fragment.format();
            const hash = utils.solidityKeccak256(["string"], [signature]);
            return hash;
          } catch (err) {
            ponder.logger.error(
              `Unable to generate event sig hash for event: ${eventName}`
            );
          }
        })
        .filter((hash): hash is string => !!hash);

      const [logs, totalLogs] = await Promise.all([
        ponder.cacheStore.getLogs(
          contract.address,
          fromTimestamp,
          toTimestamp,
          eventSigHashes
        ),
        ponder.cacheStore.getLogs(contract.address, fromTimestamp, toTimestamp),
      ]);

      totalLogCount += totalLogs.length;

      return logs;
    })
  );

  const logs = rawLogs.flat().sort((a, b) => a.logSortKey - b.logSortKey);

  return { hasNewLogs: true, toTimestamp, logs, totalLogCount };
};
