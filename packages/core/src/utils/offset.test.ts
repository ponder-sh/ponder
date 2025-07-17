import { expect, test } from "vitest";

import { parseAbiParameter } from "viem";
import {
  type TupleAbiParameter,
  getBytesConsumedByParam,
  getNestedParamOffset,
} from "./offset.js";

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
    "struct Foo_a { address bar; bool v; int z; address y }",
    "Foo_a indexed foo",
  ];
  expect(
    getNestedParamOffset(
      parseAbiParameter(signature) as TupleAbiParameter,
      "y".split("."),
    ),
  ).toEqual(32 * 3);

  // fully static nested tuple
  signature = [
    "struct Bar_a { address x; address y; address z }",
    "struct Foo_b { address a; bool b; int c; Bar_a d; address e }",
    "Foo_b indexed foo",
  ];

  expect(
    getNestedParamOffset(
      parseAbiParameter(signature) as TupleAbiParameter,
      "d.y".split("."),
    ),
  ).toEqual(32 * 4);

  // dynamic nested tuple with dynamic parameter after
  signature = [
    "struct Bar_b { address x; address y; address z }",
    "struct Foo_c { address a; bool b; int c; Bar_b d; string e }",
    "Foo_c indexed foo",
  ];

  expect(
    getNestedParamOffset(
      parseAbiParameter(signature) as TupleAbiParameter,
      "d.y".split("."),
    ),
  ).toEqual(32 * 4);

  // dynamic nested tuple with dynamic parameter before
  signature = [
    "struct Bar_c { address x; address y; address z }",
    "struct Foo_d { string a; Bar_c b; int c; Bar_c d; address e }",
    "Foo_d indexed foo",
  ];

  expect(
    getNestedParamOffset(
      parseAbiParameter(signature) as TupleAbiParameter,
      "d.y".split("."),
    ),
  ).toEqual(32 * 6);
});
