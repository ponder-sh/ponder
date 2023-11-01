import { assertType, test } from "vitest";

import { p } from "./p";
import { createEnum, createSchema, createTable } from "./schema";
import {
  BaseColumn,
  ExtractAllNames,
  FilterEnums,
  FilterTables,
  Infer,
  RecoverTableType,
  Schema,
} from "./types";

test("table", () => {
  const a = createTable({
    id: p.string(),
    age: p.int(),
  });

  type t = RecoverTableType<{}, typeof a>;
  //   ^?

  assertType<t>({} as { id: string; age: number });
});

test("table optional", () => {
  const t = createTable({
    id: p.string(),
    age: p.int().optional(),
  });

  type t = RecoverTableType<{}, typeof t>;
  //   ^?

  assertType<t>({} as { id: string; age?: number });
});

test("filter enums", () => {
  const a = {
    //  ^?
    t: createTable({
      id: p.string(),
    }),
    e: createEnum(["ONE", "TWO"] as const),
  };

  type t = FilterEnums<typeof a>;
  //   ^?

  assertType<t>({} as { e: ["ONE", "TWO"] });
});

test("filter tables", () => {
  const a = {
    //  ^?
    t: createTable({
      id: p.string(),
    }),
    e: createEnum(["ONE", "TWO"]),
  };

  type t = FilterTables<typeof a>;
  //   ^?

  assertType<t["t"]["id"]>({} as BaseColumn<"string", never, false, false>);
});

test("extract all names", () => {
  const a = {
    //  ^?
    t: createTable({
      id: p.string(),
      ref: p.string().references("OtherTable.id"),
      ref2: p.string().references("OtherTable.id"),
    }),
    e: createEnum(["ONE", "TWO"]),
  };

  type t = ExtractAllNames<"OtherTable", typeof a>;
  //   ^?

  assertType<t>("" as "t.ref" | "t.ref2");
});

test("schema", () => {
  const s = createSchema({
    //  ^?
    e: createEnum(["ONE", "TWO"] as const),
    t: createTable({
      id: p.string(),
      e: p.enum("e"),
    }),
  });

  assertType<Schema>(s);

  type t = Infer<typeof s>;
  //   ^?

  assertType<t>({} as { t: { id: string; e: ["ONE", "TWO"] } });
});
