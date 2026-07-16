import { test } from "vitest";
import { onchainTable, primaryKey } from "@/drizzle/onchain.js";
import type { Delete, Find, Insert, Key, Update } from "./db.js";

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

  // @ts-expect-error
  type _ = Key<typeof table>;
  //   ^?
});

test("find", () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

  // @ts-expect-error
  const find: Find = () => {};
  () => {
    // @ts-expect-error
    const _ = find(table, { id: "kevin" });
    //    ^?
  };
});

test("insert", () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

  // @ts-expect-error
  const insert: Insert = () => {};
  () => {
    // @ts-expect-error
    const _t1 = insert(table).values({ id: "kevin" });
    //    ^?

    // @ts-expect-error
    const _t2 = insert(table).values({ id: "kevin" }).onConflictDoNothing();
    //    ^?

    // @ts-expect-error
    const _t3 = insert(table).values({ id: "kevin" }).onConflictDoUpdate({
      //  ^?
      other: 9,
    });

    // @ts-expect-error
    const _t4 = insert(table)
      //  ^?
      .values({ id: "kevin" })
      .onConflictDoUpdate((row) => ({
        other: row.other ?? 8,
      }));

    // @ts-expect-error
    const _t5 = insert(table)
      //  ^?
      .values([{ id: "kevin" }])
      .onConflictDoNothing();
  };
});

test("update", () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

  // @ts-expect-error
  const update: Update = () => {};
  () => {
    // @ts-expect-error
    const _ = update(table, { id: "kevin" }).set({ other: 52 });
    //    ^?
  };
});

test("delete", () => {
  const table = onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

  // @ts-expect-error
  const _delete: Delete = () => {};
  () => {
    // @ts-expect-error
    const _ = _delete(table, { id: "kevin" });
    //    ^?
  };
});

test("non-empty table name", () => {
  onchainTable("table", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));

  // @ts-expect-error
  onchainTable("", (t) => ({
    id: t.text().primaryKey(),
    other: t.integer(),
  }));
});
