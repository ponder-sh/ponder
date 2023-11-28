import { expect, test } from "vitest";

import { createSchema } from "./schema.js";

test("schema table", () => {
  const s = createSchema((p) => ({
    t: p.createTable({
      id: p.string(),
      age: p.int().optional(),
    }),
  }));
  expect(s.enums).toStrictEqual({});
  expect(s.tables.t.age).toBeTruthy();
  expect(s.tables.t.id).toBeTruthy();
});

test("schema enum", () => {
  const s = createSchema((p) => ({
    e: p.createEnum(["ONE", "TWO"]),
    t: p.createTable({
      id: p.string(),
      age: p.enum("e"),
    }),
  }));
  expect(s.enums).toStrictEqual({ e: ["ONE", "TWO"] });
  expect(s.tables.t.age).toBeTruthy();
  expect(s.tables.t.id).toBeTruthy();
});

test("schema references", () => {
  const s = createSchema((p) => ({
    a: p.createTable({
      id: p.int(),
    }),
    t: p.createTable({
      id: p.string(),
      ageId: p.int().references("a.id"),
    }),
  }));
  expect(s.enums).toStrictEqual({});
  expect(s.tables.t).toBeTruthy();
  expect(s.tables.a).toBeTruthy();
});

test("schema one", () => {
  const s = createSchema((p) => ({
    a: p.createTable({
      id: p.int(),
    }),
    t: p.createTable({
      id: p.string(),
      ageId: p.int().references("a.id"),
      age: p.one("ageId"),
    }),
  }));
  expect(s.enums).toStrictEqual({});
  expect(s.tables.t).toBeTruthy();
  expect(s.tables.a).toBeTruthy();
});

test("schema many", () => {
  const s = createSchema((p) => ({
    a: p.createTable({
      id: p.int(),
      b: p.many("t.ageId"),
    }),
    t: p.createTable({
      id: p.string(),
      ageId: p.int().references("a.id"),
      selfId: p.string().references("t.id"),
    }),
  }));
  expect(s.enums).toStrictEqual({});
  expect(s.tables.t).toBeTruthy();
  expect(s.tables.a).toBeTruthy();
});
