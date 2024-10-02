import { onchainTable } from "@/drizzle/db.js";
import { integer, text } from "drizzle-orm/pg-core";
import { test } from "vitest";
import type { Delete, Find, Insert, Update } from "./db.js";

test("find", () => {
  const table = onchainTable("table", {
    id: text("id").primaryKey(),
    other: integer("other"),
  });

  const find: Find = () => {};
  const t = find(table, { id: "kevin" });
  //    ^?                ^?
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

test("delete", () => {
  const table = onchainTable("table", {
    id: text("id").primaryKey(),
    other: integer("other"),
  });

  const _delete: Delete = () => {};
  const t = _delete(table, { id: "kevin" });
  //    ^?
});
