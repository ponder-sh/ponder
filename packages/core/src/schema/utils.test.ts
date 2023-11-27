import { expect, test } from "vitest";

import { _enum, many, one, string } from "./columns.js";
import {
  isEnumColumn,
  isManyColumn,
  isOneColumn,
  isReferenceColumn,
} from "./utils.js";

test("one column", () => {
  expect(isManyColumn(string()[" column"])).toBe(false);

  expect(isOneColumn(one("a"))).toBe(true);
});

test("many column", () => {
  expect(isManyColumn(string()[" column"])).toBe(false);

  expect(isManyColumn(many("a.b"))).toBe(true);
});

test("enum column", () => {
  expect(isEnumColumn(string()[" column"])).toBe(false);

  expect(isEnumColumn(_enum("ENUM")[" enum"])).toBe(true);
});

test("reference column", () => {
  expect(isReferenceColumn(string()[" column"])).toBe(false);

  expect(isReferenceColumn(string().references(".id")[" column"])).toBe(true);
});
