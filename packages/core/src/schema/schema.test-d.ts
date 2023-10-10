import { assertType, test } from "vitest";

import { createColumn, createSchema } from "./schema";
import { RecoverColumnType, RecoverTableType, Schema } from "./types";

test("column int", () => {
  const table = createColumn("id", "int").addColumn("x", "int");

  type t = RecoverColumnType<(typeof table)["table"]["x"]>;
  //   ^?

  assertType<t>({} as number);
});

test("column float", () => {
  const table = createColumn("id", "int").addColumn("x", "float");

  type t = RecoverColumnType<(typeof table)["table"]["x"]>;
  //   ^?

  assertType<t>({} as number);
});

test("column bytes", () => {
  const table = createColumn("id", "int").addColumn("x", "bytes");

  type t = RecoverColumnType<(typeof table)["table"]["x"]>;
  //   ^?

  assertType<t>({} as `0x{string}`);
});

test("column string", () => {
  const table = createColumn("id", "int").addColumn("x", "string");

  type t = RecoverColumnType<(typeof table)["table"]["x"]>;
  //   ^?

  assertType<t>({} as string);
});

test("column list", () => {
  const table = createColumn("id", "int").addColumn("x", "string", {
    list: true,
  });

  type t = RecoverColumnType<(typeof table)["table"]["x"]>;
  //   ^?

  assertType<t>({} as string[]);
});

test("table", () => {
  const table = createColumn("id", "string").addColumn("age", "int");

  type t = RecoverTableType<(typeof table)["table"]>;
  //   ^?

  assertType<t>({} as { id: string; age: number });
});

test("table optional", () => {
  const table = createColumn("id", "string").addColumn("age", "int", {
    optional: true,
  });

  type t = RecoverTableType<(typeof table)["table"]>;
  //   ^?

  assertType<t>({} as { id: string; age?: number });
});

test("schema", () => {
  const schema = createSchema({
    //  ^?
    table: createColumn("id", "string").addColumn("age", "int"),
  });

  assertType<Schema>(schema);
});
