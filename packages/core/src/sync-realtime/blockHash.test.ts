import { beforeEach, expect, test } from "vitest";
import {
  berachainPragueHeader,
  mainnetLondonHeader,
  mainnetShanghaiHeader,
} from "@/_test/blockHeaders.js";
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

  const { receiptsRoot: _, ...header } = block;

  // @ts-expect-error The type requires `receiptsRoot`; an RPC may omit it.
  expect(isBlockHashValid(header)).toBe(false);
});

test("isBlockHashValid() returns false for a malformed field", async () => {
  const { block } = await simulateBlock();

  expect(isBlockHashValid({ ...block, difficulty: "0x" })).toBe(false);
});

test.each([
  ["Ethereum London", mainnetLondonHeader],
  ["Ethereum Shanghai", mainnetShanghaiHeader],
  ["Berachain Prague", berachainPragueHeader],
])("isBlockHashValid() accepts a header from %s", (_, header) => {
  expect(isBlockHashValid(header)).toBe(true);
});
