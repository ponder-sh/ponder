import { createSchema } from "@/index.js";
import { eq } from "drizzle-orm";
import type { Hex } from "viem";
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

test("select enum", async () => {
  const schema = createSchema((p) => ({
    e: p.createEnum(["yes", "no"]),
    table: p.createTable({
      id: p.string(),
      name: p.int().optional(),
      e: p.enum("e"),
    }),
  }));

  const table = {} as ConvertToDrizzleTable<
    "table",
    (typeof schema)["table"]["table"],
    typeof schema
  >;

  const result = await ({} as DrizzleDb).select().from(table);
  //    ^?

  expectTypeOf<{ id: string; name: number | null; e: "yes" | "no" }[]>(result);
});

test("select json", async () => {
  const schema = createSchema((p) => ({
    table: p.createTable({
      id: p.string(),
      name: p.int().optional(),
      json: p.json<{ a: number; b: string }>(),
    }),
  }));

  const table = {} as ConvertToDrizzleTable<
    "table",
    (typeof schema)["table"]["table"],
    typeof schema
  >;

  const result = await ({} as DrizzleDb).select().from(table);
  //    ^?

  expectTypeOf<
    { id: string; name: number | null; json: { a: number; b: string } }[]
  >(result);
});

test("select join", async () => {
  const schema = createSchema((p) => ({
    account: p.createTable({
      id: p.hex(),
      name: p.string(),
      age: p.int(),
    }),
    nft: p.createTable({
      id: p.bigint(),
      owner: p.hex().references("account.id"),
    }),
  }));

  const account = {} as ConvertToDrizzleTable<
    "account",
    (typeof schema)["account"]["table"],
    typeof schema
  >;
  const nft = {} as ConvertToDrizzleTable<
    "nft",
    (typeof schema)["nft"]["table"],
    typeof schema
  >;

  const result = await ({} as DrizzleDb)
    //  ^?
    .select()
    .from(account)
    .fullJoin(nft, eq(account.id, nft.owner));

  expectTypeOf<
    {
      account: {
        id: Hex;
        name: string;
        age: number;
      } | null;
      nft: {
        id: bigint;
        owner: Hex;
      } | null;
    }[]
  >(result);
});
