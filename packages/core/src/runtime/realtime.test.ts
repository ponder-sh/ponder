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

test("getNoNewBlockTimeout() waits as long as a range-scanned chain polls", () => {
  const chain = { pollingInterval: 300_000 };

  // The default per-block sync.
  expect(getNoNewBlockTimeout({ chain, isRangeScan: false })).toBe(30_000);
  // A range scan, which receives a block only every `pollingInterval`.
  expect(getNoNewBlockTimeout({ chain, isRangeScan: true })).toBe(330_000);
});
