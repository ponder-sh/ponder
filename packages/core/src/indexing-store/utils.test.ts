import { zeroAddress } from "viem";
import { expect, test, vi } from "vitest";
import { ALICE } from "@/_test/constants.js";
import { onchainTable } from "@/drizzle/onchain.js";
import { validateUpdateSet } from "./index.js";
import {
  getPrimaryKeyCache,
  normalizeColumn,
  normalizeRow,
  normalizeUpdateSet,
} from "./utils.js";

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

test("normalizeRow() default, $default, $onUpdateFn", () => {
  const table = onchainTable("account", (t) => ({
    address: t.hex().primaryKey(),
    default: t.integer().default(0),
    defaultFn: t.bigint().$default(() => 10n),
    onUpdateFn: t
      .bigint()
      .notNull()
      .$onUpdateFn(() => 20n),
    nullable: t.text(),
  }));

  // Note: `$onUpdateFn` also provides the insert value.
  expect(
    normalizeRow(table, { address: zeroAddress }, false),
  ).toMatchInlineSnapshot(`
    {
      "address": "0x0000000000000000000000000000000000000000",
      "default": 0,
      "defaultFn": 10n,
      "nullable": null,
      "onUpdateFn": 20n,
    }
  `);
});

test("normalizeRow() notNull", () => {
  const table = onchainTable("account", (t) => ({
    address: t.hex().primaryKey(),
    balance: t.bigint().notNull(),
  }));

  expect(() =>
    normalizeRow(table, { address: zeroAddress }, false),
  ).toThrowErrorMatchingInlineSnapshot(
    `[NotNullConstraintError: Column 'account.balance' violates not-null constraint.]`,
  );
  expect(() =>
    normalizeRow(table, { address: zeroAddress, balance: null }, false),
  ).toThrowErrorMatchingInlineSnapshot(
    `[NotNullConstraintError: Column 'account.balance' violates not-null constraint.]`,
  );
});

test("normalizeColumn() json bigint", () => {
  const table = onchainTable("account", (t) => ({
    address: t.hex().primaryKey(),
    metadata: t.json(),
  }));

  expect(() =>
    normalizeColumn(table.metadata, { balance: 10n }, false),
  ).toThrowErrorMatchingInlineSnapshot(
    `[BigIntSerializationError: Do not know how to serialize a BigInt]`,
  );
});

test("normalizeColumn() text with null bytes", () => {
  const table = onchainTable("account", (t) => ({
    address: t.hex().primaryKey(),
    name: t.text().notNull(),
  }));

  expect(
    normalizeColumn(table.name, "tencentclub\x00\x00\x00\x00\x00\x00", false),
  ).toMatchInlineSnapshot(`"tencentclub"`);
});

test("validateUpdateSet() primary key", () => {
  const table = onchainTable("account", (t) => ({
    address: t.hex().primaryKey(),
    balance: t.bigint().notNull(),
  }));
  const cache = getPrimaryKeyCache([table]);
  const prev = { address: zeroAddress, balance: 10n };

  expect(() =>
    validateUpdateSet(table, { address: ALICE }, prev, cache),
  ).toThrowErrorMatchingInlineSnapshot(
    `[NonRetryableUserError: Primary key column 'address' cannot be updated]`,
  );

  // Note: Setting the primary key to its current value is a no-op.
  expect(() =>
    validateUpdateSet(
      table,
      { address: zeroAddress, balance: 11n },
      prev,
      cache,
    ),
  ).not.toThrow();
});
