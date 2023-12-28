export function validateHistoricalBlockRange({
  startBlock,
  endBlock: userDefinedEndBlock,
  finalizedBlockNumber,
  latestBlockNumber,
}: {
  startBlock: number;
  endBlock?: number;
  finalizedBlockNumber: number | undefined;
  latestBlockNumber: number;
}) {
  if (startBlock > latestBlockNumber) {
    throw new Error(
      `Start block number (${startBlock}) cannot be greater than latest block number (${latestBlockNumber}).
         Are you sure the RPC endpoint is for the correct network?`,
    );
  }

  if (finalizedBlockNumber === undefined || startBlock > finalizedBlockNumber) {
    // If the start block is in the unfinalized range, the historical sync is not needed.
    // Set the checkpoint to the current timestamp, then return (don't create the queue).
    return {
      isHistoricalSyncRequired: false,
      startBlock,
      endBlock: userDefinedEndBlock,
    } as const;
  }

  if (userDefinedEndBlock) {
    if (userDefinedEndBlock < startBlock) {
      throw new Error(
        `End block number (${userDefinedEndBlock}) cannot be less than start block number (${startBlock}).
           Are you sure the RPC endpoint is for the correct network?`,
      );
    }

    if (userDefinedEndBlock > latestBlockNumber) {
      throw new Error(
        `End block number (${userDefinedEndBlock}) cannot be greater than latest block number (${latestBlockNumber}).
           Are you sure the RPC endpoint is for the correct network?`,
      );
    }

    if (userDefinedEndBlock > finalizedBlockNumber) {
      throw new Error(
        `End block number (${userDefinedEndBlock}) cannot be greater than finalized block number (${finalizedBlockNumber}).
           Are you sure the RPC endpoint is for the correct network?`,
      );
    }
  }

  const resolvedEndBlock = userDefinedEndBlock ?? finalizedBlockNumber;

  return {
    isHistoricalSyncRequired: true,
    startBlock,
    endBlock: resolvedEndBlock,
  } as const;
}
