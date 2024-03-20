export type Checkpoint = {
  blockTimestamp: number;
  chainId: number;
  blockNumber: number;
  transactionIndex: number;
  eventType: number;
  eventIndex: number;
};

// 10 digits for unix timestamp gets us to the year 2277.
const BLOCK_TIMESTAMP_DIGITS = 10;
// Chain IDs are uint256. As of writing the largest Chain ID on https://chainlist.org
// is 13 digits. 16 digits should be enough (JavaScript's max safe integer).
const CHAIN_ID_DIGITS = 16;
// Same logic as chain ID.
const BLOCK_NUMBER_DIGITS = 16;
// Same logic as chain ID.
const TRANSACTION_INDEX_DIGITS = 16;
// Currently only event type
const EVENT_TYPE_DIGITS = 1;
// Same logic as chain ID.
const EXECUTION_INDEX_DIGITS = 16;

export const eventTypes = {
  logs: 5,
} as const;

export const encodeCheckpoint = (checkpoint: Checkpoint) => {
  const {
    blockTimestamp,
    chainId,
    transactionIndex,
    eventType,
    blockNumber,
    eventIndex,
  } = checkpoint;

  if (eventType < 0 || eventType > 9)
    throw new Error(
      `Got invalid event type ${eventType}, expected a number from 0 to 9`,
    );

  const result =
    blockTimestamp.toString().padStart(BLOCK_TIMESTAMP_DIGITS, "0") +
    chainId.toString().padStart(CHAIN_ID_DIGITS, "0") +
    blockNumber.toString().padStart(BLOCK_NUMBER_DIGITS, "0") +
    transactionIndex.toString().padStart(TRANSACTION_INDEX_DIGITS, "0") +
    eventType.toString() +
    eventIndex.toString().padStart(EXECUTION_INDEX_DIGITS, "0");

  if (
    result.length !==
    BLOCK_TIMESTAMP_DIGITS +
      CHAIN_ID_DIGITS +
      BLOCK_NUMBER_DIGITS +
      TRANSACTION_INDEX_DIGITS +
      EVENT_TYPE_DIGITS +
      EXECUTION_INDEX_DIGITS
  )
    throw new Error(`Invalid stringified checkpoint: ${result}`);

  return result;
};

export const decodeCheckpoint = (checkpoint: string): Checkpoint => {
  let offset = 0;

  const blockTimestamp = +checkpoint.slice(
    offset,
    offset + BLOCK_TIMESTAMP_DIGITS,
  );
  offset += BLOCK_TIMESTAMP_DIGITS;

  const chainId = +checkpoint.slice(offset, offset + CHAIN_ID_DIGITS);
  offset += CHAIN_ID_DIGITS;

  const blockNumber = +checkpoint.slice(offset, offset + BLOCK_NUMBER_DIGITS);
  offset += BLOCK_NUMBER_DIGITS;

  const transactionIndex = +checkpoint.slice(
    offset,
    offset + TRANSACTION_INDEX_DIGITS,
  );
  offset += TRANSACTION_INDEX_DIGITS;

  const eventType = +checkpoint.slice(offset, offset + EVENT_TYPE_DIGITS);
  offset += EVENT_TYPE_DIGITS;

  const eventIndex = +checkpoint.slice(offset, offset + EXECUTION_INDEX_DIGITS);
  offset += EXECUTION_INDEX_DIGITS;

  return {
    blockTimestamp,
    chainId,
    blockNumber,
    transactionIndex,
    eventType,
    eventIndex,
  };
};

export const zeroCheckpoint: Checkpoint = {
  blockTimestamp: 0,
  chainId: 0,
  blockNumber: 0,
  transactionIndex: 0,
  eventType: 0,
  eventIndex: 0,
};

// TODO: Consider changing block timestamps and numbers to bigints
// so that we can accurately represent EVM max values.
export const maxCheckpoint: Checkpoint = {
  blockTimestamp: 9999999999,
  chainId: 9999999999,
  blockNumber: 9999999999,
  transactionIndex: 9999999999,
  eventType: 9,
  eventIndex: 9999999999,
};

/**
 * Returns true if two checkpoints are equal.
 */
export const isCheckpointEqual = (a: Checkpoint, b: Checkpoint) => {
  return (
    a.blockTimestamp === b.blockTimestamp &&
    a.chainId === b.chainId &&
    a.blockNumber === b.blockNumber &&
    a.transactionIndex === b.transactionIndex &&
    a.eventType === b.eventType &&
    a.eventIndex === b.eventIndex
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
  if (a.transactionIndex !== b.transactionIndex)
    return a.transactionIndex > b.transactionIndex;
  if (a.eventType !== b.eventType) return a.eventType > b.eventType;
  if (a.eventIndex !== b.eventIndex) return a.eventIndex > b.eventIndex;
  // checkpoints are equal
  return false;
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
