import { expect, test } from "vitest";

import {
  checkpointMax,
  checkpointMin,
  isCheckpointEqual,
  isCheckpointGreaterThan,
} from "./checkpoint.js";

test("isCheckpointEqual returns true if checkpoints are the same", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    logIndex: 1,
  };

  expect(isCheckpointEqual(checkpointOne, checkpointOne)).toBe(true);
});

test("isCheckpointEqual returns false if checkpoints are different", () => {
  const checkpoint = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    logIndex: 1,
  };
  const isEqual = isCheckpointEqual(checkpoint, { ...checkpoint, chainId: 2 });

  expect(isEqual).toBe(false);
});

test("isCheckpointEqual returns true with logIndex undefined", () => {
  const checkpoint = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
  };
  const isEqual = isCheckpointEqual(checkpoint, checkpoint);

  expect(isEqual).toBe(true);
});

test("isCheckpointEqual returns treats undefined logIndex as distinct", () => {
  const checkpoint = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    logIndex: 1,
  };
  const isEqual = isCheckpointEqual(checkpoint, {
    ...checkpoint,
    logIndex: undefined,
  });

  expect(isEqual).toBe(false);
});

test("isCheckpointGreaterThan compares correctly on chainId", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    logIndex: 1,
  };
  const checkpointTwo = {
    blockTimestamp: 1,
    chainId: 2,
    blockNumber: 1,
    logIndex: 1,
  };
  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointTwo);

  expect(isGreater).toBe(false);
});

test("isCheckpointGreaterThan compares correctly on logIndex", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    logIndex: 5,
  };
  const checkpointTwo = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    logIndex: 4,
  };
  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointTwo);

  expect(isGreater).toBe(true);
});

test("isCheckpointGreaterThan compares correctly with multiple values", () => {
  const checkpointOne = {
    blockTimestamp: 6,
    chainId: 5,
    blockNumber: 9,
    logIndex: 12,
  };
  const checkpointTwo = {
    blockTimestamp: 6,
    chainId: 5,
    blockNumber: 10,
    logIndex: 4,
  };
  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointTwo);

  expect(isGreater).toBe(false);
});

test("isCheckpointGreaterThan returns false for equal checkpoints", () => {
  const checkpointOne = {
    blockTimestamp: 6,
    chainId: 5,
    blockNumber: 9,
    logIndex: 12,
  };

  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointOne);

  expect(isGreater).toBe(false);
});

test("isCheckpointGreaterThan returns false for equal checkpoints with undefined logIndex ", () => {
  const checkpointOne = {
    blockTimestamp: 6,
    chainId: 5,
    blockNumber: 9,
    logIndex: undefined,
  };

  const isGreater = isCheckpointGreaterThan(checkpointOne, checkpointOne);

  expect(isGreater).toBe(false);
});

test("checkpointMax returns correct value if only one checkpoint", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    logIndex: 1,
  };
  const max = checkpointMax(checkpointOne);

  expect(max).toMatchObject(checkpointOne);
});

test("checkpointMax compares properly on timestamp", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    logIndex: 1,
  };
  const checkpointTwo = {
    blockTimestamp: 2,
    chainId: 1,
    blockNumber: 1,
    logIndex: 1,
  };

  const max = checkpointMax(checkpointOne, checkpointTwo);
  expect(max).toMatchObject(checkpointTwo);
});

test("checkpointMax compares properly on logIndex", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    logIndex: 1,
  };
  const checkpointTwo = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 3,
    logIndex: 1,
  };
  const checkpointThree = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 3,
    logIndex: undefined,
  };

  const max = checkpointMax(checkpointOne, checkpointTwo, checkpointThree);
  expect(max).toMatchObject(checkpointThree);
});

test("checkpointMin compares properly on blockNumber", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    logIndex: 1,
  };
  const checkpointTwo = {
    blockTimestamp: 2,
    chainId: 1,
    blockNumber: 3,
    logIndex: 1,
  };
  const checkpointThree = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    logIndex: undefined,
  };

  const max = checkpointMin(checkpointOne, checkpointTwo, checkpointThree);
  expect(max).toMatchObject(checkpointOne);
});
