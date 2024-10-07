import { offchainTable, onchainTable } from "@/drizzle/db.js";
import { integer, primaryKey, serial, text } from "drizzle-orm/pg-core";
import { test } from "vitest";
import type {
  Delete,
  Find,
  Insert,
  IsSerialPrimaryKey,
  Key,
  Update,
  Upsert,
} from "./db.js";

test("offchain table", () => {
  const table = offchainTable("table", {
    id: text("id").primaryKey(),
    other: integer("other"),
  });

  const find: Find = () => {};
  find(table, { id: "kevin" });
});

test("composite primary key", () => {
  const table = onchainTable(
    "table",
    {
      id: text("id").notNull(),
      other: integer("other").notNull(),
    },
    (table) => ({
      pk: primaryKey({ columns: [table.id, table.other] }),
    }),
  );

  type t = Key<typeof table>;
  //   ^?
});

test("serial primary key", () => {
  const table = onchainTable("table", {
    id: serial("id").primaryKey(),
    other: integer("other"),
  });

  type t = IsSerialPrimaryKey<typeof table>;
  //   ^?
});

test("find", () => {
  const table = onchainTable("table", {
    id: text("id").primaryKey(),
    other: integer("other"),
  });

  const find: Find = () => {};
  const t = find(table, { id: "kevin" });
  //    ^?
});

test("insert", () => {
  const table = onchainTable("table", {
    id: text("id").primaryKey(),
    other: integer("other"),
  });

  const insert: Insert = () => {};
  const t = insert(table).values({ id: "kevin" });
  //    ^?
});

test("update", () => {
  const table = onchainTable("table", {
    id: text("id").primaryKey(),
    other: integer("other"),
  });

  const update: Update = () => {};
  const t = update(table, { id: "kevin" }).set({ other: 52 });
  //    ^?
});

test("upsert", async () => {
  const table = onchainTable("table", {
    id: text("id").primaryKey(),
    other: integer("other"),
  });

  const upsert: Upsert = () => {};
  const t1 = await upsert(table, { id: "kevin" }).insert({ other: 52 });
  //    ^?
  const t2 = await upsert(table, { id: "kevin" }).update({ other: 52 });
  //    ^?
  const t3 = await upsert(table, { id: "kevin" })
    //  ^?
    .insert({ other: 52 })
    .update({ other: 52 });
  const t4 = await upsert(table, { id: "kevin" })
    //  ^?
    .update({ other: 52 })
    .insert({ other: 52 });
  const t5 = await upsert(table, { id: "kevin" })
    //  ^?
    .insert({ other: 52 })
    .update((cur) => ({ other: cur.other ?? 99 }));
  const t6 = await upsert(table, { id: "kevin" })
    //  ^?
    .update((cur) => ({ other: cur.other ?? 99 }))
    .insert({ other: 52 });
});

test("delete", () => {
  const table = onchainTable("table", {
    id: text("id").primaryKey(),
    other: integer("other"),
  });

  const _delete: Delete = () => {};
  const t = _delete(table, { id: "kevin" });
  //    ^?
});
