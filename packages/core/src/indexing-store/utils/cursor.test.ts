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
    kind: p.enum("PetKind").optional(),
    personId: p.bigint().references("Person.id"),
    person: p.one("personId"),
  }),
  Person: p.createTable({
    id: p.bigint(),
  }),
}));

const orderByConditions = buildOrderByConditions({
  orderBy: { id: "asc" },
  table: schema.tables.Pet,
});

test("encodeCursor ...", () => {
  const record = { id: "abc" };

  const cursor = encodeCursor(record, orderByConditions);

  expect(cursor).toEqual("blah");
});
