import { expect, test } from "vitest";
import { validateHistoricalBlockRange } from "./validateHistoricalBlockRange.js";

test("validateHistoricalBlockRange throws if start block is greater than latest block", () => {
  expect(() =>
    validateHistoricalBlockRange({
      finalizedBlockNumber: 50,
      latestBlockNumber: 100,
      startBlock: 120,
    }),
  ).toThrowError(
    "Start block number (120) cannot be greater than latest block number (100)",
  );
});

test("validateHistoricalBlockRange returns not required if startBlock is between finalized and latest", () => {
  const result = validateHistoricalBlockRange({
    finalizedBlockNumber: 50,
    latestBlockNumber: 100,
    startBlock: 75,
  });

  expect(result.isHistoricalSyncRequired).toBe(false);
});

test("validateHistoricalBlockRange throws if end block is greater than start block", () => {
  expect(() =>
    validateHistoricalBlockRange({
      finalizedBlockNumber: 50,
      latestBlockNumber: 100,
      startBlock: 40,
      endBlock: 20,
    }),
  ).toThrowError(
    "End block number (20) cannot be less than start block number (40)",
  );
});

test("validateHistoricalBlockRange throws if end block is greater than finalized block", () => {
  expect(() =>
    validateHistoricalBlockRange({
      finalizedBlockNumber: 50,
      latestBlockNumber: 100,
      startBlock: 20,
      endBlock: 75,
    }),
  ).toThrowError(
    "End block number (75) cannot be greater than finalized block number (50)",
  );
});

test("validateHistoricalBlockRange throws if end block is greater than latest block", () => {
  expect(() =>
    validateHistoricalBlockRange({
      finalizedBlockNumber: 50,
      latestBlockNumber: 100,
      startBlock: 20,
      endBlock: 150,
    }),
  ).toThrowError(
    "End block number (150) cannot be greater than latest block number (100)",
  );
});
