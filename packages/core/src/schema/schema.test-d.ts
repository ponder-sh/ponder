import { assertType, test } from "vitest";

import { column, enumerable, schema, table } from "./schema";
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
  const t = table({
    id: column("string"),
    age: column("int"),
  });

  type t = RecoverTableType<(typeof t)["table"]>;
  //   ^?

  assertType<t>({} as { id: string; age: number });
});

test("table optional", () => {
  const t = table({
    id: column("string"),
    age: column("int", { optional: true }),
  });

  type t = RecoverTableType<(typeof t)["table"]>;
  //   ^?

  assertType<t>({} as { id: string; age?: number });
});

test("schema", () => {
  const s = schema({
    //  ^?
    t: table({
      id: column("string"),
      age: column("int", { optional: true }),
    }),
  });

  assertType<Schema>(s);
});

test("schema with enums", () => {
  const s = schema({
    //  ^?
    enummm: enumerable("ONE", "TWO", "THREE"),
    t: table({
      id: column("string"),
      age: column("enum:enumm"),
    }),
  });

  assertType<Schema>(s);
});
