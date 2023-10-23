import { assertType, test } from "vitest";

import { column, createColumn, createEnum, createSchema } from "./schema";
import { RecoverColumnType, RecoverTableType, Schema } from "./types";

test("column int", () => {
  const c = column("int");

  type t = RecoverColumnType<typeof c>;
  //   ^?

  assertType<t>({} as number);
});

test("column float", () => {
  const c = column("float");

  type t = RecoverColumnType<typeof c>;
  //   ^?

  assertType<t>({} as number);
});

test("column bytes", () => {
  const c = column("bytes");

  type t = RecoverColumnType<typeof c>;
  //   ^?

  assertType<t>({} as `0x{string}`);
});

test("column string", () => {
  const c = column("string");

  type t = RecoverColumnType<typeof c>;
  //   ^?

  assertType<t>({} as string);
});

test("column list", () => {
  const c = column("string", { list: true });

  type t = RecoverColumnType<typeof c>;
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

test("schema with enums", () => {
  const schema = createSchema({
    //  ^?
    enummm: createEnum("ONE", "TWO", "THREE"),
    table: createColumn("id", "string").addColumn("e", "enum:enummm"),
  });

  assertType<Schema>(schema);
});
