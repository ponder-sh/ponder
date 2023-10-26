import { assertType, test } from "vitest";

import { BaseColumn, p } from "./p";

test("string", () => {
  const c = p.string();

  assertType<BaseColumn<"string", never, false, false>>(c);
});

test("int", () => {
  const c = p.int();

  assertType<BaseColumn<"int", never, false, false>>(c);
});

test("float", () => {
  const c = p.float();

  assertType<BaseColumn<"float", never, false, false>>(c);
});

test("boolean", () => {
  const c = p.boolean();

  assertType<BaseColumn<"boolean", never, false, false>>(c);
});

test("bytes", () => {
  const c = p.bytes();

  assertType<BaseColumn<"bytes", never, false, false>>(c);
});

test("bigint", () => {
  const c = p.bigint();

  assertType<BaseColumn<"bigint", never, false, false>>(c);
});

test("optional", () => {
  const c = p.string({ optional: true });

  assertType<BaseColumn<"string", never, true, false>>(c);
});

test("list", () => {
  const c = p.string({ list: true });

  assertType<BaseColumn<"string", never, false, true>>(c);
});
