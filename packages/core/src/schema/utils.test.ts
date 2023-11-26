import { expect, test } from "vitest";

import * as p from "./index.js";
import { isEnumColumn, isReferenceColumn, isVirtualColumn } from "./utils.js";

test("virtual column", () => {
  expect(isVirtualColumn(p.string()[" column"])).toBe(false);

  expect(isVirtualColumn(p.many("a.b"))).toBe(true);
});

test("enum column", () => {
  expect(isEnumColumn(p.string()[" column"])).toBe(false);

  expect(isEnumColumn(p.enum("ENUM")[" enum"])).toBe(true);
});

test("reference column", () => {
  expect(isReferenceColumn(p.string()[" column"])).toBe(false);

  expect(isReferenceColumn(p.string().references(".id")[" column"])).toBe(true);
});
