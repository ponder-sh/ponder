import { onchainTable } from "@/drizzle/onchain.js";
import { expect, test } from "vitest";
import { normalizeColumn } from "./utils.js";

test("normalize smallint", () => {
  const column = onchainTable("account", (t) => ({
    address: t.hex().primaryKey(),
    balance: t.smallint(),
  }));

  const value = 123;
  const result = normalizeColumn(column.balance, value, false);
  expect(result).toBe(value);
});
