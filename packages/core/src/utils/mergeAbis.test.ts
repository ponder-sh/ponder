import { parseAbi } from "abitype";
import { assertType, expect, test } from "vitest";

import { mergeAbis } from "./mergeAbis.js";

const proxy = parseAbi([
  "function one(address) returns (uint256)",
  "function two()",
]);
const impl = parseAbi([
  "function one(bytes32) returns (bool)",
  "function three()",
]);

test("mergeAbis()", () => {
  const a = mergeAbis([proxy, impl]);
  //    ^?

  const out = [proxy[0], proxy[1], impl[0], impl[1]] as const;
  expect(a).toMatchObject(out);
  assertType<typeof out>(a);
});
