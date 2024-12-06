export type Checkpoint = {
  blockTimestamp: number;
  chainId: bigint; // ToDo: remove from checkpoint?
  blockNumber: bigint;
  transactionIndex: bigint; // ToDo: use number
  eventType: number;
  eventIndex: bigint; // ToDo: use number
};

const UINT64_BYTES = 8; // Uint64: max value=18446744073709551615
const UINT32_BYTES = 4; // Uint32: max value=4294967295
const UINT16_BYTES = 2; // Uint16: max value=65535
const UINT8_BYTES = 1; // Uint8: max value=255

const BLOCK_TIMESTAMP_BYTES = UINT32_BYTES; // Uint32 - This get us to 2106-02-07
const BLOCK_NUMBER_BYTES = UINT64_BYTES; // Uint64 - Could also work with Uint32 (4.29B blocks), but may not be future proof
const TRANSACTION_INDEX_BYTES = UINT16_BYTES; // Uint16 - Allow 65k transactions per block
const EVENT_TYPE_BYTES = UINT8_BYTES; // Uint8 - Allow 256 event types
const EVENT_INDEX_BYTES = UINT16_BYTES; // Uint16 - Allow 65k logs/traces per transaction

const CHECKPOINT_BYTES_LENGTH =
  BLOCK_TIMESTAMP_BYTES +
  BLOCK_NUMBER_BYTES +
  TRANSACTION_INDEX_BYTES +
  EVENT_TYPE_BYTES +
  EVENT_INDEX_BYTES;

export const EVENT_TYPES = {
  blocks: 5,
  logs: 5,
  callTraces: 7,
  // ToDo: Add transaction & transfer types?
} as const;

export const encodeCheckpoint = (checkpoint: Checkpoint) => {
  const {
    blockTimestamp,
    blockNumber,
    transactionIndex,
    eventType,
    eventIndex,
  } = checkpoint;

  if (eventType < 0 || eventType > 9)
    throw new Error(
      `Got invalid event type ${eventType}, expected a number from 0 to 9`,
    );

  const buffer = Buffer.alloc(CHECKPOINT_BYTES_LENGTH);
  let offset = 0;
  offset = buffer.writeUInt32BE(blockTimestamp, offset);
  offset = buffer.writeBigUInt64BE(blockNumber, offset);
  offset = buffer.writeUInt16BE(Number(transactionIndex), offset);
  offset = buffer.writeUInt8(eventType, offset);
  buffer.writeUInt16BE(Number(eventIndex), offset);
  return buffer.toString("base64");
};

export const decodeCheckpoint = (checkpoint: string): Checkpoint => {
  const buffer = Buffer.from(checkpoint, "base64");

  if (buffer.length !== CHECKPOINT_BYTES_LENGTH)
    throw new Error(`Invalid checkpoint: ${checkpoint}`);

  let offset = 0;
  const blockTimestamp = buffer.readUInt32BE(offset);
  offset += BLOCK_TIMESTAMP_BYTES;
  const blockNumber = buffer.readBigUInt64BE(offset);
  offset += BLOCK_NUMBER_BYTES;
  const transactionIndex = buffer.readUInt16BE(offset);
  offset += TRANSACTION_INDEX_BYTES;
  const eventType = buffer.readUInt8(offset);
  offset += EVENT_TYPE_BYTES;
  const eventIndex = buffer.readUInt16BE(offset);

  return {
    chainId: 1n,
    blockTimestamp,
    blockNumber,
    transactionIndex: BigInt(transactionIndex),
    eventType,
    eventIndex: BigInt(eventIndex),
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
  blockTimestamp: 4_294_967_295,
  chainId: 16_777_215n,
  blockNumber: 9999_9999_9999_9999n,
  transactionIndex: 65_535n,
  eventType: 9,
  eventIndex: 65_535n,
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
