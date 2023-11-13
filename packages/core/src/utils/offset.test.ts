import { expect, test } from "vitest";

import { getBytesConsumedByParam } from "./offset.js";

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
