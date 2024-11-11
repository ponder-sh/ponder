import { getTableName } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { onchainTable, primaryKey } from "./index.js";
import { getPrimaryKeyColumns } from "./index.js";

test("getPrimaryKeyColumns()", () => {
  const table = onchainTable("table", (p) => ({
    account: p.hex().primaryKey(),
    balance: p.bigint().notNull(),
  }));

  const primaryKeys = getPrimaryKeyColumns(table);

  expect(primaryKeys).toStrictEqual([{ js: "account", sql: "account" }]);
});

test("getPrimaryKeyColumns() sql", () => {
  const table = onchainTable("table", (p) => ({
    name: p.integer("unique_name").primaryKey(),
  }));

  const primaryKeys = getPrimaryKeyColumns(table);

  expect(primaryKeys).toStrictEqual([{ js: "name", sql: "unique_name" }]);
});

test("getPrimaryKeyColumns() snake case", () => {
  const table = onchainTable("table", (p) => ({
    chainId: p.integer().primaryKey(),
  }));

  const primaryKeys = getPrimaryKeyColumns(table);

  expect(primaryKeys).toStrictEqual([{ js: "chainId", sql: "chain_id" }]);
});

test("getPrimaryKeyColumns() composite", () => {
  const table = onchainTable(
    "table",
    (p) => ({
      name: p.text(),
      age: p.integer(),
      address: p.hex(),
    }),
    (table) => ({
      primaryKeys: primaryKey({ columns: [table.name, table.address] }),
    }),
  );

  const primaryKeys = getPrimaryKeyColumns(table);

  expect(primaryKeys).toStrictEqual([
    { js: "name", sql: "name" },
    { js: "address", sql: "address" },
  ]);
});

test("PONDER_EXPERIMENTAL_INSTANCE_ID", async () => {
  vi.stubEnv("PONDER_EXPERIMENTAL_INSTANCE_ID", "9876");

  const account = onchainTable("account", (p) => ({
    address: p.hex().primaryKey(),
    balance: p.bigint(),
  }));

  expect(getTableName(account)).toBe("9876__account");

  vi.unstubAllEnvs();
});
