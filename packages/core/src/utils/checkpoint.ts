export type Checkpoint = {
  blockTimestamp: number;
  chainId: bigint;
  blockNumber: bigint;
  transactionIndex: bigint;
  eventType: number;
  eventIndex: bigint;
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
// At time of writing, we only have 2 event types planned, so one digit (10 types) is enough.
const EVENT_TYPE_DIGITS = 1;
// This could contain log index, trace index, etc. 16 digits should be enough.
const EVENT_INDEX_DIGITS = 16;

const CHECKPOINT_LENGTH =
  BLOCK_TIMESTAMP_DIGITS +
  CHAIN_ID_DIGITS +
  BLOCK_NUMBER_DIGITS +
  TRANSACTION_INDEX_DIGITS +
  EVENT_TYPE_DIGITS +
  EVENT_INDEX_DIGITS;

export const EVENT_TYPES = {
  blocks: 5,
  logs: 5,
  callTraces: 7,
} as const;

export const encodeCheckpoint = (checkpoint: Checkpoint) => {
  const {
    blockTimestamp,
    chainId,
    blockNumber,
    transactionIndex,
    eventType,
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
    eventIndex.toString().padStart(EVENT_INDEX_DIGITS, "0");

  if (result.length !== CHECKPOINT_LENGTH)
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

  const chainId = BigInt(checkpoint.slice(offset, offset + CHAIN_ID_DIGITS));
  offset += CHAIN_ID_DIGITS;

  const blockNumber = BigInt(
    checkpoint.slice(offset, offset + BLOCK_NUMBER_DIGITS),
  );
  offset += BLOCK_NUMBER_DIGITS;

  const transactionIndex = BigInt(
    checkpoint.slice(offset, offset + TRANSACTION_INDEX_DIGITS),
  );
  offset += TRANSACTION_INDEX_DIGITS;

  const eventType = +checkpoint.slice(offset, offset + EVENT_TYPE_DIGITS);
  offset += EVENT_TYPE_DIGITS;

  const eventIndex = BigInt(
    checkpoint.slice(offset, offset + EVENT_INDEX_DIGITS),
  );
  offset += EVENT_INDEX_DIGITS;

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
  chainId: 0n,
  blockNumber: 0n,
  transactionIndex: 0n,
  eventType: 0,
  eventIndex: 0n,
};

export const maxCheckpoint: Checkpoint = {
  blockTimestamp: 99999_99999,
  chainId: 9999_9999_9999_9999n,
  blockNumber: 9999_9999_9999_9999n,
  transactionIndex: 9999_9999_9999_9999n,
  eventType: 9,
  eventIndex: 9999_9999_9999_9999n,
};

/**
 * Returns true if two checkpoints are equal.
 */
export const isCheckpointEqual = (a: Checkpoint, b: Checkpoint) =>
  encodeCheckpoint(a) === encodeCheckpoint(b);

/**
 * Returns true if checkpoint a is greater than checkpoint b.
 * Returns false if the checkpoints are equal.
 */
export const isCheckpointGreaterThan = (a: Checkpoint, b: Checkpoint) =>
  encodeCheckpoint(a) > encodeCheckpoint(b);

/**
 * Returns true if checkpoint a is greater than or equal to checkpoint b.
 */
export const isCheckpointGreaterThanOrEqualTo = (
  a: Checkpoint,
  b: Checkpoint,
) => encodeCheckpoint(a) >= encodeCheckpoint(b);

export const checkpointMax = (...checkpoints: Checkpoint[]) =>
  checkpoints.reduce((max, checkpoint) => {
    return isCheckpointGreaterThan(checkpoint, max) ? checkpoint : max;
  });

export const checkpointMin = (...checkpoints: Checkpoint[]) =>
  checkpoints.reduce((min, checkpoint) => {
    return isCheckpointGreaterThan(min, checkpoint) ? checkpoint : min;
  });

export const LATEST = encodeCheckpoint(maxCheckpoint);
