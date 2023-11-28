import type { Hex } from "viem";
import { assertType, test } from "vitest";

import {
  _enum,
  bigint,
  boolean,
  bytes,
  float,
  int,
  many,
  one,
  string,
} from "./columns.js";
import type {
  EnumColumn,
  ManyColumn,
  OneColumn,
  RecoverEnumType,
} from "./types.js";
import { type BaseColumn, type RecoverColumnType } from "./types.js";

test("string", () => {
  const c = string();
  //    ^?

  assertType<BaseColumn<"string", undefined, false, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string);
});

test("int", () => {
  const c = int();
  //    ^?

  assertType<BaseColumn<"int", undefined, false, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as number);
});

test("float", () => {
  const c = float();
  //    ^?

  assertType<BaseColumn<"float", undefined, false, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as number);
});

test("boolean", () => {
  const c = boolean();
  //    ^?

  assertType<BaseColumn<"boolean", undefined, false, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as boolean);
});

test("bytes", () => {
  const c = bytes();
  //    ^?

  assertType<BaseColumn<"bytes", undefined, false, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as Hex);
});

test("bigint", () => {
  const c = bigint();
  //    ^?

  assertType<BaseColumn<"bigint", undefined, false, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as bigint);
});

test("enum", () => {
  const c = _enum("ENUM");
  //    ^?

  assertType<EnumColumn<"ENUM", false>>(c[" enum"]);
});

test("one", () => {
  const c = one("OtherColumn");
  //    ^?

  assertType<OneColumn<"OtherColumn">>(c);
});

test("many", () => {
  const c = many("OtherTable.OtherColumn");
  //    ^?

  assertType<ManyColumn<"OtherTable.OtherColumn">>(c);
});

test("optional", () => {
  const c = string().optional();
  //    ^?

  assertType<BaseColumn<"string", undefined, true, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string);
});

test("list", () => {
  const c = string().list();
  //    ^?

  assertType<BaseColumn<"string", undefined, false, true>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string[]);
});

test("references", () => {
  const c = string().references("OtherTable.id");

  assertType<BaseColumn<"string", "OtherTable.id", false, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string);
});

test("chaining modifiers 1", () => {
  const c = string().list().optional();
  //    ^?

  assertType<BaseColumn<"string", undefined, true, true>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string[]);
});

test("chaining modifiers 2", () => {
  const c = string().optional().list();
  //    ^?

  assertType<BaseColumn<"string", undefined, true, true>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string[]);
});

test("chaining modifiers 3", () => {
  const c = string().optional().references("OtherTable.id");
  //    ^?

  assertType<BaseColumn<"string", "OtherTable.id", true, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string);
});

test("chaining modifiers 4", () => {
  const c = string().references("OtherTable.id").optional();
  //    ^?

  assertType<BaseColumn<"string", "OtherTable.id", true, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string);
});

test("chaining modifiers 5", () => {
  const e = _enum("ENUM").list().optional();
  //    ^?

  assertType<EnumColumn<"ENUM", true, true>>(e[" enum"]);

  type t = RecoverEnumType<{ ENUM: ["ONE", "TWO"] }, (typeof e)[" enum"]>;
  //   ^?

  assertType<t>([] as ("ONE" | "TWO")[]);
});
