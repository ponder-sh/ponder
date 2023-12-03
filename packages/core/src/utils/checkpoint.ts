export type EventCheckpoint = {
  blockTimestamp: number;
  chainId: number;
  blockNumber: number;
  // Execution index of the event within the block. For logs, this is the log index.
  // If null, the checkpoint includes all events in the block.
  executionIndex: number | null;
};

// 10 digits for unix timestamp gets us to the year 2277.
const TIMESTAMP_DIGITS = 10;
// Chain IDs are uint256. As of writing the largest Chain ID on https://chainlist.org
// is 13 digits. 16 digits should be enough (JavaScript's max safe integer).
const CHAIN_ID_DIGITS = 16;
// Same logic as chain ID.
const BLOCK_NUMBER_DIGITS = 16;
// Same logic as chain ID.
const EXECUTION_INDEX_DIGITS = 16;

export const encodeCheckpoint = (checkpoint: EventCheckpoint) => {
  const { blockTimestamp, chainId, blockNumber, executionIndex } = checkpoint;
  const result =
    blockTimestamp.toString().padStart(TIMESTAMP_DIGITS, "0") +
    chainId.toString().padStart(CHAIN_ID_DIGITS, "0") +
    blockNumber.toString().padStart(BLOCK_NUMBER_DIGITS, "0") +
    (executionIndex !== null
      ? executionIndex.toString().padStart(EXECUTION_INDEX_DIGITS, "0")
      : "9".repeat(EXECUTION_INDEX_DIGITS));

  if (
    result.length !==
    TIMESTAMP_DIGITS +
      CHAIN_ID_DIGITS +
      BLOCK_NUMBER_DIGITS +
      EXECUTION_INDEX_DIGITS
  )
    throw new Error(`Invalid stringified checkpoint: ${result}`);

  return result;
};

export const zeroCheckpoint: EventCheckpoint = {
  blockTimestamp: 0,
  chainId: 0,
  blockNumber: 0,
  executionIndex: 0,
};

export const checkpointGreaterThanOrEqualTo = (
  a: EventCheckpoint,
  b: EventCheckpoint,
) => {
  if (a.blockTimestamp !== b.blockTimestamp)
    return a.blockTimestamp > b.blockTimestamp;
  if (a.chainId !== b.chainId) return a.chainId > b.chainId;
  if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber;
  return true;
};

export const checkpointMax = (...checkpoints: EventCheckpoint[]) =>
  checkpoints.reduce((max, checkpoint) => {
    if (checkpoint.blockTimestamp > max.blockTimestamp) return checkpoint;
    if (checkpoint.chainId > max.chainId) return checkpoint;
    if (checkpoint.blockNumber > max.blockNumber) return checkpoint;
    return max;
  });

export const checkpointMin = (...checkpoints: EventCheckpoint[]) =>
  checkpoints.reduce((min, checkpoint) => {
    if (checkpoint.blockTimestamp < min.blockTimestamp) return checkpoint;
    if (checkpoint.chainId < min.chainId) return checkpoint;
    if (checkpoint.blockNumber < min.blockNumber) return checkpoint;
    return min;
  });
