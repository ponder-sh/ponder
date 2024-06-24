import type { IdColumn, ScalarColumn } from "@/schema/common.js";
import { expectTypeOf, test } from "vitest";
import type { DrizzleDb } from "./db.js";
import type { ConvertToDrizzleTable } from "./table.js";

test("select query promise", async () => {
  const table = {} as ConvertToDrizzleTable<
    "table",
    { id: IdColumn<"string">; name: ScalarColumn<"int", true> }
  >;

  const result = await ({} as DrizzleDb).select({ id: table.id }).from(table);
  //    ^?

  expectTypeOf<{ id: string }[]>(result);
});

test("select optional column", async () => {
  const table = {} as ConvertToDrizzleTable<
    "table",
    { id: IdColumn<"string">; n: ScalarColumn<"int", true> }
  >;

  const result = await ({} as DrizzleDb).select().from(table);
  //    ^?

  expectTypeOf<{ id: string; n: number | null }[]>(result);
});
