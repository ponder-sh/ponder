import { expect, test } from "vitest";

import { parseAbiParameter } from "viem";
import { getBytesConsumedByParam, getNestedParamOffset } from "./offset.js";

test("getBytesConsumedByParam returns 32 for static primitive types", () => {
  expect(getBytesConsumedByParam({ type: "uint" })).toBe(32);
  expect(getBytesConsumedByParam({ type: "uint256" })).toBe(32);
  expect(getBytesConsumedByParam({ type: "address" })).toBe(32);
});

test("getBytesConsumedByParam returns 32 for dynamic array types", () => {
  expect(getBytesConsumedByParam({ type: "int256[]" })).toBe(32);
  expect(getBytesConsumedByParam({ type: "address[]" })).toBe(32);
  expect(getBytesConsumedByParam({ type: "bytes[][4]" })).toBe(32);
});

test("getBytesConsumedByParam returns 32 for array type containing nested dynamic type", () => {
  expect(getBytesConsumedByParam({ type: "bytes[][4]" })).toBe(32);
});

test("getBytesConsumedByParam returns 32 for tuple type containing nested dynamic type", () => {
  expect(
    getBytesConsumedByParam({
      components: [
        { name: "x", type: "uint256[]" },
        { name: "y", type: "bool" },
        { name: "z", type: "address" },
      ],
      name: "fooOut",
      type: "tuple",
    }),
  ).toBe(32);
});

test("getBytesConsumedByParam returns expanded byte amount for static array type", () => {
  expect(getBytesConsumedByParam({ type: "int256[3]" })).toBe(32 * 3);
});

test("getBytesConsumedByParam returns expanded byte amount for static tuple type", () => {
  expect(
    getBytesConsumedByParam({
      components: [
        { name: "x", type: "uint256" },
        { name: "y", type: "bool" },
        { name: "z", type: "address" },
      ],
      name: "fooOut",
      type: "tuple",
    }),
  ).toBe(32 * 3);
});

test("getNestedParamOffset", () => {
  // fully static tuple
  let signature = [
    "struct Foo { address bar; bool v; int z; address y }",
    "Foo indexed foo",
  ];
  expect(
    getNestedParamOffset(parseAbiParameter(signature), "y".split(".")),
  ).toEqual(32 * 3);

  // fully static nested tuple
  signature = [
    "struct Bar { address x; address y; address z }",
    "struct Fooo { address a; bool b; int c; Bar d; address e }",
    "Fooo indexed foo",
  ];

  expect(
    getNestedParamOffset(parseAbiParameter(signature), "d.y".split(".")),
  ).toEqual(32 * 4);

  // dynamic nested tuple with dynamic parameter after
  signature = [
    "struct Barr { address x; address y; address z }",
    "struct Foooo { address a; bool b; int c; Barr d; string e }",
    "Foooo indexed foo",
  ];

  expect(
    getNestedParamOffset(parseAbiParameter(signature), "d.y".split(".")),
  ).toEqual(32 * 4);

  // dynamic nested tuple with dynamic parameter before
  signature = [
    "struct Barrr { address x; address y; address z }",
    "struct Fooooo { string a; bool b; int c; Barrr d; address e }",
    "Fooooo indexed foo",
  ];

  expect(
    getNestedParamOffset(parseAbiParameter(signature), "d.y".split(".")),
  ).toEqual(undefined);
});
