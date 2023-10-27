import { expect, test } from "vitest";

import { p } from "./p";
import { isEnumColumn, isReferenceColumn, isVirtualColumn } from "./utils";

test("virtual column", () => {
  expect(isVirtualColumn(p.string())).toBe(false);

  expect(isVirtualColumn(p.virtual("."))).toBe(true);
});

test("enum column", () => {
  expect(isEnumColumn(p.string())).toBe(false);

  expect(isEnumColumn(p.enum("ENUM"))).toBe(true);
});

test("reference column", () => {
  expect(isReferenceColumn(p.string())).toBe(false);

  expect(isReferenceColumn(p.string({ references: ".id" }))).toBe(true);
});
