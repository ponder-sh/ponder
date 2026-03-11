import type { Chain } from "viem";
import { expect, test } from "vitest";
import { getFinalityBlockCount } from "./finality.js";

const makeChain = (id: number): Chain => ({ id }) as Chain;

test("Filecoin mainnet returns 900", () => {
  expect(getFinalityBlockCount({ chain: makeChain(314) })).toBe(900);
});

test("Filecoin calibnet returns 900", () => {
  expect(getFinalityBlockCount({ chain: makeChain(314159) })).toBe(900);
});

test("unknown chain returns default of 30", () => {
  expect(getFinalityBlockCount({ chain: makeChain(999999) })).toBe(30);
});

test("undefined chain returns default of 30", () => {
  expect(getFinalityBlockCount({ chain: undefined })).toBe(30);
});
