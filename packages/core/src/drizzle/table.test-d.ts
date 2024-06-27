import { createSchema } from "@/index.js";
import { expectTypeOf, test } from "vitest";
import type { DrizzleDb } from "./db.js";
import type { ConvertToDrizzleTable } from "./table.js";

test("select query promise", async () => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      name: p.int().optional(),
    }),
  }));

  const table = {} as ConvertToDrizzleTable<
    "table",
    (typeof schema)["table"]["table"],
    typeof schema
  >;

  const result = await ({} as DrizzleDb).select({ id: table.id }).from(table);
  //    ^?

  expectTypeOf<{ id: string }[]>(result);
});

test("select optional column", async () => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      name: p.int().optional(),
    }),
  }));

  const table = {} as ConvertToDrizzleTable<
    "table",
    (typeof schema)["table"]["table"],
    typeof schema
  >;

  const result = await ({} as DrizzleDb).select().from(table);
  //    ^?

  expectTypeOf<{ id: string; name: number | null }[]>(result);
});
