import { onchainTable, primaryKey } from "@/drizzle/onchain.js";
import { test } from "vitest";
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
    const t1 = insert(table).values({ id: "kevin" });
    //    ^?

    // @ts-ignore
    const t2 = insert(table).values({ id: "kevin" }).onConflictDoNothing();
    //    ^?

    // @ts-ignore
    const t3 = insert(table).values({ id: "kevin" }).onConflictDoUpdate({
      //  ^?
      other: 9,
    });

    // @ts-ignore
    const t4 = insert(table)
      //  ^?
      .values({ id: "kevin" })
      .onConflictDoUpdate((row) => ({
        other: row.other ?? 8,
      }));

    // @ts-ignore
    const t5 = insert(table)
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

  // @ts-ignore
  const update: Update = () => {};
  () => {
    // @ts-ignore
    const _ = update(table, { id: "kevin" }).set({ other: 52 });
    //    ^?
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
