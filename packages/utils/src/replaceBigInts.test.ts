import { type Hex, numberToHex } from "viem";
import { assertType, expect, test } from "vitest";
import { replaceBigInts } from "./replaceBigInts.js";

test("scalar", () => {
  const out = replaceBigInts(5n, numberToHex);

  expect(out).toBe("0x5");
  assertType<Hex>(out);
});

test("array", () => {
  const out = replaceBigInts([5n], numberToHex);

  expect(out).toStrictEqual(["0x5"]);
  assertType<readonly [Hex]>(out);
});

test("readonly array", () => {
  const out = replaceBigInts([5n] as const, numberToHex);

  expect(out).toStrictEqual(["0x5"]);
  assertType<readonly [Hex]>(out);
});

test("object", () => {
  const out = replaceBigInts({ kevin: { kevin: 5n } }, numberToHex);

  expect(out).toStrictEqual({ kevin: { kevin: "0x5" } });
  assertType<{ kevin: { kevin: Hex } }>(out);
});
