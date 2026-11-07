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

test("normalizeUpdateSet $onUpdateFn", () => {
  const table = onchainTable("account", (t) => ({
    address: t
      .hex()
      .primaryKey()
      .$onUpdateFn(() => "0x1"),
    balance: t.bigint(),
    updatedAt: t.bigint().$onUpdateFn(() => 10n),
    version: t.integer().$onUpdateFn(() => 1),
  }));

  expect(
    normalizeUpdateSet(table, { balance: 5n, version: 2 }),
  ).toMatchInlineSnapshot(`
    {
      "balance": 5n,
      "updatedAt": 10n,
      "version": 2,
    }
  `);
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

test("normalize json", () => {
  const table = onchainTable("account", (t) => ({
    address: t.hex().primaryKey(),
    metadata: t.json(),
    metadataB: t.jsonb(),
    metadatas: t.json().array(),
    metadatas2: t.json().array().array(),
  }));

  for (const column of [table.metadata, table.metadataB]) {
    for (const value of ["1", "true", "null", '{"a":1}', "a", { a: [1] }]) {
      expect(normalizeColumn(column, value, false)).toStrictEqual(value);
      // Note: The driver returns `value` parsed.
      expect(column.mapFromDriverValue(value)).toStrictEqual(value);
    }
    expect(
      normalizeColumn(column, { a: undefined, b: new Date(0) }, false),
    ).toStrictEqual({ b: "1970-01-01T00:00:00.000Z" });
  }

  expect(
    normalizeColumn(table.metadatas, ["1", { a: 1 }], false),
  ).toStrictEqual(["1", { a: 1 }]);
  expect(
    normalizeColumn(table.metadatas2, [[{ a: 1 }, "1"]], false),
  ).toStrictEqual([[{ a: 1 }, "1"]]);
});
