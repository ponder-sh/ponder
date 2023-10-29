import { expect, test } from "vitest";

import { p } from "./p";
import { createEnum, createSchema, createTable } from "./schema";

test("table", () => {
  const t = createTable({
    id: p.string(),
  });

  expect(t.id.column).toBeTruthy();
});

test("enum", () => {
  const e = createEnum(["ONE", "TWO"]);

  expect(e).toStrictEqual(["ONE", "TWO"]);
});

test("schema table", () => {
  const s = createSchema({
    t: createTable({
      id: p.string(),
      age: p.int().optional(),
    }),
  });
  expect(s.enums).toStrictEqual({});
  expect(s.tables.t.age).toBeTruthy();
  expect(s.tables.t.id).toBeTruthy();
});

test("schema enum", () => {
  const s = createSchema({
    e: createEnum(["ONE", "TWO"]),
    t: createTable({
      id: p.string(),
      age: p.enum("e"),
    }),
  });
  expect(s.enums).toStrictEqual({ e: ["ONE", "TWO"] });
  expect(s.tables.t.age).toBeTruthy();
  expect(s.tables.t.id).toBeTruthy();
});

test("schema references", () => {
  const s = createSchema({
    a: createTable({
      id: p.int(),
    }),
    t: createTable({
      id: p.string(),
      ageId: p.int().references("a.id"),
    }),
  });
  expect(s.enums).toStrictEqual({});
  expect(s.tables.t).toBeTruthy();
  expect(s.tables.a).toBeTruthy();
});

test("schema virtual", () => {
  const s = createSchema({
    a: createTable({
      id: p.int(),
      b: p.virtual("t.ageId"),
    }),
    t: createTable({
      id: p.string(),
      ageId: p.int().references("a.id"),
    }),
  });
  expect(s.enums).toStrictEqual({});
  expect(s.tables.t).toBeTruthy();
  expect(s.tables.a).toBeTruthy();
});
