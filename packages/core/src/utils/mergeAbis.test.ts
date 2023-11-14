import { parseAbi, parseAbiItem } from "abitype";
import { assertType, expect, test } from "vitest";

import { mergeAbis } from "./mergeAbis.js";

test("mergeAbis() removes constructors, receive, fallback", () => {
  const abi = parseAbi([
    "constructor()",
    // "fallback() external",
    // "receive() external payable",
  ]);

  const merged = mergeAbis([abi]);
  //    ^?

  const out = [] as const;
  expect(merged.length).toBe(0);
  expect(merged).toMatchObject(out);
  assertType<typeof out>(merged);
});

test("mergeAbis() duplicate items", () => {
  const abi = parseAbiItem("function a()");

  const merged = mergeAbis([[abi], [abi]]);
  //    ^?

  const out = [abi] as const;
  expect(merged.length).toBe(1);
  expect(merged).toMatchObject(out);
  assertType<typeof out>(merged);
});

test("mergeAbis() overloaded items", () => {
  const one = parseAbiItem("function a()");
  const two = parseAbiItem("function a(bytes32)");

  const merged = mergeAbis([[one], [two]]);
  //    ^?

  const out = [one, two] as const;
  expect(merged.length).toBe(2);
  expect(merged).toMatchObject(out);
  assertType<typeof out>(merged);
});

test("mergeAbis() empty abi", () => {
  const abi = parseAbiItem("function a()");

  const a = mergeAbis([[abi], []]);

  expect(a).toMatchObject([abi] as const);
  assertType<readonly [typeof abi]>(a);
});
