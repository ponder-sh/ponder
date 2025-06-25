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
  NonRetryableError,
  NotNullConstraintError,
  UniqueConstraintError,
} from "@/internal/errors.js";
import { eq, sql } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { toBytes, zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import { createIndexingCache } from "./cache.js";
import { createHistoricalIndexingStore } from "./historical.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

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
  });

  await database.userQB().transaction(async (tx) => {
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });

  await database.userQB().transaction(async (tx) => {
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

    expect(error).toBeInstanceOf(NonRetryableError);

    // function

    error = await indexingStore
      .update(schema.account, { address: zeroAddress })
      .set(() => ({ address: ALICE }))
      .catch((error) => error);

    expect(error).toBeInstanceOf(NonRetryableError);
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });

  await database.userQB().transaction(async (tx) => {
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

    await tx().execute(sql.raw("SAVEPOINT test"));

    await expect(
      async () =>
        // @ts-ignore
        await indexingStore.sql.insert(schema.account).values({
          address: "0x0000000000000000000000000000000000000001",
          balance: undefined,
        }),
    ).rejects.toThrowError(NotNullConstraintError);

    // TODO(kyle) check constraint

    // unique constraint

    await tx().execute(sql.raw("ROLLBACK TO test"));

    await expect(
      async () =>
        await indexingStore.sql
          .insert(schema.account)
          .values({ address: zeroAddress, balance: 10n }),
    ).rejects.toThrowError(UniqueConstraintError);
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });

  await database.userQB().transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // error

    const error = await indexingStore.sql
      .execute(sql`SELECT * FROM does_not_exist`)
      .catch((error) => error);

    expect(error).toBeInstanceOf(Error);

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
  });

  await database.userQB().transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // check error

    const error = await indexingStore
      // @ts-expect-error
      .find(schema.account, { address: zeroAddress })
      .catch((error) => error);

    expect(error).toBeInstanceOf(Error);
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });

  await database.userQB().transaction(async (tx) => {
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
    });

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
  });

  await database.userQB().transaction(async (tx) => {
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });

  await database.userQB().transaction(async (tx) => {
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

test("array", async (context) => {
  const { database } = await setupDatabaseServices(context);

  // dynamic size

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balances: p.bigint().array().notNull(),
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
  });

  await database.userQB().transaction(async (tx) => {
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

    // TODO(kyle) fixed size
  });
});

test("text array", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    test: onchainTable("test", (p) => ({
      address: p.hex().primaryKey(),
      textArray: p.text().array().notNull(),
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });
});

test("enum", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const moodEnum = onchainEnum("mood", ["sad", "ok", "happy"]);
  const schema = {
    moodEnum,
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      mood: moodEnum(),
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
  });

  await database.userQB().transaction(async (tx) => {
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

    // TODO(kyle) error
  });
});

test("json bigint", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      metadata: p.json().$type<{ balance: bigint }>(),
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
  });

  await database.userQB().transaction(async (tx) => {
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
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      calldata: t.bytes().notNull(),
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });
});

test("text with null bytes", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      name: t.text().notNull(),
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });
});

test.skip("time", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      time: t.time().notNull(),
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });
});

test("timestamp", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      timestamp: t.timestamp().notNull(),
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });
});

test.skip("date", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      date: t.date({ mode: "date" }).notNull(),
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });
});

test.skip("interval", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      interval: t.interval().notNull(),
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });
});

test("point", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      point: t.point().notNull(),
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });
});

test("line", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      line: t.line().notNull(),
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
  });

  await database.userQB().transaction(async (tx) => {
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
  });
});
