import { onchainTable, primaryKey } from "@/drizzle/db.js";
import { test } from "vitest";
import type { Delete, Find, Insert, Key, Update, Upsert } from "./db.js";

test("composite primary key", () => {
  const table = onchainTable(
    "table",
    (t) => ({
      id: t.text().notNull(),
      other: t.integer().notNull(),
      otherOther: t.boolean(),
    }),
    (table) => ({
      pk: primaryKey({ columns: [table.id, table.other] }),
    }),
  );

  type t = Key<typeof table>;
  //   ^?
});

test("find", () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

  const find: Find = () => {};
  const t = find(table, { id: "kevin" });
  //    ^?
});

test("insert", () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

  const insert: Insert = () => {};
  const t = insert(table).values({ id: "kevin" });
  //    ^?
});

test("update", () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

  const update: Update = () => {};
  const t = update(table, { id: "kevin" }).set({ other: 52 });
  //    ^?
});

test("upsert", async () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

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

  const cuh = await upsert(table, { id: "kevin" }).b;
});

test("delete", () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

  const _delete: Delete = () => {};
  const t = _delete(table, { id: "kevin" });
  //    ^?
});
