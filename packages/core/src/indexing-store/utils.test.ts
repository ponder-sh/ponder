import { expect, test, vi } from "bun:test";
import { zeroAddress } from "viem";
import { ALICE } from "@/_test/constants.js";
import { onchainTable } from "@/drizzle/onchain.js";
import {
  BigIntSerializationError,
  NonRetryableUserError,
  NotNullConstraintError,
} from "@/internal/errors.js";
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
    ).toMatchInlineSnapshot(`
      {
        "b": "1970-01-01T00:00:00.000Z",
      }
    `);
  }

  expect(
    normalizeColumn(table.metadatas, ["1", { a: 1 }], false),
  ).toMatchInlineSnapshot(`
    [
      "1",
      {
        "a": 1,
      },
    ]
  `);
  expect(
    normalizeColumn(table.metadatas2, [[{ a: 1 }, "1"]], false),
  ).toMatchInlineSnapshot(`
    [
      [
        {
          "a": 1,
        },
        "1",
      ],
    ]
  `);
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

  expect(() => normalizeRow(table, { address: zeroAddress }, false)).toThrow(
    NotNullConstraintError,
  );
  expect(() =>
    normalizeRow(table, { address: zeroAddress }, false),
  ).toThrowErrorMatchingInlineSnapshot(
    `"Column 'account.balance' violates not-null constraint."`,
  );
  expect(() =>
    normalizeRow(table, { address: zeroAddress, balance: null }, false),
  ).toThrow(NotNullConstraintError);
  expect(() =>
    normalizeRow(table, { address: zeroAddress, balance: null }, false),
  ).toThrowErrorMatchingInlineSnapshot(
    `"Column 'account.balance' violates not-null constraint."`,
  );
});

test("normalizeColumn() json bigint", () => {
  const table = onchainTable("account", (t) => ({
    address: t.hex().primaryKey(),
    metadata: t.json(),
  }));

  expect(() =>
    normalizeColumn(table.metadata, { balance: 10n }, false),
  ).toThrow(BigIntSerializationError);
  expect(() =>
    normalizeColumn(table.metadata, { balance: 10n }, false),
  ).toThrowErrorMatchingInlineSnapshot(
    `"JSON.stringify cannot serialize BigInt."`,
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
  ).toThrow(NonRetryableUserError);
  expect(() =>
    validateUpdateSet(table, { address: ALICE }, prev, cache),
  ).toThrowErrorMatchingInlineSnapshot(
    `"Primary key column 'address' cannot be updated"`,
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
