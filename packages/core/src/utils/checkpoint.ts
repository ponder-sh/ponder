export type SyncCheckpoint = {
  blockTimestamp: number;
  chainId: number;
  blockNumber: number;
};

export type IndexingCheckpoint = SyncCheckpoint & {
  // Execution index of the event within the block. For logs, this is the log index.
  // If null, the checkpoint includes all events in the block.
  executionIndex: number | null;
};

// 10 digits for unix timestamp gets us to the year 2277.
const BLOCK_TIMESTAMP_DIGITS = 10;
// Chain IDs are uint256. As of writing the largest Chain ID on https://chainlist.org
// is 13 digits. 16 digits should be enough (JavaScript's max safe integer).
const CHAIN_ID_DIGITS = 16;
// Same logic as chain ID.
const BLOCK_NUMBER_DIGITS = 16;
// Same logic as chain ID.
const EXECUTION_INDEX_DIGITS = 16;

export const encodeCheckpoint = (checkpoint: IndexingCheckpoint) => {
  const { blockTimestamp, chainId, blockNumber, executionIndex } = checkpoint;
  const result =
    blockTimestamp.toString().padStart(BLOCK_TIMESTAMP_DIGITS, "0") +
    chainId.toString().padStart(CHAIN_ID_DIGITS, "0") +
    blockNumber.toString().padStart(BLOCK_NUMBER_DIGITS, "0") +
    (executionIndex !== null
      ? executionIndex.toString().padStart(EXECUTION_INDEX_DIGITS, "0")
      : "9".repeat(EXECUTION_INDEX_DIGITS));

  if (
    result.length !==
    BLOCK_TIMESTAMP_DIGITS +
      CHAIN_ID_DIGITS +
      BLOCK_NUMBER_DIGITS +
      EXECUTION_INDEX_DIGITS
  )
    throw new Error(`Invalid stringified checkpoint: ${result}`);

  return result;
};

export const indexingCheckpointZero: IndexingCheckpoint = {
  blockTimestamp: 0,
  chainId: 0,
  blockNumber: 0,
  executionIndex: 0,
};

// TODO: Consider changing block timestamps and numbers to bigints
// so that we can accurately represent EVM max values.
export const indexingCheckpointMax: IndexingCheckpoint = {
  blockTimestamp: 9999999999,
  chainId: 2147483647,
  blockNumber: 9999999999,
  executionIndex: 2147483647,
};

export const checkpointGreaterThanOrEqualTo = (
  a: SyncCheckpoint,
  b: SyncCheckpoint,
) => {
  if (a.blockTimestamp !== b.blockTimestamp)
    return a.blockTimestamp > b.blockTimestamp;
  if (a.chainId !== b.chainId) return a.chainId > b.chainId;
  if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber;
  return true;
};

export const checkpointMax = (...checkpoints: SyncCheckpoint[]) =>
  checkpoints.reduce((max, checkpoint) => {
    if (checkpoint.blockTimestamp > max.blockTimestamp) return checkpoint;
    if (checkpoint.chainId > max.chainId) return checkpoint;
    if (checkpoint.blockNumber > max.blockNumber) return checkpoint;
    return max;
  });

export const checkpointMin = (...checkpoints: SyncCheckpoint[]) =>
  checkpoints.reduce((min, checkpoint) => {
    if (checkpoint.blockTimestamp < min.blockTimestamp) return checkpoint;
    if (checkpoint.chainId < min.chainId) return checkpoint;
    if (checkpoint.blockNumber < min.blockNumber) return checkpoint;
    return min;
  });
