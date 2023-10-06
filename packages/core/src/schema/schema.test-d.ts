import { assertType, test } from "vitest";

import { createSchema, createTable } from "./schema";
import { RecoverColumnType, RecoverTableType, Schema } from "./types";

test("column int", () => {
  const table = createTable("table").addColumn("x", "int");

  const column = table.table.columns;

  type t = RecoverColumnType<(typeof column)["x"]>;
  //   ^?

  assertType<t>({} as number);
});

test("column float", () => {
  const table = createTable("table").addColumn("x", "float");

  const column = table.table.columns;

  type t = RecoverColumnType<(typeof column)["x"]>;
  //   ^?

  assertType<t>({} as number);
});

test("column bytes", () => {
  const table = createTable("table").addColumn("x", "bytes");

  const column = table.table.columns;

  type t = RecoverColumnType<(typeof column)["x"]>;
  //   ^?

  assertType<t>({} as `0x{string}`);
});

test("column string", () => {
  const table = createTable("table").addColumn("x", "string");

  const column = table.table.columns;

  type t = RecoverColumnType<(typeof column)["x"]>;
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
    .addColumn("age", "int");

  type t = RecoverTableType<(typeof table)["table"]>;
  //   ^?

  assertType<t>({} as { table: { id: string; age: number } });
});

test("table optional", () => {
  const table = createTable("table")
    .addColumn("id", "string")
    .addColumn("age", "int", { optional: true });

  type t = RecoverTableType<(typeof table)["table"]>;
  //   ^?

  assertType<t>({} as { table: { id: string; age?: number } });
});

test("schema", () => {
  const schema = createSchema([createTable("table").addColumn("id", "string")]);

  assertType<Schema>(schema);
});
