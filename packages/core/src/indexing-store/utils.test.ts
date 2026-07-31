import { expect, test, vi } from "vitest";
import { onchainTable } from "@/drizzle/onchain.js";
import { normalizeColumn, normalizeUpdateSet } from "./utils.js";

test("normalize smallint", () => {
  const column = onchainTable("account", (t) => ({
    address: t.hex().primaryKey(),
    balance: t.smallint(),
  }));

  const value = 123;
  const result = normalizeColumn(column.balance, value, false);
  expect(result).toBe(value);
});

test("normalizeUpdateSet", () => {
  const table = onchainTable("account", (t) => ({
    address: t.hex().primaryKey(),
    balance: t.bigint(),
    metadata: t.json(),
    values: t.integer().array(),
    bytes: t.bytes(),
    timestamp: t.timestamp(),
  }));
  const addressMapper = vi.spyOn(table.address, "mapToDriverValue");
  const metadata = { nested: [1, 2] };
  const values = [1, 2];
  const bytes = new Uint8Array([1, 2]);
  const timestamp = new Date(1742925862000);

  const result = normalizeUpdateSet(table, {
    metadata,
    values,
    bytes,
    timestamp,
    balance: undefined,
  });

  expect(addressMapper).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    metadata,
    values,
    bytes,
    timestamp,
    balance: undefined,
  });
  expect(result.metadata).not.toBe(metadata);
  expect(result.values).not.toBe(values);
  expect(result.bytes).toBeInstanceOf(Uint8Array);
  expect(result.timestamp).toBeInstanceOf(Date);
});
