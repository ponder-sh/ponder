import { expect, test } from "vitest";

import * as p from "./index.js";
import {
  isEnumColumn,
  isManyColumn,
  isOneColumn,
  isReferenceColumn,
} from "./utils.js";

test("one column", () => {
  expect(isManyColumn(p.string()[" column"])).toBe(false);

  expect(isOneColumn(p.one("a"))).toBe(true);
});

test("many column", () => {
  expect(isManyColumn(p.string()[" column"])).toBe(false);

  expect(isManyColumn(p.many("a.b"))).toBe(true);
});

test("enum column", () => {
  expect(isEnumColumn(p.string()[" column"])).toBe(false);

  expect(isEnumColumn(p.enum("ENUM")[" enum"])).toBe(true);
});

test("reference column", () => {
  expect(isReferenceColumn(p.string()[" column"])).toBe(false);

  expect(isReferenceColumn(p.string().references(".id")[" column"])).toBe(true);
});
