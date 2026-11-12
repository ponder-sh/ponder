import { expect, test } from "vitest";
import { getNoNewBlockTimeout, getReorgedBlockNumbers } from "./realtime.js";

test("getReorgedBlockNumbers() includes every block above the common ancestor", () => {
  // A range-scanned chain emits only some blocks, here 5 and 8.
  expect(
    getReorgedBlockNumbers({
      block: { number: "0x3" },
      reorgedBlocks: [{ number: "0x5" }, { number: "0x8" }],
    }),
  ).toStrictEqual([
    { number: "0x4" },
    { number: "0x5" },
    { number: "0x6" },
    { number: "0x7" },
    { number: "0x8" },
  ]);
});

test("getReorgedBlockNumbers() matches contiguous reorged blocks", () => {
  expect(
    getReorgedBlockNumbers({
      block: { number: "0x3" },
      reorgedBlocks: [{ number: "0x4" }, { number: "0x5" }],
    }),
  ).toStrictEqual([{ number: "0x4" }, { number: "0x5" }]);
});

test("getReorgedBlockNumbers() returns nothing without reorged blocks", () => {
  expect(
    getReorgedBlockNumbers({ block: { number: "0x3" }, reorgedBlocks: [] }),
  ).toStrictEqual([]);
});

test("getNoNewBlockTimeout() waits as long as a range-scanned chain scans", () => {
  const chain = { pollingInterval: 18_000_000, ws: undefined };
  const logTrigger = { heartbeatInterval: 18_000_000 };

  // The default per-block sync.
  expect(
    getNoNewBlockTimeout({ chain, isRangeScan: false, logTrigger: undefined }),
  ).toBe(30_000);
  // A range scan polled every `pollingInterval`.
  expect(getNoNewBlockTimeout({ chain, isRangeScan: true, logTrigger })).toBe(
    18_030_000,
  );
  // A range scan triggered by log notifications, with a heartbeat longer
  // than its 180 s reorg window.
  expect(
    getNoNewBlockTimeout({
      chain: { pollingInterval: 2_000, ws: "wss://example.com" },
      isRangeScan: true,
      logTrigger: { heartbeatInterval: 2_100_000 },
    }),
  ).toBe(2_130_000);
});
