import { ALICE } from "@/_test/constants.js";
import {
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
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
import { createIndexingCache } from "./cache.js";
import { createHistoricalIndexingStore } from "./historical.js";

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

test("find", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

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

    // force db query

    indexingCache.clear();
    indexingCache.invalidate();

    result = await indexingStore.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toBe(null);
  });
});

test("insert", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

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
  });
});

test("update", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

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

    // undefined

    result = await indexingStore
      .update(schema.account, { address: zeroAddress })
      .set({ balance: undefined });

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
  });
});

test("update throw error when primary key is updated", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

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

    // update same primary key no function
    let row: any = await indexingStore
      .update(schema.account, { address: zeroAddress })
      // @ts-expect-error
      .set({ address: zeroAddress, balance: 20n })
      .catch((error) => error);

    expect(row.address).toBe(zeroAddress);
    expect(row.balance).toBe(20n);

    // update same primary key function
    row = await indexingStore
      .update(schema.account, { address: zeroAddress })
      .set(() => ({ address: zeroAddress, balance: 30n }))
      .catch((error) => error);

    expect(row.address).toBe(zeroAddress);
    expect(row.balance).toBe(30n);
  });
});

test("delete", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };
  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // no entry

    let deleted = await indexingStore.delete(schema.account, {
      address: zeroAddress,
    });

    expect(deleted).toBe(false);

    // entry

    await indexingStore
      .insert(schema.account)
      .values({ address: zeroAddress, balance: 12n });
    await indexingStore
      .update(schema.account, { address: zeroAddress })
      .set({ balance: 12n });

    deleted = await indexingStore.delete(schema.account, {
      address: zeroAddress,
    });

    expect(deleted).toBe(true);

    const result = await indexingStore.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toBe(null);
  });
});

test("sql", async (context) => {
  if (context.databaseConfig.kind === "pglite_test") {
    return;
  }

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

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

    // non-null constraint

    await tx.wrap((db) => db.execute("SAVEPOINT test"));

    await expect(
      async () =>
        // @ts-ignore
        await indexingStore.sql.insert(schema.account).values({
          address: "0x0000000000000000000000000000000000000001",
          balance: undefined,
        }),
    ).rejects.toThrowError(RawSqlError);

    // TODO(kyle) check constraint

    // unique constraint

    await tx.wrap((db) => db.execute("ROLLBACK TO test"));

    await expect(
      async () =>
        await indexingStore.sql
          .insert(schema.account)
          .values({ address: zeroAddress, balance: 10n }),
    ).rejects.toThrowError(RawSqlError);
  });
});

test("sql followed by find", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.sql
      .insert(schema.account)
      .values({ address: zeroAddress, balance: 10n });

    const row = await indexingStore.find(schema.account, {
      address: zeroAddress,
    });

    expect(row).toStrictEqual({
      address: zeroAddress,
      balance: 10n,
    });
  });
});

test("sql with error", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // error

    const error = await indexingStore.sql
      .execute("SELECT * FROM does_not_exist")
      .catch((error) => error);

    expect(error).toBeInstanceOf(RawSqlError);

    // next query doesn't error

    await indexingStore.sql
      .select()
      .from(schema.account)
      .where(eq(schema.account.address, zeroAddress));
  });
});

test("onchain table", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: pgTable("account", (p) => ({
      address: p.text().primaryKey(),
      balance: p.integer().notNull(),
    })),
  };

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // check error

    await expect(() =>
      indexingStore
        // @ts-ignore
        .find(schema.account, { address: zeroAddress }),
    ).rejects.toThrow();
  });
});

test("missing rows", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // error

    await expect(
      async () =>
        await indexingStore
          .insert(schema.account)
          // @ts-ignore
          .values({ address: zeroAddress }),
    ).rejects.toThrow();
  });
});

test("unawaited promise", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  indexingCache.qb = database.userQB;
  indexingStore.qb = database.userQB;

  indexingStore.isProcessingEvents = false;

  const promise = indexingStore
    .insert(schema.account)
    .values({
      address: "0x0000000000000000000000000000000000000001",
      balance: 90n,
    })
    .onConflictDoUpdate({
      balance: 16n,
    });

  await expect(promise!).rejects.toThrowError();
});

test("notNull", async (context) => {
  const { database } = await setupDatabaseServices(context);

  let schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint(),
    })),
  };

  let indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  let indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // insert

    let result = await indexingStore
      .insert(schema.account)
      .values({ address: zeroAddress });

    expect(result).toStrictEqual({ address: zeroAddress, balance: null });

    result = await indexingStore
      .find(schema.account, {
        address: zeroAddress,
      })
      .then((result) => result!);

    expect(result).toStrictEqual({ address: zeroAddress, balance: null });

    // update

    result = await indexingStore
      .update(schema.account, { address: zeroAddress })
      .set({});

    expect(result).toStrictEqual({ address: zeroAddress, balance: null });

    // error

    schema = {
      // @ts-ignore
      account: onchainTable("account", (p) => ({
        address: p.hex().primaryKey(),
        balance: p.bigint().notNull(),
      })),
    };

    indexingCache = createIndexingCache({
      common: context.common,
      schemaBuild: { schema },
      crashRecoveryCheckpoint: undefined,
      eventCount: {},
    });

    indexingStore = createHistoricalIndexingStore({
      common: context.common,
      schemaBuild: { schema },
      indexingCache,
      indexingErrorHandler,
    });

    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await expect(
      async () =>
        await indexingStore
          .insert(schema.account)
          .values({ address: zeroAddress }),
    ).rejects.toThrow();

    await expect(
      async () =>
        await indexingStore
          .insert(schema.account)
          .values({ address: zeroAddress, balance: null }),
    ).rejects.toThrow();
  });
});

test("default", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.integer().default(0),
    })),
  };

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.insert(schema.account).values({ address: zeroAddress });

    const result = await indexingStore.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toStrictEqual({ address: zeroAddress, balance: 0 });
  });
});

test("$default", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().$default(() => 10n),
    })),
  };

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.insert(schema.account).values({ address: zeroAddress });

    const result = await indexingStore.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toStrictEqual({ address: zeroAddress, balance: 10n });
  });
});

test("$onUpdateFn", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p
        .bigint()
        .notNull()
        .$onUpdateFn(() => 10n),
    })),
  };

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // insert

    await indexingStore.insert(schema.account).values({ address: zeroAddress });

    const result = await indexingStore.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toStrictEqual({ address: zeroAddress, balance: 10n });

    // update
  });
});

test("basic columns", async (context) => {
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

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

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

    await indexingCache.flush();
  });
});

test("array", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balances: p.bigint().array().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  // dynamic size

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

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

    await indexingCache.flush();

    // TODO(kyle) fixed size
  });
});

test("text array", async (context) => {
  const schema = {
    test: onchainTable("test", (p) => ({
      address: p.hex().primaryKey(),
      textArray: p.text().array().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    const STRING_ARRAY_VALUE = "//U_W_U\\\\";

    await indexingStore.insert(schema.test).values({
      address: zeroAddress,
      textArray: [STRING_ARRAY_VALUE],
    });

    const result = await indexingStore.find(schema.test, {
      address: zeroAddress,
    });

    expect(result).toMatchInlineSnapshot(`
    {
      "address": "0x0000000000000000000000000000000000000000",
      "textArray": [
        "//U_W_U\\\\",
      ],
    }
  `);

    await indexingCache.flush();
  });
});

test("enum", async (context) => {
  const moodEnum = onchainEnum("mood", ["sad", "ok", "happy"]);
  const schema = {
    moodEnum,
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      mood: moodEnum(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

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

    await indexingCache.flush();

    // TODO(kyle) error
  });
});

test("json bigint", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      metadata: p.json().$type<{ balance: bigint }>(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await expect(
      async () =>
        await indexingStore
          .insert(schema.account)
          .values({ address: zeroAddress, metadata: { balance: 10n } }),
    ).rejects.toThrowError(BigIntSerializationError);
  });
});

test("bytes", async (context) => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      calldata: t.bytes().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

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

    await indexingCache.flush();
  });
});

test("text with null bytes", async (context) => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      name: t.text().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

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

    await indexingCache.flush();
  });
});

test.skip("time", async (context) => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      time: t.time().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.insert(schema.account).values({
      address: zeroAddress,
      time: "04:05:06",
    });

    const result = await indexingStore.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toStrictEqual({
      address: zeroAddress,
      time: "04:05:06",
    });

    await indexingCache.flush();
  });
});

test("timestamp", async (context) => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      timestamp: t.timestamp().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

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

    await indexingCache.flush();
  });
});

test.skip("date", async (context) => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      date: t.date({ mode: "date" }).notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

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

    await indexingCache.flush();
  });
});

test.skip("interval", async (context) => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      interval: t.interval().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.insert(schema.account).values({
      address: zeroAddress,
      interval: "1 day",
    });

    const result = await indexingStore.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toStrictEqual({
      address: zeroAddress,
      interval: "1 day",
    });

    await indexingCache.flush();
  });
});

test("point", async (context) => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      point: t.point().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

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

    await indexingCache.flush();
  });
});

test("line", async (context) => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      line: t.line().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

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

    await indexingCache.flush();
  });
});
