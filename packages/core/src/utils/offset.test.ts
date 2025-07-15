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

// test("getNestedParamOffset fully static tuple", () => {
//   const signature1 = ['struct Foo { address bar; bool v; int z; address y }', 'Foo indexed foo'];

//   expect(getNestedParamOffset(parseAbiParameter(signature1), "y".split("."))).toEqual(32 * 3);
// });

test("getNestedParamOffset fully static nested tuple", () => {
  const signature = [
    "struct Bar { address x; address y; address z }",
    "struct Foo { address a; bool b; int c; Bar d; address e }",
    "Foo indexed foo",
  ];

  expect(
    getNestedParamOffset(parseAbiParameter(signature), "d.y".split(".")),
  ).toEqual(32 * 4);
});

test("getNestedParamOffset dynamic nested tuple with dynamic parameter after", () => {
  const signature = [
    "struct Bar { address x; address y; address z }",
    "struct Foo { address a; bool b; int c; Bar d; string e }",
    "Foo indexed foo",
  ];

  expect(
    getNestedParamOffset(parseAbiParameter(signature), "d.y".split(".")),
  ).toEqual(32 * 4);
});

test("getNestedParamOffset dynamic nested tuple with dynamic parameter before", () => {
  const signature = [
    "struct Bar { address x; address y; address z }",
    "struct Foo { string a; bool b; int c; Bar d; address e }",
    "Foo indexed foo",
  ];

  expect(parseAbiParameter(signature)).toEqual(32 * 4);
});
