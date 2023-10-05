import { assertType, test } from "vitest";

import { createSchema, createTable } from "./ts-schema";
import { RecoverColumnType, RecoverTableType, Schema } from "./ts-types";

test("column scalar", () => {
  const table = createTable("table").addColumn("id", "string");

  const column = table.table.columns;

  type t = RecoverColumnType<(typeof column)["id"]>;
  //   ^?

  assertType<t>({} as string);
});

test("column list", () => {
  const table = createTable("table").addColumn("age", "string", {
    list: true,
  });

  const column = table.table.columns;

  type t = RecoverColumnType<(typeof column)["age"]>;
  //   ^?

  assertType<t>({} as string[]);
});

test("table", () => {
  const table = createTable("table")
    .addColumn("id", "string")
    .addColumn("age", "number");

  type t = RecoverTableType<(typeof table)["table"]>;
  //   ^?

  assertType<t>({} as { table: { id: string; age: number } });
});

test("table optional", () => {
  const table = createTable("table")
    .addColumn("id", "string")
    .addColumn("age", "number", { optional: true });

  type t = RecoverTableType<(typeof table)["table"]>;
  //   ^?

  assertType<t>({} as { table: { id: string; age?: number } });
});

test("schema", () => {
  const schema = createSchema([createTable("table").addColumn("id", "string")]);

  assertType<Schema>(schema);
});
