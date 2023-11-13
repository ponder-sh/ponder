import { parseAbi } from "abitype";
import { assertType, expect, test } from "vitest";

import { mergeAbis } from "./mergeAbis.js";

const proxy = parseAbi([
  "function one(address) returns (uint256)",
  "function two(uint256)",
]);
const impl = parseAbi([
  "function one(bytes32) returns (bool)",
  "function two(uint256)",
]);

test("mergeAbis()", () => {
  const a = mergeAbis([proxy, impl]);
  //    ^?

  const out = [...proxy, impl[0]] as const;
  expect(a.length).toBe(3);
  expect(a).toMatchObject(out);
  assertType<typeof out>(a);
});
