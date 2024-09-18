import { createSchema } from "@/schema/schema.js";
import type { ExpressionBuilder } from "kysely";
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

const buildMockEb = () => {
  return {
    eb: (...args: any[]) => args,
    and: (...args: any[]) => ({ and: args[0] }),
    or: (...args: any[]) => ({ or: args[0] }),
  } as unknown as ExpressionBuilder<any, string>;
};

test("buildWhereConditions handles equals shortcut", () => {
  const conditions = buildWhereConditions({
    eb: buildMockEb(),
    where: { id: "abc" },
    table: schema.Pet.table,
    dialect: "sqlite",
  });

  expect(conditions).toEqual({
    and: [["id", "=", "abc"]],
  });
});

test("buildWhereConditions handles not", () => {
  const conditions = buildWhereConditions({
    eb: buildMockEb(),
    where: { id: { not: "abc" } },
    table: schema.Pet.table,
    dialect: "sqlite",
  });

  expect(conditions).toEqual({
    and: [["id", "!=", "abc"]],
  });
});

test("buildWhereConditions handles multiple conditions for one column", () => {
  const conditions = buildWhereConditions({
    eb: buildMockEb(),
    where: { id: { contains: "abc", notStartsWith: "z" } },
    table: schema.Pet.table,
    dialect: "sqlite",
  });

  expect(conditions).toEqual({
    and: [
      ["id", "like", "%abc%"],
      ["id", "not like", "z%"],
    ],
  });
});

test("buildWhereConditions uses specified encoding", () => {
  const conditionsSqlite = buildWhereConditions({
    eb: buildMockEb(),
    where: { bigAge: { lt: 10n } },
    table: schema.Pet.table,
    dialect: "sqlite",
  });

  expect(conditionsSqlite).toEqual({
    and: [
      [
        "bigAge",
        "<",
        "0000000000000000000000000000000000000000000000000000000000000000000000000000010",
      ],
    ],
  });

  const conditionsPostgres = buildWhereConditions({
    eb: buildMockEb(),
    where: { bigAge: { lt: 10n } },
    table: schema.Pet.table,
    dialect: "postgres",
  });

  expect(conditionsPostgres).toEqual({
    and: [["bigAge", "<", 10n]],
  });
});

test("buildWhereConditions handles list filters with encoding", () => {
  const conditions = buildWhereConditions({
    eb: buildMockEb(),
    where: { bigAge: { in: [12n, 15n] } },
    table: schema.Pet.table,
    dialect: "sqlite",
  });

  expect(conditions).toEqual({
    and: [
      [
        "bigAge",
        "in",
        [
          "0000000000000000000000000000000000000000000000000000000000000000000000000000012",
          "0000000000000000000000000000000000000000000000000000000000000000000000000000015",
        ],
      ],
    ],
  });
});

test("buildWhereConditions filters on reference column", () => {
  const conditions = buildWhereConditions({
    eb: buildMockEb(),
    where: { personId: 5n },
    table: schema.Pet.table,
    dialect: "postgres",
  });

  expect(conditions).toEqual({
    and: [["personId", "=", 5n]],
  });
});

test("buildWhereConditions handles list column 'has' and 'notHas' special case", () => {
  const conditions = buildWhereConditions({
    eb: buildMockEb(),
    where: { names: { has: "Marty" } },
    table: schema.Pet.table,
    dialect: "sqlite",
  });

  expect(conditions).toEqual({ and: [["names", "like", "%Marty%"]] });
});

test("buildWhereConditions handles or operator", () => {
  const conditions = buildWhereConditions({
    eb: buildMockEb(),
    where: {
      bigAge: { lt: 10n },
      OR: [{ id: { contains: "abc" } }, { id: { notStartsWith: "z" } }],
    },
    table: schema.Pet.table,
    dialect: "postgres",
  });

  expect(conditions).toEqual({
    and: [
      ["bigAge", "<", 10n],
      {
        or: [
          { and: [["id", "like", "%abc%"]] },
          { and: [["id", "not like", "z%"]] },
        ],
      },
    ],
  });
});

test("buildWhereConditions throws for unknown column", () => {
  expect(() =>
    buildWhereConditions({
      eb: buildMockEb(),
      where: { someFakeColumn: { equals: false } },
      table: schema.Pet.table,
      dialect: "sqlite",
    }),
  ).toThrow(
    "Invalid filter. Column does not exist. Got 'someFakeColumn', expected one of ['id', 'names', 'age', 'bigAge', 'kind', 'personId']",
  );
});

test("buildWhereConditions throws for virtual column", () => {
  expect(() =>
    buildWhereConditions({
      eb: buildMockEb(),
      where: { person: { equals: 5n } },
      table: schema.Pet.table,
      dialect: "sqlite",
    }),
  ).toThrow("Invalid filter. Cannot filter on virtual column 'person'");
});

test("buildWhereConditions throws for invalid filter condition", () => {
  expect(() =>
    buildWhereConditions({
      eb: buildMockEb(),
      // @ts-ignore
      where: { personId: { notACondition: 5n } },
      table: schema.Pet.table,
      dialect: "sqlite",
    }),
  ).toThrow(
    "Invalid filter condition for column 'personId'. Got 'notACondition', expected one of ['equals', 'not', 'in', 'notIn', 'gt', 'lt', 'gte', 'lte']",
  );
});
