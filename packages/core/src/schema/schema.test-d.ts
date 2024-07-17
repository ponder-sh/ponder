import type { Hex } from "viem";
import { assertType, test } from "vitest";
import type { InferSchemaType } from "./infer.js";
import { createSchema } from "./schema.js";

test("createSchema scalar", () => {
  const schema = createSchema((p) => ({ t: p.createTable({ id: p.hex() }) }));
  //    ^?

  type inferred = InferSchemaType<typeof schema>;
  //   ^?

  assertType<inferred>({} as unknown as { t: { id: Hex } });
});

test("createSchema reference", () => {
  const schema = createSchema((p) => ({
    //  ^?
    t1: p.createTable({
      id: p.hex(),
    }),
    t2: p.createTable({
      id: p.hex(),
      col: p.hex().references("t2.id"),
    }),
  }));

  type inferred = InferSchemaType<typeof schema>;
  //   ^?

  assertType<inferred>(
    {} as unknown as { t1: { id: Hex }; t2: { id: Hex; col: Hex } },
  );
});

test("createSchema reference error", () => {
  createSchema((p) => ({
    // @ts-expect-error
    t: p.createTable({
      id: p.hex(),
      col: p.hex().references("t2.id"),
    }),
  }));
});

test("createSchema one", () => {
  const schema = createSchema((p) => ({
    //  ^?
    t1: p.createTable({
      id: p.hex(),
    }),
    t2: p.createTable({
      id: p.hex(),
      col1: p.hex().references("t1.id"),
      col2: p.one("col1"),
    }),
  }));

  type inferred = InferSchemaType<typeof schema>;
  //   ^?

  assertType<inferred>(
    {} as unknown as { t1: { id: Hex }; t2: { id: Hex; col1: Hex } },
  );
});

test("createSchema one error", () => {
  createSchema((p) => ({
    //  ^?
    // @ts-expect-error
    t: p.createTable({
      id: p.hex(),
      // @ts-expect-error
      col: p.one("col"),
    }),
  }));
});

test("createSchema many", () => {
  const schema = createSchema((p) => ({
    //  ^?
    t1: p.createTable({
      id: p.hex(),
      many: p.many("t2.col1"),
    }),
    t2: p.createTable({
      id: p.hex(),
      col1: p.hex().references("t1.id"),
      col2: p.one("col1"),
    }),
  }));

  type inferred = InferSchemaType<typeof schema>;
  //   ^?

  assertType<inferred>(
    {} as unknown as { t1: { id: Hex }; t2: { id: Hex; col1: Hex } },
  );
});

test("createSchema many error wrong table", () => {
  createSchema((p) => ({
    //  ^?
    // @ts-expect-error
    t1: p.createTable({
      id: p.hex(),
      many: p.many("t1.col1"),
    }),
    t2: p.createTable({
      id: p.hex(),
      col1: p.hex().references("t1.id"),
      col2: p.one("col1"),
    }),
  }));
});

test("createSchema many error wrong column", () => {
  createSchema((p) => ({
    //  ^?
    // @ts-expect-error
    t1: p.createTable({
      id: p.hex(),
      many: p.many("t2.col2"),
    }),
    t2: p.createTable({
      id: p.hex(),
      col1: p.hex().references("t1.id"),
      col2: p.one("col1"),
    }),
  }));
});

test("createSchema many self reference", () => {
  const schema = createSchema((p) => ({
    //  ^?
    t: p.createTable({
      id: p.hex(),
      col1: p.hex().references("t.id"),
      col2: p.one("col1"),
      many: p.many("t.col1"),
    }),
  }));

  type inferred = InferSchemaType<typeof schema>;
  //   ^?

  assertType<inferred>({} as unknown as { t: { id: Hex; col1: Hex } });
});

test("createSchema enum", () => {
  const schema = createSchema((p) => ({
    //  ^?
    e: p.createEnum(["one", "two"]),
    t: p.createTable({
      id: p.string(),
      enum: p.enum("e"),
    }),
  }));

  type inferred = InferSchemaType<typeof schema>;
  //   ^?

  assertType<inferred>(
    {} as unknown as { t: { id: Hex; enum: "one" | "two" } },
  );
});

test("createSchema enum error", () => {
  createSchema((p) => ({
    e: p.createEnum(["one", "two"]),
    // @ts-expect-error
    t: p.createTable({
      id: p.string(),
      enum: p.enum("a"),
    }),
  }));
});

test("createSchema index", () => {
  const schema = createSchema((p) => ({
    //  ^?
    t: p.createTable(
      {
        id: p.string(),
      },
      {
        idIndex: p.index(["id"]),
      },
    ),
  }));

  type inferred = InferSchemaType<typeof schema>;
  //   ^?

  assertType<inferred>({} as unknown as { t: { id: string } });
});

test("createSchema index error", () => {
  createSchema((p) => ({
    //  ^?
    // @ts-expect-error
    t: p.createTable(
      {
        id: p.string(),
      },
      {
        // @ts-expect-error
        idIndex: p.index("idd"),
      },
    ),
  }));
});
