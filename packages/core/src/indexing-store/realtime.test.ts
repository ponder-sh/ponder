import { ALICE } from "@/_test/constants.js";
import {
  context,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getRejectionValue } from "@/_test/utils.js";
import { onchainEnum, onchainTable } from "@/drizzle/onchain.js";
import {
  BigIntSerializationError,
  NonRetryableUserError,
  RawSqlError,
  type RetryableError,
} from "@/internal/errors.js";
import type { IndexingErrorHandler } from "@/internal/types.js";
import { eq } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { toBytes, zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import { createRealtimeIndexingStore } from "./realtime.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

const indexingErrorHandler: IndexingErrorHandler = {
  getRetryableError: () => {
    return indexingErrorHandler.error;
  },
  setRetryableError: (error: RetryableError) => {
    indexingErrorHandler.error = error;
  },
  clearRetryableError: () => {
    indexingErrorHandler.error = undefined;
  },
  error: undefined as RetryableError | undefined,
};

test("find", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  // empty

  let result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toBe(null);

  // with entry

  await indexingStore
    .insert(schema.account)
    .values({ address: zeroAddress, balance: 10n });

  result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({ address: zeroAddress, balance: 10n });
});

test("insert", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  // single

  let result: any = await indexingStore
    .insert(schema.account)
    .values({ address: zeroAddress, balance: 10n });

  expect(result).toStrictEqual({ address: zeroAddress, balance: 10n });

  result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({ address: zeroAddress, balance: 10n });

  // multiple

  result = await indexingStore.insert(schema.account).values([
    { address: "0x0000000000000000000000000000000000000001", balance: 12n },
    { address: "0x0000000000000000000000000000000000000002", balance: 52n },
  ]);

  expect(result).toStrictEqual([
    { address: "0x0000000000000000000000000000000000000001", balance: 12n },
    { address: "0x0000000000000000000000000000000000000002", balance: 52n },
  ]);

  result = await indexingStore.find(schema.account, {
    address: "0x0000000000000000000000000000000000000001",
  });

  expect(result).toStrictEqual({
    address: "0x0000000000000000000000000000000000000001",
    balance: 12n,
  });

  result = await indexingStore.find(schema.account, {
    address: "0x0000000000000000000000000000000000000002",
  });

  expect(result).toStrictEqual({
    address: "0x0000000000000000000000000000000000000002",
    balance: 52n,
  });

  // on conflict do nothing

  result = await indexingStore
    .insert(schema.account)
    .values({
      address: "0x0000000000000000000000000000000000000001",
      balance: 44n,
    })
    .onConflictDoNothing();

  expect(result).toBe(null);

  result = await indexingStore.find(schema.account, {
    address: "0x0000000000000000000000000000000000000001",
  });

  expect(result).toStrictEqual({
    address: "0x0000000000000000000000000000000000000001",
    balance: 12n,
  });

  result = await indexingStore
    .insert(schema.account)
    .values([
      { address: "0x0000000000000000000000000000000000000001", balance: 44n },
      { address: "0x0000000000000000000000000000000000000003", balance: 0n },
    ])
    .onConflictDoNothing();

  expect(result).toStrictEqual([
    null,
    { address: "0x0000000000000000000000000000000000000003", balance: 0n },
  ]);

  result = await indexingStore
    .insert(schema.account)
    .values([
      { address: "0x0000000000000000000000000000000000000001", balance: 44n },
      { address: "0x0000000000000000000000000000000000000001", balance: 44n },
    ])
    .onConflictDoNothing();

  expect(result).toStrictEqual([null, null]);

  result = await indexingStore.find(schema.account, {
    address: "0x0000000000000000000000000000000000000001",
  });

  expect(result).toStrictEqual({
    address: "0x0000000000000000000000000000000000000001",
    balance: 12n,
  });

  // on conflict do update

  await indexingStore
    .insert(schema.account)
    .values({
      address: "0x0000000000000000000000000000000000000001",
      balance: 90n,
    })
    .onConflictDoUpdate({
      balance: 16n,
    });

  result = await indexingStore.find(schema.account, {
    address: "0x0000000000000000000000000000000000000001",
  });

  expect(result).toStrictEqual({
    address: "0x0000000000000000000000000000000000000001",
    balance: 16n,
  });

  await indexingStore
    .insert(schema.account)
    .values([
      { address: "0x0000000000000000000000000000000000000001", balance: 44n },
      { address: "0x0000000000000000000000000000000000000002", balance: 0n },
    ])
    .onConflictDoUpdate((row) => ({
      balance: row.balance + 16n,
    }));

  result = await indexingStore.find(schema.account, {
    address: "0x0000000000000000000000000000000000000001",
  });

  expect(result).toStrictEqual({
    address: "0x0000000000000000000000000000000000000001",
    balance: 32n,
  });

  await indexingStore
    .insert(schema.account)
    .values([
      { address: "0x0000000000000000000000000000000000000001", balance: 44n },
      { address: "0x0000000000000000000000000000000000000002", balance: 0n },
    ])
    .onConflictDoUpdate({
      balance: 64n,
    });

  result = await indexingStore.find(schema.account, {
    address: "0x0000000000000000000000000000000000000001",
  });

  expect(result).toStrictEqual({
    address: "0x0000000000000000000000000000000000000001",
    balance: 64n,
  });

  result = await indexingStore.find(schema.account, {
    address: "0x0000000000000000000000000000000000000002",
  });

  expect(result).toStrictEqual({
    address: "0x0000000000000000000000000000000000000002",
    balance: 64n,
  });

  await indexingStore
    .insert(schema.account)
    .values([
      { address: "0x0000000000000000000000000000000000000001", balance: 44n },
      { address: "0x0000000000000000000000000000000000000002", balance: 0n },
    ])
    .onConflictDoUpdate({
      balance: 64n,
    });
});

test("update", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  // setup

  await indexingStore
    .insert(schema.account)
    .values({ address: zeroAddress, balance: 10n });

  // no function

  let result: any = await indexingStore
    .update(schema.account, { address: zeroAddress })
    .set({ balance: 12n });

  expect(result).toStrictEqual({
    address: zeroAddress,
    balance: 12n,
  });

  result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    balance: 12n,
  });

  // function

  result = await indexingStore
    .update(schema.account, { address: zeroAddress })
    .set((row) => ({ balance: row.balance + 10n }));

  expect(result).toStrictEqual({
    address: zeroAddress,
    balance: 22n,
  });

  result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    balance: 22n,
  });

  result = await indexingStore
    .update(schema.account, { address: zeroAddress })
    .set((row) => ({ ...row, balance: row.balance + 10n }));

  expect(result).toStrictEqual({
    address: zeroAddress,
    balance: 32n,
  });

  result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    balance: 32n,
  });
});

test("update throw error when primary key is updated", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  // setup

  await indexingStore
    .insert(schema.account)
    .values({ address: zeroAddress, balance: 10n });

  // no function

  let error: any = await indexingStore
    .update(schema.account, { address: zeroAddress })
    // @ts-expect-error
    .set({ address: ALICE })
    .catch((error) => error);

  expect(error).toBeInstanceOf(NonRetryableUserError);

  // function

  error = await indexingStore
    .update(schema.account, { address: zeroAddress })
    .set(() => ({ address: ALICE }))
    .catch((error) => error);

  expect(error).toBeInstanceOf(NonRetryableUserError);
});

test("delete", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  // no entry

  let deleted = await indexingStore.delete(schema.account, {
    address: zeroAddress,
  });

  expect(deleted).toBe(false);

  // entry

  await indexingStore
    .insert(schema.account)
    .values({ address: zeroAddress, balance: 12n });

  deleted = await indexingStore.delete(schema.account, {
    address: zeroAddress,
  });

  expect(deleted).toBe(true);

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toBe(null);
});

test("sql", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  // setup

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    balance: 10n,
  });

  // select

  const result = await indexingStore.sql
    .select()
    .from(schema.account)
    .where(eq(schema.account.address, zeroAddress));

  expect(result).toStrictEqual([
    {
      address: zeroAddress,
      balance: 10n,
    },
  ]);

  const result2 = await indexingStore.sql.$count(schema.account);
  expect(result2).toBe(1);

  // non-null constraint

  expect(
    await getRejectionValue(
      async () =>
        // @ts-ignore
        await indexingStore.sql.insert(schema.account).values({
          address: "0x0000000000000000000000000000000000000001",
          balance: undefined,
        }),
    ),
  ).toBeInstanceOf(RawSqlError);

  // TODO(kyle) check constraint

  // unique constraint

  expect(
    await getRejectionValue(
      async () =>
        // @ts-ignore
        await indexingStore.sql.insert(schema.account).values({
          address: zeroAddress,
          balance: 10n,
        }),
    ),
  ).toBeInstanceOf(RawSqlError);
});

test("sql with error", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  // error

  const error = await indexingStore.sql
    .execute("SELECT * FROM does_not_exist")
    .catch((error) => error);

  expect(error).toBeInstanceOf(Error);

  // next query doesn't error

  await indexingStore.sql
    .select()
    .from(schema.account)
    .where(eq(schema.account.address, zeroAddress));
});

test("onchain table", async () => {
  const { database } = await setupDatabaseServices();

  const schema = {
    account: pgTable("account", (p) => ({
      address: p.text().primaryKey(),
      balance: p.integer().notNull(),
    })),
  };

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  // check error

  const error = await indexingStore
    // @ts-ignore
    .find(schema.account, { address: zeroAddress })
    .catch((error) => error);

  expect(error).toBeDefined();
});

test("missing rows", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  // error

  const error = await indexingStore
    .insert(schema.account)
    // @ts-ignore
    .values({ address: zeroAddress })
    .catch((error) => error);

  expect(error).toBeDefined();
});

test("unawaited promise", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  indexingStore.isProcessingEvents = false;

  const promise = indexingStore
    .insert(schema.account)
    .values({
      address: zeroAddress,
      balance: 10n,
    })
    .onConflictDoUpdate({
      balance: 16n,
    });

  await expect(promise!).rejects.toThrowError();
});

test("notNull", async () => {
  let schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint(),
    })),
  };
  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  let indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  // insert

  await indexingStore.insert(schema.account).values({ address: zeroAddress });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({ address: zeroAddress, balance: null });

  // error

  schema = {
    // @ts-ignore
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  let error = await indexingStore
    .insert(schema.account)
    .values({ address: zeroAddress })
    .catch((error) => error);

  expect(error).toBeDefined();

  error = await indexingStore
    .insert(schema.account)
    .values({ address: zeroAddress, balance: null })
    .catch((error) => error);

  expect(error).toBeDefined();
});

test("default", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().default(10n),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({ address: zeroAddress });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({ address: zeroAddress, balance: 10n });
});

test("$default", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().$default(() => 10n),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({ address: zeroAddress });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({ address: zeroAddress, balance: 10n });
});

test("$onUpdateFn", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p
        .bigint()
        .notNull()
        .$onUpdateFn(() => 10n),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  // insert

  await indexingStore.insert(schema.account).values({ address: zeroAddress });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({ address: zeroAddress, balance: 10n });

  // update
});

test("basic columns", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
      int2: p.smallint().notNull(),
      int8n: p.int8({ mode: "number" }).notNull(),
      int8b: p.int8({ mode: "bigint" }).notNull(),
      boolean: p.boolean().notNull(),
      text: p.text().notNull(),
      varchar: p.varchar().notNull(),
      char: p.char().notNull(),
      numeric: p.numeric().notNull(),
      real: p.real().notNull(),
      doublePrecision: p.doublePrecision().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });

  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    balance: 20n,
    int2: 20,
    int8n: 20,
    int8b: 20n,
    boolean: true,
    text: "20",
    varchar: "20",
    char: "2",
    numeric: "20",
    real: 20,
    doublePrecision: 20,
  });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toMatchInlineSnapshot(`
      {
        "address": "0x0000000000000000000000000000000000000000",
        "balance": 20n,
        "boolean": true,
        "char": "2",
        "doublePrecision": 20,
        "int2": 20,
        "int8b": 20n,
        "int8n": 20,
        "numeric": "20",
        "real": 20,
        "text": "20",
        "varchar": "20",
      }
    `);
});

test("array", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balances: p.bigint().array().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  // dynamic size

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    balances: [20n],
  });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    balances: [20n],
  });

  // TODO(kyle) fixed size
});

test("enum", async () => {
  const moodEnum = onchainEnum("mood", ["sad", "ok", "happy"]);
  const schema = {
    moodEnum,
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      mood: moodEnum(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    mood: "ok",
  });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    mood: "ok",
  });

  // TODO(kyle) error
});

test("json bigint", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      metadata: p.json().$type<{ balance: bigint }>(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  const error = await indexingStore
    .insert(schema.account)
    .values({
      address: zeroAddress,
      metadata: {
        balance: 10n,
      },
    })
    .then((res) => {
      throw Error(`Expected error, got ${res}`);
    })
    .catch((error) => error);

  expect(error).toBeInstanceOf(BigIntSerializationError);
});

const BIGINT_MAX = 2n ** 256n - 1n;
// https://github.com/ponder-sh/ponder/issues/1475#issuecomment-2625967710
const BIGINT_LARGE =
  81043282338925483631878461732084420541800751556297842951124152226153187811344n;

test("bigint array", async () => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      balances: t.bigint().array().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    balances: [1n, BIGINT_LARGE, BIGINT_MAX],
  });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    balances: [1n, BIGINT_LARGE, BIGINT_MAX],
  });
});

test("bytes", async () => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      calldata: t.bytes().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    calldata: toBytes(zeroAddress),
  });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    calldata: toBytes(zeroAddress),
  });
});

test("text with null bytes", async () => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      name: t.text().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    name: "tencentclub\x00\x00\x00\x00\x00\x00",
  });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    name: "tencentclub",
  });
});

test.skip("time", async () => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      time: t.time().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    time: "04:05:06 PST",
  });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    time: "04:05:06",
  });
});

test("timestamp", async () => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      timestamp: t.timestamp().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    timestamp: new Date(1742925862000),
  });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    timestamp: new Date(1742925862000),
  });
});

test.skip("date", async () => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      date: t.date({ mode: "date" }).notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    date: new Date(1742925862000),
  });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    date: new Date("2025-03-25T00:00:00.000Z"),
  });
});

test.skip("interval", async () => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      interval: t.interval().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    interval: "18 months",
  });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    interval: "1 year 6 mons",
  });
});

test("point", async () => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      point: t.point().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    point: [1, 2],
  });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    point: [1, 2],
  });
});

test("line", async () => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      line: t.line().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    line: [1, 2, 3],
  });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    line: [1, 2, 3],
  });
});
