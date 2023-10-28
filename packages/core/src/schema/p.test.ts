import { expect, test } from "vitest";

import { p } from "./p";

test("string", () => {
  const c = p.string();

  expect(c.column.type).toBe("string");
  expect(c.column.references).toBe(undefined);
  expect(c.column.optional).toBe(false);
  expect(c.column.list).toBe(false);
});

test("int", () => {
  const c = p.int();

  expect(c.column.type).toBe("int");
  expect(c.column.references).toBe(undefined);
  expect(c.column.optional).toBe(false);
  expect(c.column.list).toBe(false);
});

test("float", () => {
  const c = p.float();

  expect(c.column.type).toBe("float");
  expect(c.column.references).toBe(undefined);
  expect(c.column.optional).toBe(false);
  expect(c.column.list).toBe(false);
});

test("boolean", () => {
  const c = p.boolean();

  expect(c.column.type).toBe("boolean");
  expect(c.column.references).toBe(undefined);
  expect(c.column.optional).toBe(false);
  expect(c.column.list).toBe(false);
});

test("bytes", () => {
  const c = p.bytes();

  expect(c.column.type).toBe("bytes");
  expect(c.column.references).toBe(undefined);
  expect(c.column.optional).toBe(false);
  expect(c.column.list).toBe(false);
});

test("bigint", () => {
  const c = p.bigint();

  expect(c.column.type).toBe("bigint");
  expect(c.column.references).toBe(undefined);
  expect(c.column.optional).toBe(false);
  expect(c.column.list).toBe(false);
});

test.todo("enum", () => {});

test.todo("virtual", () => {});

test("optional", () => {
  const c = p.string().optional();

  expect(c.column.type).toBe("string");
  expect(c.column.references).toBe(undefined);
  expect(c.column.optional).toBe(true);
  expect(c.column.list).toBe(false);
});

test("list", () => {
  const c = p.string().list();

  expect(c.column.type).toBe("string");
  expect(c.column.references).toBe(undefined);
  expect(c.column.optional).toBe(false);
  expect(c.column.list).toBe(true);
});

test("referenes", () => {
  const c = p.string().references("OtherTable.id");

  expect(c.column.type).toBe("string");
  expect(c.column.references).toBe("OtherTable.id");
  expect(c.column.optional).toBe(false);
  expect(c.column.list).toBe(false);
});

test("chaining modifiers 1", () => {
  const c = p.string().list().optional();

  expect(c.column.type).toBe("string");
  expect(c.column.references).toBe(undefined);
  expect(c.column.optional).toBe(true);
  expect(c.column.list).toBe(true);
});

test("chaining modifiers 2", () => {
  const c = p.string().optional().list();

  expect(c.column.type).toBe("string");
  expect(c.column.references).toBe(undefined);
  expect(c.column.optional).toBe(true);
  expect(c.column.list).toBe(true);
});

test("chaining modifiers 3", () => {
  const c = p.string().optional().references("OtherTable.id");

  expect(c.column.type).toBe("string");
  expect(c.column.references).toBe("OtherTable.id");
  expect(c.column.optional).toBe(true);
  expect(c.column.list).toBe(false);
});

test("chaining modifiers 4", () => {
  const c = p.string().references("OtherTable.id").optional();

  expect(c.column.type).toBe("string");
  expect(c.column.references).toBe("OtherTable.id");
  expect(c.column.optional).toBe(true);
  expect(c.column.list).toBe(false);
});
