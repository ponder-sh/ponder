import { Hex } from "viem";
import { assertType, test } from "vitest";

import { p } from "./p";
import { type BaseColumn, type RecoverColumnType } from "./types";

test("string", () => {
  const c = p.string();
  //    ^?

  assertType<BaseColumn<"string", never, false, false>>(c.column);

  type t = RecoverColumnType<typeof c.column>;
  //   ^?

  assertType<t>({} as string);
});

test("int", () => {
  const c = p.int();
  //    ^?

  assertType<BaseColumn<"int", never, false, false>>(c.column);

  type t = RecoverColumnType<typeof c.column>;
  //   ^?

  assertType<t>({} as number);
});

test("float", () => {
  const c = p.float();
  //    ^?

  assertType<BaseColumn<"float", never, false, false>>(c.column);

  type t = RecoverColumnType<typeof c.column>;
  //   ^?

  assertType<t>({} as number);
});

test("boolean", () => {
  const c = p.boolean();
  //    ^?

  assertType<BaseColumn<"boolean", never, false, false>>(c.column);

  type t = RecoverColumnType<typeof c.column>;
  //   ^?

  assertType<t>({} as boolean);
});

test("bytes", () => {
  const c = p.bytes();
  //    ^?

  assertType<BaseColumn<"bytes", never, false, false>>(c.column);

  type t = RecoverColumnType<typeof c.column>;
  //   ^?

  assertType<t>({} as Hex);
});

test("bigint", () => {
  const c = p.bigint();
  //    ^?

  assertType<BaseColumn<"bigint", never, false, false>>(c.column);

  type t = RecoverColumnType<typeof c.column>;
  //   ^?

  assertType<t>({} as bigint);
});

test.todo("enum", () => {});

test.todo("virtual", () => {});

test("optional", () => {
  const c = p.string().optional();
  //    ^?

  assertType<BaseColumn<"string", never, true, false>>(c.column);

  type t = RecoverColumnType<typeof c.column>;
  //   ^?

  assertType<t>({} as string);
});

test("list", () => {
  const c = p.string().list();
  //    ^?

  assertType<BaseColumn<"string", never, false, true>>(c.column);

  type t = RecoverColumnType<typeof c.column>;
  //   ^?

  assertType<t>({} as string[]);
});

test("chaining modifiers 1", () => {
  const c = p.string().list().optional();
  //    ^?

  assertType<BaseColumn<"string", never, true, true>>(c.column);

  type t = RecoverColumnType<typeof c.column>;
  //   ^?

  assertType<t>({} as string[]);
});

test("chaining modifiers 2", () => {
  const c = p.string().optional().list();
  //    ^?

  assertType<BaseColumn<"string", never, true, true>>(c.column);

  type t = RecoverColumnType<typeof c.column>;
  //   ^?

  assertType<t>({} as string[]);
});
