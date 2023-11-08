import { expect, test } from "vitest";

import * as p from "./index";

test("table", () => {
  const t = p.createTable({
    id: p.string(),
  });

  expect(t.id).toBeTruthy();
});

test("enum", () => {
  const e = p.createEnum(["ONE", "TWO"]);

  expect(e).toStrictEqual(["ONE", "TWO"]);
});

test("schema table", () => {
  const s = p.createSchema({
    t: p.createTable({
      id: p.string(),
      age: p.int().optional(),
    }),
  });
  expect(s.enums).toStrictEqual({});
  expect(s.tables.t.age).toBeTruthy();
  expect(s.tables.t.id).toBeTruthy();
});

test("schema enum", () => {
  const s = p.createSchema({
    e: p.createEnum(["ONE", "TWO"]),
    t: p.createTable({
      id: p.string(),
      age: p.enum("e"),
    }),
  });
  expect(s.enums).toStrictEqual({ e: ["ONE", "TWO"] });
  expect(s.tables.t.age).toBeTruthy();
  expect(s.tables.t.id).toBeTruthy();
});

test("schema references", () => {
  const s = p.createSchema({
    a: p.createTable({
      id: p.int(),
    }),
    t: p.createTable({
      id: p.string(),
      ageId: p.int().references("a.id"),
    }),
  });
  expect(s.enums).toStrictEqual({});
  expect(s.tables.t).toBeTruthy();
  expect(s.tables.a).toBeTruthy();
});

test("schema virtual", () => {
  const s = p.createSchema({
    a: p.createTable({
      id: p.int(),
      b: p.virtual("t.ageId"),
    }),
    t: p.createTable({
      id: p.string(),
      ageId: p.int().references("a.id"),
      selfId: p.string().references("t.id"),
    }),
  });
  expect(s.enums).toStrictEqual({});
  expect(s.tables.t).toBeTruthy();
  expect(s.tables.a).toBeTruthy();
});
