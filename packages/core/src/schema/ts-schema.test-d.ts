import { assertType, test } from "vitest";

import {
  createTable,
  list,
  number,
  optional,
  RecoverColumnType,
  RecoverIDType,
  RecoverListType,
  RecoverOptionalType,
  string,
  TableNames,
  TNamedEntity,
} from "./ts-schema";

test("table names", () => {
  const tables = [createTable("Account", { id: string, age: number })] as const;

  type t = TableNames<typeof tables>;
  //   ^?

  assertType<t>(["Account"] as const);
});

test("id", () => {
  const tables = [createTable("Account", { id: string, age: number })] as const;

  type t = RecoverIDType<(typeof tables)[0]>;
  //   ^?

  assertType<t>("" as string);
});

test("optional false", () => {
  const tables = [createTable("Account", { id: string, age: number })] as const;

  const column = tables[0].columns.age;

  type t = RecoverOptionalType<typeof column, "key", {}>;
  //   ^?

  assertType<t>({ key: {} } as { key: {} });
});

test("optional true", () => {
  const tables = [
    createTable("Account", { id: string, age: optional(number) }),
  ] as const;

  const column = tables[0].columns.age;

  type t = RecoverOptionalType<typeof column, "key", {}>;
  //   ^?

  assertType<t>({} as { key?: {} });
});

test("list", () => {
  const tables = [
    createTable("Account", { id: string, age: list(number) }),
  ] as const;

  const _list = tables[0].columns.age.data;

  type t = RecoverListType<typeof _list>;
  //   ^?

  assertType<t>([] as number[]);
});

test("column scalar", () => {
  const tables = [createTable("Account", { id: string, age: number })] as const;

  const column = tables[0].columns.age;

  type t = RecoverColumnType<typeof column>;
  //   ^?

  assertType<t>({} as number);
});

test("column list", () => {
  const tables = [
    createTable("Account", { id: string, age: list(number) }),
  ] as const;

  const column = tables[0].columns.age;

  type t = RecoverColumnType<typeof column>;
  //   ^?

  assertType<t>({} as number[]);
});

test("entity", () => {
  const tables = [createTable("Account", { id: string, age: number })] as const;

  type t = TNamedEntity<(typeof tables)[0]>;
  //   ^?

  assertType<t>({ Account: {} } as const);
});
