import { createSchema } from "@/schema/schema.js";
import { expect, test } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { buildOrderByConditions } from "./sort.js";

const schema = createSchema((p) => ({
  PetKind: p.createEnum(["CAT", "DOG"]),
  Pet: p.createTable({
    id: p.string(),
    names: p.string().list(),
    age: p.int().optional(),
    bigAge: p.bigint().optional(),
    bigAges: p.bigint().list(),
    kind: p.enum("PetKind").optional(),
    personId: p.bigint().references("Person.id"),
    person: p.one("personId"),
  }),
  Person: p.createTable({
    id: p.bigint(),
  }),
}));

test("cursor encoding handles default order by condition", () => {
  const orderByConditions = buildOrderByConditions({
    orderBy: { id: "asc" },
    table: schema.tables.Pet,
  });

  const record = { id: "abc" };

  const decoded = decodeCursor(
    encodeCursor(record, orderByConditions),
    orderByConditions,
  );

  expect(decoded).toEqual([["id", "abc"]]);
});

test("cursor encoding handles custom order by condition", () => {
  const orderByConditions = buildOrderByConditions({
    orderBy: { age: "desc" },
    table: schema.tables.Pet,
  });

  const record = { id: "abc", age: 10 };

  const decoded = decodeCursor(
    encodeCursor(record, orderByConditions),
    orderByConditions,
  );

  expect(decoded).toEqual([
    ["age", 10],
    ["id", "abc"],
  ]);
});

test("cursor encoding handles null values", () => {
  const orderByConditions = buildOrderByConditions({
    orderBy: { age: "desc" },
    table: schema.tables.Pet,
  });

  const record = { id: "abc", age: null };

  const decoded = decodeCursor(
    encodeCursor(record, orderByConditions),
    orderByConditions,
  );

  expect(decoded).toEqual([
    ["age", null],
    ["id", "abc"],
  ]);
});

test("cursor encoding handles bigint values", () => {
  const orderByConditions = buildOrderByConditions({
    orderBy: { bigAge: "desc" },
    table: schema.tables.Pet,
  });

  const record = { id: "abc", bigAge: 20n };

  const decoded = decodeCursor(
    encodeCursor(record, orderByConditions),
    orderByConditions,
  );

  expect(decoded).toEqual([
    ["bigAge", 20n],
    ["id", "abc"],
  ]);
});

test("cursor encoding handles bigint list values", () => {
  const orderByConditions = buildOrderByConditions({
    orderBy: { bigAges: "desc" },
    table: schema.tables.Pet,
  });

  const record = { id: "abc", bigAges: [20n, -12n] };

  const decoded = decodeCursor(
    encodeCursor(record, orderByConditions),
    orderByConditions,
  );

  expect(decoded).toEqual([
    ["bigAges", [20n, -12n]],
    ["id", "abc"],
  ]);
});
