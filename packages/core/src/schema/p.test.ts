import { expect, test } from "vitest";

import { p } from "./p";

test("string", () => {
  const c = p.string();

  expect(c.type).toBe("string");
  expect(c.references).toBe(undefined);
  expect(c.optional).toBe(false);
  expect(c.list).toBe(false);
});

test("int", () => {
  const c = p.int();

  expect(c.type).toBe("int");
  expect(c.references).toBe(undefined);
  expect(c.optional).toBe(false);
  expect(c.list).toBe(false);
});

test("float", () => {
  const c = p.float();

  expect(c.type).toBe("float");
  expect(c.references).toBe(undefined);
  expect(c.optional).toBe(false);
  expect(c.list).toBe(false);
});

test("boolean", () => {
  const c = p.boolean();

  expect(c.type).toBe("boolean");
  expect(c.references).toBe(undefined);
  expect(c.optional).toBe(false);
  expect(c.list).toBe(false);
});

test("bytes", () => {
  const c = p.bytes();

  expect(c.type).toBe("bytes");
  expect(c.references).toBe(undefined);
  expect(c.optional).toBe(false);
  expect(c.list).toBe(false);
});

test("bigint", () => {
  const c = p.bigint();

  expect(c.type).toBe("bigint");
  expect(c.references).toBe(undefined);
  expect(c.optional).toBe(false);
  expect(c.list).toBe(false);
});

test("enum", () => {
  const c = p.enum("ENUM");

  expect(c.type).toBe("ENUM");
  expect(c.optional).toBe(false);
});

test("virtual", () => {
  const c = p.virtual("TABLE.COLUMN");

  expect(c.referenceTable).toBe("TABLE");
  expect(c.referenceColumn).toBe("COLUMN");
});

test("optional", () => {
  const c = p.string({ optional: true });

  expect(c.references).toBe(undefined);
  expect(c.optional).toBe(true);
  expect(c.list).toBe(false);
});

test("list", () => {
  const c = p.string({ list: true });

  expect(c.references).toBe(undefined);
  expect(c.optional).toBe(false);
  expect(c.list).toBe(true);
});
