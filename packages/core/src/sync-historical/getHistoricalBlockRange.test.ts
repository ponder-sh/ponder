import { expect, test } from "vitest";
import { getHistoricalBlockRange } from "./getHistoricalBlockRange.js";

test("getHistoricalBlockRange returns not required if startBlock is between finalized and latest", () => {
  const result = getHistoricalBlockRange({
    finalizedBlockNumber: 50,
    startBlock: 75,
  });

  expect(result.isHistoricalSyncRequired).toBe(false);
});
