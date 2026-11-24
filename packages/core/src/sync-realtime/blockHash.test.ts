import { beforeEach, expect, test } from "vitest";
import { setupAnvil, setupCleanup, setupCommon } from "@/_test/setup.js";
import { simulateBlock } from "@/_test/simulate.js";
import { isBlockHashValid } from "./blockHash.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupCleanup);

test("isBlockHashValid() accepts a block as the RPC returns it", async () => {
  const { block } = await simulateBlock();

  expect(isBlockHashValid(block)).toBe(true);
});

test("isBlockHashValid() accepts a header without transactions", async () => {
  const { block } = await simulateBlock();

  expect(isBlockHashValid({ ...block, transactions: undefined })).toBe(true);
});

test("isBlockHashValid() rejects a changed logsBloom", async () => {
  const { block } = await simulateBlock();

  expect(
    isBlockHashValid({
      ...block,
      logsBloom: `0x${"f".repeat(512)}`,
    }),
  ).toBe(false);
});

test("isBlockHashValid() rejects a header missing a required field", async () => {
  const { block } = await simulateBlock();

  expect(isBlockHashValid({ ...block, mixHash: undefined! })).toBe(false);
});
