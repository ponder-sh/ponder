import { createSchema } from "@/schema/schema.js";
import { expect, test } from "vitest";
import { buildOrderByConditions } from "./sort.js";

const schema = createSchema((p) => ({
  PetKind: p.createEnum(["CAT", "DOG"]),
  Pet: p.createTable({
    id: p.string(),
    names: p.string().list(),
    age: p.int().optional(),
    bigAge: p.bigint().optional(),
    kind: p.enum("PetKind").optional(),
    personId: p.bigint().references("Person.id"),
    person: p.one("personId"),
  }),
  Person: p.createTable({
    id: p.bigint(),
  }),
}));

test("buildOrderByConditions defaults to id ascending", () => {
  const conditions = buildOrderByConditions({
    orderBy: undefined,
    table: schema.tables.Pet,
  });

  expect(conditions).toEqual([["id", "asc"]]);
});

test("buildOrderByConditions adds secondary sort for non-id columns using the same direction", () => {
  const conditionsAsc = buildOrderByConditions({
    orderBy: { names: "asc" },
    table: schema.tables.Pet,
  });

  expect(conditionsAsc).toEqual([
    ["names", "asc"],
    ["id", "asc"],
  ]);

  const conditionsDesc = buildOrderByConditions({
    orderBy: { names: "desc" },
    table: schema.tables.Pet,
  });

  expect(conditionsDesc).toEqual([
    ["names", "desc"],
    ["id", "desc"],
  ]);
});

test("buildOrderByConditions throws for sorting on multiple columns", () => {
  expect(() =>
    buildOrderByConditions({
      orderBy: { names: "desc", age: "asc" },
      table: schema.tables.Pet,
    }),
  ).toThrow("Cannot sort by multiple columns.");
});

test("buildOrderByConditions throws for unknown column", () => {
  expect(() =>
    buildOrderByConditions({
      orderBy: { someFakeColumn: "asc" },
      table: schema.tables.Pet,
    }),
  ).toThrow(
    "Invalid sort. Column does not exist. Got 'someFakeColumn', expected one of ['id', 'names', 'age', 'bigAge', 'kind', 'personId']",
  );
});

test("buildOrderByConditions throws for virtual column", () => {
  expect(() =>
    buildOrderByConditions({
      orderBy: { person: "desc" },
      table: schema.tables.Pet,
    }),
  ).toThrow("Invalid sort. Cannot filter on virtual column 'person'");
});

test("buildOrderByConditions throws for invalid order direction", () => {
  expect(() =>
    buildOrderByConditions({
      // @ts-ignore
      orderBy: { personId: "aaaaasc" },
      table: schema.tables.Pet,
    }),
  ).toThrow("Invalid sort direction. Got 'aaaaasc', expected 'asc' or 'desc'");
});
