import { expect, test } from "vitest";

import { checkpointMax, checkpointMin } from "./checkpoint.js";

test("checkpointMax returns correct value if only one checkpoint", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    executionIndex: 1,
  };
  const max = checkpointMax(checkpointOne);

  expect(max).toMatchObject(checkpointOne);
});

test("checkpointMax compares properly on timestamp", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    executionIndex: 1,
  };
  const checkpointTwo = {
    blockTimestamp: 2,
    chainId: 1,
    blockNumber: 1,
    executionIndex: 1,
  };

  const max = checkpointMax(checkpointOne, checkpointTwo);
  expect(max).toMatchObject(checkpointTwo);
});

test("checkpointMax compares properly on chainId", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    executionIndex: 1,
  };
  const checkpointTwo = {
    blockTimestamp: 1,
    chainId: 2,
    blockNumber: 1,
    executionIndex: 1,
  };

  const max = checkpointMax(checkpointOne, checkpointTwo);
  expect(max).toMatchObject(checkpointTwo);
});

test("checkpointMax compares properly on blockNumber", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    executionIndex: 1,
  };
  const checkpointTwo = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 3,
    executionIndex: 1,
  };

  const max = checkpointMax(checkpointOne, checkpointTwo);
  expect(max).toMatchObject(checkpointTwo);
});

test("checkpointMin compares properly on blockNumber", () => {
  const checkpointOne = {
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    executionIndex: 1,
  };
  const checkpointTwo = {
    blockTimestamp: 2,
    chainId: 1,
    blockNumber: 3,
    executionIndex: 1,
  };

  const max = checkpointMin(checkpointOne, checkpointTwo);
  expect(max).toMatchObject(checkpointOne);
});
