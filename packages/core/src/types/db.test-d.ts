import { onchainTable, primaryKey } from "@/drizzle/index.js";
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

  // @ts-ignore
  type _ = Key<typeof table>;
  //   ^?
});

test("find", () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

  // @ts-ignore
  const find: Find = () => {};
  () => {
    // @ts-ignore
    const _ = find(table, { id: "kevin" });
    //    ^?
  };
});

test("insert", () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

  // @ts-ignore
  const insert: Insert = () => {};
  () => {
    // @ts-ignore
    const _ = insert(table).values({ id: "kevin" });
    //    ^?
  };
});

test("update", () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

  // @ts-ignore
  const update: Update = () => {};
  () => {
    // @ts-ignore
    const _ = update(table, { id: "kevin" }).set({ other: 52 });
    //    ^?
  };
});

test("upsert", async () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

  // @ts-ignore
  const upsert: Upsert = () => {};
  async () => {
    // @ts-ignore
    const t1 = await upsert(table, { id: "kevin" }).insert({ other: 52 });
    //    ^?
    // @ts-ignore
    const t2 = await upsert(table, { id: "kevin" }).update({ other: 52 });
    // @ts-ignore
    const t3 = await upsert(table, { id: "kevin" })
      //  ^?
      .insert({ other: 52 })
      .update({ other: 52 });
    // @ts-ignore
    const t4 = await upsert(table, { id: "kevin" })
      //  ^?
      .update({ other: 52 })
      .insert({ other: 52 });
    // @ts-ignore
    const t5 = await upsert(table, { id: "kevin" })
      //  ^?
      .insert({ other: 52 })
      .update((cur) => ({ other: cur.other ?? 99 }));
    // @ts-ignore
    const t6 = await upsert(table, { id: "kevin" })
      //  ^?
      .update((cur) => ({ other: cur.other ?? 99 }))
      .insert({ other: 52 });
  };
});

test("delete", () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

  // @ts-ignore
  const _delete: Delete = () => {};
  () => {
    // @ts-ignore
    const _ = _delete(table, { id: "kevin" });
    //    ^?
  };
});
