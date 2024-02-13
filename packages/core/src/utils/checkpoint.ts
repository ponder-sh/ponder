export type Checkpoint = {
  blockTimestamp: number;
  chainId: number;
  blockNumber: number;
  // Execution index of the log within the block.
  // If undefined, the checkpoint includes all events in the block.
  logIndex?: number | undefined;
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

export const encodeCheckpoint = (checkpoint: Checkpoint) => {
  const { blockTimestamp, chainId, blockNumber, logIndex } = checkpoint;
  const result =
    blockTimestamp.toString().padStart(BLOCK_TIMESTAMP_DIGITS, "0") +
    chainId.toString().padStart(CHAIN_ID_DIGITS, "0") +
    blockNumber.toString().padStart(BLOCK_NUMBER_DIGITS, "0") +
    (logIndex !== undefined
      ? logIndex.toString().padStart(EXECUTION_INDEX_DIGITS, "0")
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

export const zeroCheckpoint: Checkpoint = {
  blockTimestamp: 0,
  chainId: 0,
  blockNumber: 0,
  logIndex: 0,
};

// TODO: Consider changing block timestamps and numbers to bigints
// so that we can accurately represent EVM max values.
export const maxCheckpoint: Checkpoint = {
  blockTimestamp: 9999999999,
  chainId: 2147483647,
  blockNumber: 9999999999,
  logIndex: 2147483647,
};

/**
 * Returns true if two checkpoints are equal.
 */
export const isCheckpointEqual = (a: Checkpoint, b: Checkpoint) => {
  return (
    a.blockTimestamp === b.blockTimestamp &&
    a.chainId === b.chainId &&
    a.blockNumber === b.blockNumber &&
    ((a.logIndex === undefined && b.logIndex === undefined) ||
      a.logIndex === b.logIndex)
  );
};

/**
 * Returns true if checkpoint a is greater than checkpoint b.
 * Returns false if the checkpoints are equal.
 */
export const isCheckpointGreaterThan = (a: Checkpoint, b: Checkpoint) => {
  if (a.blockTimestamp !== b.blockTimestamp)
    return a.blockTimestamp > b.blockTimestamp;
  if (a.chainId !== b.chainId) return a.chainId > b.chainId;
  if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber;

  // If both logIndex are defined, compare normally.
  if (a.logIndex !== undefined && b.logIndex !== undefined) {
    return a.logIndex > b.logIndex;
  }
  // If both are undefined, the checkpoints are equal, so a is not greater than b.
  if (a.logIndex === undefined && b.logIndex === undefined) {
    return false;
  }
  // If only a is undefined, it's considered greater.
  if (a.logIndex === undefined) return true;
  // Otherwise b is undefined and a is defined, so b is greater.
  else return false;
};

/**
 * Returns true if checkpoint a is greater than or equal to checkpoint b.
 */
export const isCheckpointGreaterThanOrEqualTo = (
  a: Checkpoint,
  b: Checkpoint,
) => {
  return isCheckpointGreaterThan(a, b) || isCheckpointEqual(a, b);
};

export const checkpointMax = (...checkpoints: Checkpoint[]) =>
  checkpoints.reduce((max, checkpoint) => {
    return isCheckpointGreaterThan(checkpoint, max) ? checkpoint : max;
  });

export const checkpointMin = (...checkpoints: Checkpoint[]) =>
  checkpoints.reduce((min, checkpoint) => {
    return isCheckpointGreaterThan(min, checkpoint) ? checkpoint : min;
  });
