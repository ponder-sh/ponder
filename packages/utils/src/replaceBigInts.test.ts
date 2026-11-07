import { expect, expectTypeOf, test } from "bun:test";
import { type Hex, numberToHex } from "viem";
import { replaceBigInts } from "./replaceBigInts.js";

test("scalar", () => {
  const out = replaceBigInts(5n, numberToHex);

  expect(out).toBe("0x5");
  expectTypeOf<Hex>(out);
});

test("array", () => {
  const out = replaceBigInts([5n], numberToHex);

  expect(out).toMatchInlineSnapshot(`
    [
      "0x5",
    ]
  `);
  expectTypeOf<readonly [Hex]>(out);
});

test("readonly array", () => {
  const out = replaceBigInts([5n] as const, numberToHex);

  expect(out).toMatchInlineSnapshot(`
    [
      "0x5",
    ]
  `);
  expectTypeOf<readonly [Hex]>(out);
});

test("object", () => {
  const out = replaceBigInts({ kevin: { kevin: 5n } }, numberToHex);

  expect(out).toMatchInlineSnapshot(`
    {
      "kevin": {
        "kevin": "0x5",
      },
    }
  `);
  expectTypeOf<{ kevin: { kevin: Hex } }>(out);
});
