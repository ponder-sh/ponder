import { expect, test } from "vitest";

import {
  checkpointMax,
  checkpointMin,
  encodeCheckpoint,
  isCheckpointEqual,
  isCheckpointGreaterThan,
} from "./checkpoint.js";

test("encodeCheckpoint produces expected output", () => {
  const checkpoint = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 1,
  };

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

test("isCheckpointEqual returns true if checkpoints are the same", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 1,
  };

  expect(isCheckpointEqual(checkpointOne, checkpointOne)).toBe(true);
});

test("isCheckpointEqual returns false if checkpoints are different", () => {
  const checkpoint = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 1,
  };
  const isEqual = isCheckpointEqual(checkpoint, { ...checkpoint, chainId: 2 });

  expect(isEqual).toBe(false);
});

test("isCheckpointGreaterThan compares correctly on chainId", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 1,
  };
  const checkpointTwo = {
    blockTimestamp: 1,
    chainId: 2,
    blockNumber: 1,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 1,
  };
  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointTwo);

  expect(isGreater).toBe(false);
});

test("isCheckpointGreaterThan compares correctly on transactionIndex", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    eventType: 1,
    transactionIndex: 5,
    eventIndex: 1,
  };
  const checkpointTwo = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    eventType: 1,
    transactionIndex: 4,
    eventIndex: 1,
  };
  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointTwo);

  expect(isGreater).toBe(true);
});

test("isCheckpointGreaterThan compares correctly on eventType", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    eventType: 5,
    transactionIndex: 1,
    eventIndex: 1,
  };
  const checkpointTwo = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    eventType: 4,
    transactionIndex: 1,
    eventIndex: 1,
  };
  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointTwo);

  expect(isGreater).toBe(true);
});

test("isCheckpointGreaterThan compares correctly on eventIndex", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 5,
  };
  const checkpointTwo = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 4,
  };
  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointTwo);

  expect(isGreater).toBe(true);
});

test("isCheckpointGreaterThan compares correctly with multiple values", () => {
  const checkpointOne = {
    blockTimestamp: 6,
    chainId: 5,
    blockNumber: 9,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 12,
  };
  const checkpointTwo = {
    blockTimestamp: 6,
    chainId: 5,
    blockNumber: 10,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 4,
  };
  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointTwo);

  expect(isGreater).toBe(false);
});

test("isCheckpointGreaterThan returns false for equal checkpoints", () => {
  const checkpointOne = {
    blockTimestamp: 6,
    chainId: 5,
    blockNumber: 9,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 12,
  };

  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointOne);

  expect(isGreater).toBe(false);
});

test("checkpointMax returns correct value if only one checkpoint", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 1,
  };
  const max = checkpointMax(checkpointOne);

  expect(max).toMatchObject(checkpointOne);
});

test("checkpointMax compares properly on timestamp", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 1,
  };
  const checkpointTwo = {
    blockTimestamp: 2,
    chainId: 1,
    blockNumber: 1,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 1,
  };

  const max = checkpointMax(checkpointOne, checkpointTwo);
  expect(max).toMatchObject(checkpointTwo);
});

test("checkpointMin compares properly on blockNumber", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 1,
  };
  const checkpointTwo = {
    blockTimestamp: 2,
    chainId: 1,
    blockNumber: 3,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 1,
  };
  const checkpointThree = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    eventType: 1,
    transactionIndex: 1,
    eventIndex: 99,
  };

  const max = checkpointMin(checkpointOne, checkpointTwo, checkpointThree);
  expect(max).toMatchObject(checkpointOne);
});
