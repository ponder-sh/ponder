export type Checkpoint = {
  blockTimestamp: bigint;
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

export const decodeCheckpoint = (checkpoint: string): Checkpoint => {
  let offset = 0;

  const blockTimestamp = BigInt(
    checkpoint.slice(offset, offset + BLOCK_TIMESTAMP_DIGITS),
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
