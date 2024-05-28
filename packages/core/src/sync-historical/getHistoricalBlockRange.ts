export function getHistoricalBlockRange({
  startBlock,
  endBlock: userDefinedEndBlock,
  finalizedBlockNumber,
}: {
  startBlock: number;
  endBlock?: number;
  finalizedBlockNumber: number;
}) {
  const resolvedEndBlock = userDefinedEndBlock ?? finalizedBlockNumber;

  if (startBlock > finalizedBlockNumber) {
    // If the start block is in the unfinalized range, the historical sync is not needed.
    // Set the checkpoint to the current timestamp, then return (don't create the queue).
    return {
      isHistoricalSyncRequired: false,
      startBlock,
      endBlock: resolvedEndBlock,
    } as const;
  }

  return {
    isHistoricalSyncRequired: true,
    startBlock,
    endBlock: resolvedEndBlock,
  } as const;
}
