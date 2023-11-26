import type { Hex } from "viem";
import { assertType, test } from "vitest";

import * as p from "./index.js";
import type { EnumColumn, VirtualColumn } from "./types.js";
import { type BaseColumn, type RecoverColumnType } from "./types.js";

test("string", () => {
  const c = p.string();
  //    ^?

  assertType<BaseColumn<"string", undefined, false, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string);
});

test("int", () => {
  const c = p.int();
  //    ^?

  assertType<BaseColumn<"int", undefined, false, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as number);
});

test("float", () => {
  const c = p.float();
  //    ^?

  assertType<BaseColumn<"float", undefined, false, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as number);
});

test("boolean", () => {
  const c = p.boolean();
  //    ^?

  assertType<BaseColumn<"boolean", undefined, false, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as boolean);
});

test("bytes", () => {
  const c = p.bytes();
  //    ^?

  assertType<BaseColumn<"bytes", undefined, false, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as Hex);
});

test("bigint", () => {
  const c = p.bigint();
  //    ^?

  assertType<BaseColumn<"bigint", undefined, false, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as bigint);
});

test("enum", () => {
  const c = p.enum("ENUM");
  //    ^?

  assertType<EnumColumn<"ENUM", false>>(c[" enum"]);
});

test("many", () => {
  const c = p.many("OtherTable.OtherColumn");
  //    ^?

  assertType<VirtualColumn<"OtherTable.OtherColumn">>(c);
});

test("optional", () => {
  const c = p.string().optional();
  //    ^?

  assertType<BaseColumn<"string", undefined, true, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string);
});

test("list", () => {
  const c = p.string().list();
  //    ^?

  assertType<BaseColumn<"string", undefined, false, true>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string[]);
});

test("references", () => {
  const c = p.string().references("OtherTable.id");

  assertType<BaseColumn<"string", "OtherTable.id", false, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string);
});

test("chaining modifiers 1", () => {
  const c = p.string().list().optional();
  //    ^?

  assertType<BaseColumn<"string", undefined, true, true>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string[]);
});

test("chaining modifiers 2", () => {
  const c = p.string().optional().list();
  //    ^?

  assertType<BaseColumn<"string", undefined, true, true>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string[]);
});

test("chaining modifiers 3", () => {
  const c = p.string().optional().references("OtherTable.id");
  //    ^?

  assertType<BaseColumn<"string", "OtherTable.id", true, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string);
});

test("chaining modifiers 4", () => {
  const c = p.string().references("OtherTable.id").optional();
  //    ^?

  assertType<BaseColumn<"string", "OtherTable.id", true, false>>(c[" column"]);

  type t = RecoverColumnType<(typeof c)[" column"]>;
  //   ^?

  assertType<t>({} as string);
});
