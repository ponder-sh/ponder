import { createSchema } from "@/schema/schema.js";
import { expect, test } from "vitest";
import { buildOrderByConditions, reverseOrderByConditions } from "./sort.js";

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
    json: p.json().optional(),
  }),
  Person: p.createTable({
    id: p.bigint(),
  }),
}));

test("buildOrderByConditions defaults to id ascending", () => {
  const conditions = buildOrderByConditions({
    orderBy: undefined,
    table: schema.Pet.table,
  });

  expect(conditions).toEqual([["id", "asc"]]);
});

test("buildOrderByConditions adds secondary sort for non-id columns using the same direction", () => {
  const conditionsAsc = buildOrderByConditions({
    orderBy: { names: "asc" },
    table: schema.Pet.table,
  });

  expect(conditionsAsc).toEqual([
    ["names", "asc"],
    ["id", "asc"],
  ]);

  const conditionsDesc = buildOrderByConditions({
    orderBy: { names: "desc" },
    table: schema.Pet.table,
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
      table: schema.Pet.table,
    }),
  ).toThrow("Cannot sort by multiple columns.");
});

test("buildOrderByConditions throws for unknown column", () => {
  expect(() =>
    buildOrderByConditions({
      orderBy: { someFakeColumn: "asc" },
      table: schema.Pet.table,
    }),
  ).toThrow(
    "Invalid sort. Column does not exist. Got 'someFakeColumn', expected one of ['id', 'names', 'age', 'bigAge', 'kind', 'personId', 'json']",
  );
});

test("buildOrderByConditions throws for virtual column", () => {
  expect(() =>
    buildOrderByConditions({
      orderBy: { person: "desc" },
      table: schema.Pet.table,
    }),
  ).toThrow("Invalid sort. Cannot sort on virtual column 'person'");
});

test("buildOrderByConditions throws for json column", () => {
  expect(() =>
    buildOrderByConditions({
      orderBy: { json: "desc" },
      table: schema.Pet.table,
    }),
  ).toThrow("Invalid sort. Cannot sort on json column 'json'");
});

test("buildOrderByConditions throws for invalid order direction", () => {
  expect(() =>
    buildOrderByConditions({
      // @ts-ignore
      orderBy: { personId: "aaaaasc" },
      table: schema.Pet.table,
    }),
  ).toThrow("Invalid sort direction. Got 'aaaaasc', expected 'asc' or 'desc'");
});

test("reverseOrderByConditions reverses with one condition", () => {
  const conditions = buildOrderByConditions({
    orderBy: undefined,
    table: schema.Pet.table,
  });

  expect(conditions).toEqual([["id", "asc"]]);

  const reversedConditions = reverseOrderByConditions(conditions);
  expect(reversedConditions).toEqual([["id", "desc"]]);
});

test("reverseOrderByConditions reverses with two conditions", () => {
  const conditions = buildOrderByConditions({
    orderBy: { names: "desc" },
    table: schema.Pet.table,
  });

  expect(conditions).toEqual([
    ["names", "desc"],
    ["id", "desc"],
  ]);

  const reversedConditions = reverseOrderByConditions(conditions);
  expect(reversedConditions).toEqual([
    ["names", "asc"],
    ["id", "asc"],
  ]);
});
