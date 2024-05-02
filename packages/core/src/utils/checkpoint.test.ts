import { expect, test } from "vitest";

import {
  type Checkpoint,
  checkpointMax,
  checkpointMin,
  decodeCheckpoint,
  encodeCheckpoint,
  isCheckpointEqual,
  isCheckpointGreaterThan,
  maxCheckpoint,
} from "./checkpoint.js";

test("encodeCheckpoint produces expected encoding", () => {
  const checkpoint = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 1n,
  } satisfies Checkpoint;

  const encoded = encodeCheckpoint(checkpoint);

  const expectedEncoding =
    // biome-ignore lint: string concat is more readable than template literal here
    "1".padStart(10, "0") +
    "1".toString().padStart(16, "0") +
    "1".toString().padStart(16, "0") +
    "1".toString().padStart(16, "0") +
    "1" +
    "1".toString().padStart(16, "0");

  expect(encoded).toEqual(expectedEncoding);
});

test("decodeCheckpoint produces expected object", () => {
  const encoded =
    // biome-ignore lint: string concat is more readable than template literal here
    "1".padStart(10, "0") +
    "1".toString().padStart(16, "0") +
    "1".toString().padStart(16, "0") +
    "1".toString().padStart(16, "0") +
    "1" +
    "1".toString().padStart(16, "0");

  const decodedCheckpoint = decodeCheckpoint(encoded);

  const expectedCheckpoint = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 1n,
  };

  expect(decodedCheckpoint).toMatchObject(expectedCheckpoint);
});

test("decodeCheckpoint decodes an encoded maxCheckpoint", () => {
  const encoded = encodeCheckpoint(maxCheckpoint);
  const decoded = decodeCheckpoint(encoded);

  expect(decoded).toMatchObject(maxCheckpoint);
});

test("isCheckpointEqual returns true if checkpoints are the same", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 1n,
  };

  expect(isCheckpointEqual(checkpointOne, checkpointOne)).toBe(true);
});

test("isCheckpointEqual returns false if checkpoints are different", () => {
  const checkpoint = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 1n,
  };
  const isEqual = isCheckpointEqual(checkpoint, { ...checkpoint, chainId: 2n });

  expect(isEqual).toBe(false);
});

test("isCheckpointGreaterThan compares correctly on blockTimestamp", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 1n,
  };
  const checkpointTwo = {
    blockTimestamp: 2,
    chainId: 2n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 1n,
  };
  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointTwo);

  expect(isGreater).toBe(false);
});

test("isCheckpointGreaterThan compares correctly on chainId", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 1n,
  };
  const checkpointTwo = {
    blockTimestamp: 1,
    chainId: 2n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 1n,
  };
  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointTwo);

  expect(isGreater).toBe(false);
});

test("isCheckpointGreaterThan compares correctly on transactionIndex", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 5n,
    eventType: 1,
    eventIndex: 1n,
  };
  const checkpointTwo = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 4n,
    eventType: 1,
    eventIndex: 1n,
  };
  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointTwo);

  expect(isGreater).toBe(true);
});

test("isCheckpointGreaterThan compares correctly on eventType", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 5,
    eventIndex: 1n,
  };
  const checkpointTwo = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 4,
    eventIndex: 1n,
  };
  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointTwo);

  expect(isGreater).toBe(true);
});

test("isCheckpointGreaterThan compares correctly on eventIndex", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 5n,
  };
  const checkpointTwo = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 4n,
  };
  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointTwo);

  expect(isGreater).toBe(true);
});

test("isCheckpointGreaterThan compares correctly with multiple values", () => {
  const checkpointOne = {
    blockTimestamp: 6,
    chainId: 5n,
    blockNumber: 9n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 12n,
  };
  const checkpointTwo = {
    blockTimestamp: 6,
    chainId: 5n,
    blockNumber: 10n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 4n,
  };
  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointTwo);

  expect(isGreater).toBe(false);
});

test("isCheckpointGreaterThan returns false for equal checkpoints", () => {
  const checkpointOne = {
    blockTimestamp: 6,
    chainId: 5n,
    blockNumber: 9n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 12n,
  };

  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointOne);

  expect(isGreater).toBe(false);
});

test("checkpointMax returns correct value if only one checkpoint", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 1n,
  };
  const max = checkpointMax(checkpointOne);

  expect(max).toMatchObject(checkpointOne);
});

test("checkpointMax compares properly on timestamp", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 1n,
  };
  const checkpointTwo = {
    blockTimestamp: 2,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 1n,
  };

  const max = checkpointMax(checkpointOne, checkpointTwo);
  expect(max).toMatchObject(checkpointTwo);
});

test("checkpointMin compares properly on blockNumber", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 1n,
  };
  const checkpointTwo = {
    blockTimestamp: 2,
    chainId: 1n,
    blockNumber: 3n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 1n,
  };
  const checkpointThree = {
    blockTimestamp: 1,
    chainId: 1n,
    blockNumber: 1n,
    transactionIndex: 1n,
    eventType: 1,
    eventIndex: 99n,
  };

  const max = checkpointMin(checkpointOne, checkpointTwo, checkpointThree);
  expect(max).toMatchObject(checkpointOne);
});
