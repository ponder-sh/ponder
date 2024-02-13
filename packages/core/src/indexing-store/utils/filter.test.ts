import { createSchema } from "@/schema/schema.js";
import { expect, test } from "vitest";
import { buildWhereConditions } from "./filter.js";

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

test("buildWhereConditions handles equals shortcut", () => {
  const conditions = buildWhereConditions({
    where: { id: "abc" },
    table: schema.tables.Pet,
    encoding: "sqlite",
  });

  expect(conditions).toEqual([["id", "=", "abc"]]);
});

test("buildWhereConditions handles not", () => {
  const conditions = buildWhereConditions({
    where: { id: { not: "abc" } },
    table: schema.tables.Pet,
    encoding: "sqlite",
  });

  expect(conditions).toEqual([["id", "!=", "abc"]]);
});

test("buildWhereConditions handles multiple conditions for one column", () => {
  const conditions = buildWhereConditions({
    where: { id: { contains: "abc", notStartsWith: "z" } },
    table: schema.tables.Pet,
    encoding: "sqlite",
  });

  expect(conditions).toEqual([
    ["id", "like", "%abc%"],
    ["id", "not like", "z%"],
  ]);
});

test("buildWhereConditions uses specified encoding", () => {
  const conditionsSqlite = buildWhereConditions({
    where: { bigAge: { lt: 10n } },
    table: schema.tables.Pet,
    encoding: "sqlite",
  });

  expect(conditionsSqlite).toEqual([
    [
      "bigAge",
      "<",
      "0000000000000000000000000000000000000000000000000000000000000000000000000000010",
    ],
  ]);

  const conditionsPostgres = buildWhereConditions({
    where: { bigAge: { lt: 10n } },
    table: schema.tables.Pet,
    encoding: "postgres",
  });

  expect(conditionsPostgres).toEqual([["bigAge", "<", 10n]]);
});

test("buildWhereConditions handles list filters with encoding", () => {
  const conditions = buildWhereConditions({
    where: { bigAge: { in: [12n, 15n] } },
    table: schema.tables.Pet,
    encoding: "sqlite",
  });

  expect(conditions).toEqual([
    [
      "bigAge",
      "in",
      [
        "0000000000000000000000000000000000000000000000000000000000000000000000000000012",
        "0000000000000000000000000000000000000000000000000000000000000000000000000000015",
      ],
    ],
  ]);
});

test("buildWhereConditions filters on reference column", () => {
  const conditions = buildWhereConditions({
    where: { personId: 5n },
    table: schema.tables.Pet,
    encoding: "postgres",
  });

  expect(conditions).toEqual([["personId", "=", 5n]]);
});

test("buildWhereConditions handles list column 'has' and 'notHas' special case", () => {
  const conditions = buildWhereConditions({
    where: { names: { has: "Marty" } },
    table: schema.tables.Pet,
    encoding: "sqlite",
  });

  expect(conditions).toEqual([["names", "like", "%Marty%"]]);
});

test("buildWhereConditions throws for unknown column", () => {
  expect(() =>
    buildWhereConditions({
      where: { someFakeColumn: { equals: false } },
      table: schema.tables.Pet,
      encoding: "sqlite",
    }),
  ).toThrow(
    "Invalid filter. Column does not exist. Got 'someFakeColumn', expected one of ['id', 'names', 'age', 'bigAge', 'kind', 'personId']",
  );
});

test("buildWhereConditions throws for virtual column", () => {
  expect(() =>
    buildWhereConditions({
      where: { person: { equals: 5n } },
      table: schema.tables.Pet,
      encoding: "sqlite",
    }),
  ).toThrow("Invalid filter. Cannot filter on virtual column 'person'");
});

test("buildWhereConditions throws for invalid filter condition", () => {
  expect(() =>
    buildWhereConditions({
      // @ts-ignore
      where: { personId: { notACondition: 5n } },
      table: schema.tables.Pet,
      encoding: "sqlite",
    }),
  ).toThrow(
    "Invalid filter condition for column 'personId'. Got 'notACondition', expected one of ['equals', 'not', 'in', 'notIn', 'gt', 'lt', 'gte', 'lte']",
  );
});
