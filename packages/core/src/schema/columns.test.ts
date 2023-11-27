import { expect, test } from "vitest";

import {
  _enum,
  bigint,
  boolean,
  bytes,
  float,
  int,
  many,
  one,
  string,
} from "./columns.js";

test("string", () => {
  const c = string();

  expect(c[" column"].type).toBe("string");
  expect(c[" column"].references).toBe(undefined);
  expect(c[" column"].optional).toBe(false);
  expect(c[" column"].list).toBe(false);
});

test("int", () => {
  const c = int();

  expect(c[" column"].type).toBe("int");
  expect(c[" column"].references).toBe(undefined);
  expect(c[" column"].optional).toBe(false);
  expect(c[" column"].list).toBe(false);
});

test("float", () => {
  const c = float();

  expect(c[" column"].type).toBe("float");
  expect(c[" column"].references).toBe(undefined);
  expect(c[" column"].optional).toBe(false);
  expect(c[" column"].list).toBe(false);
});

test("boolean", () => {
  const c = boolean();

  expect(c[" column"].type).toBe("boolean");
  expect(c[" column"].references).toBe(undefined);
  expect(c[" column"].optional).toBe(false);
  expect(c[" column"].list).toBe(false);
});

test("bytes", () => {
  const c = bytes();

  expect(c[" column"].type).toBe("bytes");
  expect(c[" column"].references).toBe(undefined);
  expect(c[" column"].optional).toBe(false);
  expect(c[" column"].list).toBe(false);
});

test("bigint", () => {
  const c = bigint();

  expect(c[" column"].type).toBe("bigint");
  expect(c[" column"].references).toBe(undefined);
  expect(c[" column"].optional).toBe(false);
  expect(c[" column"].list).toBe(false);
});

test("enum", () => {
  const c = _enum("ENUM");

  expect(c[" enum"].type).toBe("ENUM");
  expect(c[" enum"].optional).toBe(false);
});

test("one", () => {
  const c = one("OtherColumn");

  expect(c.referenceColumn).toBe("OtherColumn");
});

test("many", () => {
  const c = many("OtherTable.OtherColumn");

  expect(c.referenceTable).toBe("OtherTable");
  expect(c.referenceColumn).toBe("OtherColumn");
});

test("optional", () => {
  const c = string().optional();

  expect(c[" column"].type).toBe("string");
  expect(c[" column"].references).toBe(undefined);
  expect(c[" column"].optional).toBe(true);
  expect(c[" column"].list).toBe(false);
});

test("list", () => {
  const c = string().list();

  expect(c[" column"].type).toBe("string");
  expect(c[" column"].references).toBe(undefined);
  expect(c[" column"].optional).toBe(false);
  expect(c[" column"].list).toBe(true);
});

test("referenes", () => {
  const c = string().references("OtherTable.id");

  expect(c[" column"].type).toBe("string");
  expect(c[" column"].references).toBe("OtherTable.id");
  expect(c[" column"].optional).toBe(false);
  expect(c[" column"].list).toBe(false);
});

test("chaining modifiers 1", () => {
  const c = string().list().optional();

  expect(c[" column"].type).toBe("string");
  expect(c[" column"].references).toBe(undefined);
  expect(c[" column"].optional).toBe(true);
  expect(c[" column"].list).toBe(true);
});

test("chaining modifiers 2", () => {
  const c = string().optional().list();

  expect(c[" column"].type).toBe("string");
  expect(c[" column"].references).toBe(undefined);
  expect(c[" column"].optional).toBe(true);
  expect(c[" column"].list).toBe(true);
});

test("chaining modifiers 3", () => {
  const c = string().optional().references("OtherTable.id");

  expect(c[" column"].type).toBe("string");
  expect(c[" column"].references).toBe("OtherTable.id");
  expect(c[" column"].optional).toBe(true);
  expect(c[" column"].list).toBe(false);
});

test("chaining modifiers 4", () => {
  const c = string().references("OtherTable.id").optional();

  expect(c[" column"].type).toBe("string");
  expect(c[" column"].references).toBe("OtherTable.id");
  expect(c[" column"].optional).toBe(true);
  expect(c[" column"].list).toBe(false);
});

test("chaining modifiers 5", () => {
  const e = _enum("ENUM").optional().list();

  expect(e[" enum"].type).toBe("ENUM");
  expect(e[" enum"].optional).toBe(true);
  expect(e[" enum"].list).toBe(true);
});
