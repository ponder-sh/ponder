import { expect, test } from "vitest";
import { buildWhereObject } from "./filter.js";

test("buildWhereObject transforms equals condition correctly", () => {
  const where = { name: "John" };
  const expected = { name: { equals: "John" } };

  expect(buildWhereObject(where)).toEqual(expected);
});

test("buildWhereObject transforms not condition correctly", () => {
  const where = { age_not: 30 };
  const expected = { age: { not: 30 } };

  expect(buildWhereObject(where)).toEqual(expected);
});

test("buildWhereObject transforms in condition correctly", () => {
  const where = { category_in: ["books", "electronics"] };
  const expected = { category: { in: ["books", "electronics"] } };

  expect(buildWhereObject(where)).toEqual(expected);
});

test("buildWhereObject handles complex conditions with and/or correctly", () => {
  const where = {
    name_not: "Peter",
    AND: [{ name_contains: "John" }, { age_gt: 20 }],
    OR: [{ country: "USA" }, { country: "Canada" }],
  };
  const expected = {
    name: { not: "Peter" },
    AND: [{ name: { contains: "John" } }, { age: { gt: 20 } }],
    OR: [{ country: { equals: "USA" } }, { country: { equals: "Canada" } }],
  };

  expect(buildWhereObject(where)).toEqual(expected);
});

test("buildWhereObject transforms has condition correctly", () => {
  const where = {
    list_has: "0x0",
  };
  const expected = {
    list: { has: "0x0" },
  };

  expect(buildWhereObject(where)).toEqual(expected);
});

test.skip("buildWhereObject handles two conditions for the same field", () => {
  const where = { timestamp_gte: 1630608704, timestamp_lte: 1630605241 };
  const expected = { timestamp: { gte: 1630608704, lte: 1630605241 } };

  expect(buildWhereObject(where)).toEqual(expected);
});

test("buildWhereObject throws error on unknown condition", () => {
  const where = { name_like: "John" };
  expect(() => buildWhereObject(where)).toThrow(
    "Invalid query: Unknown where condition: name_like",
  );
});

test("buildWhereObject returns an empty object when where is empty", () => {
  const where = {};
  const expected = {};
  expect(buildWhereObject(where)).toEqual(expected);
});
