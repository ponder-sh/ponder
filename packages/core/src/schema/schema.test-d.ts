import { assertType, test } from "vitest";

import { int, string } from "./columns.js";
import { createEnum, createSchema, createTable } from "./schema.js";
import type {
  BaseColumn,
  ExtractAllNames,
  FilterEnums,
  FilterTables,
  Infer,
  RecoverTableType,
  Schema,
} from "./types.js";

test("table", () => {
  const a = createTable({
    id: string(),
    age: int(),
  });

  type t = RecoverTableType<{}, typeof a>;
  //   ^?

  assertType<t>({} as { id: string; age: number });
});

test("table optional", () => {
  const t = createTable({
    id: string(),
    age: int().optional(),
  });

  type t = RecoverTableType<{}, typeof t>;
  //   ^?

  assertType<t>({} as { id: string; age?: number });
});

test("filter enums", () => {
  const a = {
    //  ^?
    t: createTable({
      id: string(),
    }),
    e: createEnum(["ONE", "TWO"]),
  };

  type t = FilterEnums<typeof a>;
  //   ^?

  assertType<t>({} as { e: ["ONE", "TWO"] });
});

test("filter tables", () => {
  const a = {
    //  ^?
    t: createTable({
      id: string(),
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
      id: string(),
      ref: string().references("OtherTable.id"),
      ref2: string().references("OtherTable.id"),
    }),
    e: createEnum(["ONE", "TWO"]),
  };

  type t = ExtractAllNames<"OtherTable", typeof a>;
  //   ^?

  assertType<t>("" as "t.ref" | "t.ref2");
});

test("schema", () => {
  const s = createSchema((p) => ({
    //  ^?
    e: p.createEnum(["ONE", "TWO"]),
    t: p.createTable({
      id: p.string(),
      e: p.enum("e"),
    }),
  }));

  assertType<Schema>(s);

  type t = Infer<typeof s>;
  //   ^?

  assertType<t>({} as { t: { id: string; e: "ONE" | "TWO" } });
});
