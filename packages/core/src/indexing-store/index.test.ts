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
  IndexingDBError,
  RawSqlError,
} from "@/internal/errors.js";
import type { IndexingErrorHandler } from "@/internal/types.js";
import { eq } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { toBytes, zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import { createIndexingCache } from "./cache.js";
import { createIndexingStore } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

const indexingErrorHandler: IndexingErrorHandler = {
  getError: () => {
    return indexingErrorHandler.error;
  },
  setError: (error: Error) => {
    indexingErrorHandler.error = error;
  },
  clearError: () => {
    indexingErrorHandler.error = undefined;
  },
  error: undefined as Error | undefined,
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // empty

    let result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toBe(null);

    // with entry

    await indexingStore.db
      .insert(schema.account)
      .values({ address: zeroAddress, balance: 10n });

    result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 10n,
    });

    // force db query

    indexingCache.clear();
    indexingCache.invalidate();

    result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toBe(null);
  });
});

test("insert", async () => {
  const { database } = await setupDatabaseServices();

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

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // single

    let result: any = await indexingStore.db
      .insert(schema.account)
      .values({ address: zeroAddress, balance: 10n });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 10n,
    });

    result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 10n,
    });

    // multiple

    result = await indexingStore.db.insert(schema.account).values([
      { address: "0x0000000000000000000000000000000000000001", balance: 12n },
      { address: "0x0000000000000000000000000000000000000002", balance: 52n },
    ]);

    expect(result).toMatchObject([
      {
        address: "0x0000000000000000000000000000000000000001",
        balance: 12n,
      },
      {
        address: "0x0000000000000000000000000000000000000002",
        balance: 52n,
      },
    ]);

    result = await indexingStore.db.find(schema.account, {
      address: "0x0000000000000000000000000000000000000001",
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000001",
      balance: 12n,
    });

    result = await indexingStore.db.find(schema.account, {
      address: "0x0000000000000000000000000000000000000002",
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000002",
      balance: 52n,
    });

    // on conflict do nothing

    result = await indexingStore.db
      .insert(schema.account)
      .values({
        address: "0x0000000000000000000000000000000000000001",
        balance: 44n,
      })
      .onConflictDoNothing();

    expect(result).toBe(null);

    result = await indexingStore.db.find(schema.account, {
      address: "0x0000000000000000000000000000000000000001",
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000001",
      balance: 12n,
    });

    result = await indexingStore.db
      .insert(schema.account)
      .values([
        { address: "0x0000000000000000000000000000000000000001", balance: 44n },
        { address: "0x0000000000000000000000000000000000000003", balance: 0n },
      ])
      .onConflictDoNothing();

    expect(result).toMatchObject([
      null,
      {
        address: "0x0000000000000000000000000000000000000003",
        balance: 0n,
      },
    ]);

    result = await indexingStore.db.find(schema.account, {
      address: "0x0000000000000000000000000000000000000001",
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000001",
      balance: 12n,
    });

    // on conflict do update

    await indexingStore.db
      .insert(schema.account)
      .values({
        address: "0x0000000000000000000000000000000000000001",
        balance: 90n,
      })
      .onConflictDoUpdate({
        balance: 16n,
      });

    result = await indexingStore.db.find(schema.account, {
      address: "0x0000000000000000000000000000000000000001",
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000001",
      balance: 16n,
    });

    await indexingStore.db
      .insert(schema.account)
      .values([
        { address: "0x0000000000000000000000000000000000000001", balance: 44n },
        { address: "0x0000000000000000000000000000000000000002", balance: 0n },
      ])
      .onConflictDoUpdate((row) => ({
        balance: row.balance + 16n,
      }));

    result = await indexingStore.db.find(schema.account, {
      address: "0x0000000000000000000000000000000000000001",
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000001",
      balance: 32n,
    });
  });
});

test("update", async () => {
  const { database } = await setupDatabaseServices();

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

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // setup

    await indexingStore.db
      .insert(schema.account)
      .values({ address: zeroAddress, balance: 10n });

    // no function

    let result: any = await indexingStore.db
      .update(schema.account, { address: zeroAddress })
      .set({ balance: 12n });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 12n,
    });

    result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 12n,
    });

    // function

    result = await indexingStore.db
      .update(schema.account, { address: zeroAddress })
      .set((row) => ({ balance: row.balance + 10n }));

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 22n,
    });

    result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 22n,
    });

    // undefined

    result = await indexingStore.db
      .update(schema.account, { address: zeroAddress })
      .set({ balance: undefined });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 22n,
    });

    result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 22n,
    });
  });
});

test("update throw error when primary key is updated", async () => {
  const { database } = await setupDatabaseServices();

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

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // setup

    await indexingStore.db
      .insert(schema.account)
      .values({ address: zeroAddress, balance: 10n });

    // no function

    let error: any = await indexingStore.db
      .update(schema.account, { address: zeroAddress })
      // @ts-expect-error
      .set({ address: ALICE })
      .catch((error) => error);

    expect(error).toBeInstanceOf(IndexingDBError);

    // function

    error = await indexingStore.db
      .update(schema.account, { address: zeroAddress })
      .set(() => ({ address: ALICE }))
      .catch((error) => error);

    expect(error).toBeInstanceOf(IndexingDBError);

    // update same primary key no function
    let row: any = await indexingStore.db
      .update(schema.account, { address: zeroAddress })
      // @ts-expect-error
      .set({ address: zeroAddress, balance: 20n })
      .catch((error) => error);

    expect(row.address).toBe(zeroAddress);
    expect(row.balance).toBe(20n);

    // update same primary key function
    row = await indexingStore.db
      .update(schema.account, { address: zeroAddress })
      .set(() => ({ address: zeroAddress, balance: 30n }))
      .catch((error) => error);

    expect(row.address).toBe(zeroAddress);
    expect(row.balance).toBe(30n);
  });
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // no entry

    let deleted = await indexingStore.db.delete(schema.account, {
      address: zeroAddress,
    });

    expect(deleted).toBe(false);

    // entry

    await indexingStore.db
      .insert(schema.account)
      .values({ address: zeroAddress, balance: 12n });
    await indexingStore.db
      .update(schema.account, { address: zeroAddress })
      .set({ balance: 12n });

    deleted = await indexingStore.db.delete(schema.account, {
      address: zeroAddress,
    });

    expect(deleted).toBe(true);

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toBe(null);
  });
});

test("sql", async () => {
  if (context.databaseConfig.kind === "pglite_test") {
    return;
  }

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // setup

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      balance: 10n,
    });

    // select

    const result = await indexingStore.db.sql
      .select()
      .from(schema.account)
      .where(eq(schema.account.address, zeroAddress));

    expect(result).toMatchObject([
      {
        address: "0x0000000000000000000000000000000000000000",
        balance: 10n,
      },
    ]);

    // non-null constraint

    await tx.wrap((db) => db.execute("SAVEPOINT test"));

    await expect(
      // @ts-ignore
      indexingStore.db.sql
        .insert(schema.account)
        .values({
          address: "0x0000000000000000000000000000000000000001",
          balance: undefined,
        }),
    ).rejects.toThrow(RawSqlError);

    // TODO(kyle) check constraint

    // unique constraint

    await tx.wrap((db) => db.execute("ROLLBACK TO test"));

    await expect(
      indexingStore.db.sql
        .insert(schema.account)
        .values({ address: zeroAddress, balance: 10n }),
    ).rejects.toThrow(RawSqlError);
  });
});

test("sql followed by find", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db.sql
      .insert(schema.account)
      .values({ address: zeroAddress, balance: 10n });

    const row = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(row).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 10n,
    });
  });
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // error

    const error = await indexingStore.db.sql
      .execute("SELECT * FROM does_not_exist")
      .catch((error) => error);

    expect(error).toBeInstanceOf(RawSqlError);

    // next query doesn't error

    await indexingStore.db.sql
      .select()
      .from(schema.account)
      .where(eq(schema.account.address, zeroAddress));
  });
});

test("onchain table", async () => {
  const { database } = await setupDatabaseServices();

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

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // check error

    expect(
      await getRejectionValue(
        async () =>
          await indexingStore.db
            // @ts-ignore
            .find(schema.account, { address: zeroAddress }),
      ),
    ).toBeTruthy();
  });
});

test("missing rows", async () => {
  const { database } = await setupDatabaseServices();

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

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // error

    expect(
      await getRejectionValue(
        // @ts-ignore
        async () =>
          await indexingStore.db
            .insert(schema.account)
            // @ts-ignore
            .values({ address: zeroAddress }),
      ),
    ).toBeTruthy();
  });
});

test("unawaited promise", async () => {
  const { database } = await setupDatabaseServices();

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

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  indexingCache.qb = database.userQB;
  indexingStore.qb = database.userQB;

  indexingStore.isProcessingEvents = false;

  const promise = indexingStore.db
    .insert(schema.account)
    .values({
      address: "0x0000000000000000000000000000000000000001",
      balance: 90n,
    })
    .onConflictDoUpdate({
      balance: 16n,
    });

  expect(await getRejectionValue(async () => await promise)).toBeTruthy();
});

test("notNull", async () => {
  const { database } = await setupDatabaseServices();

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

  let indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // insert

    let result = await indexingStore.db
      .insert(schema.account)
      .values({ address: zeroAddress });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: null,
    });

    result = await indexingStore.db
      .find(schema.account, {
        address: zeroAddress,
      })
      .then((result) => result!);

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: null,
    });

    // update

    result = await indexingStore.db
      .update(schema.account, { address: zeroAddress })
      .set({});

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: null,
    });

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

    indexingStore = createIndexingStore({
      common: context.common,
      schemaBuild: { schema },
      indexingCache,
      indexingErrorHandler,
    });

    indexingCache.qb = tx;
    indexingStore.qb = tx;

    expect(
      await getRejectionValue(
        async () =>
          await indexingStore.db
            .insert(schema.account)
            .values({ address: zeroAddress }),
      ),
    ).toBeTruthy();

    expect(
      await getRejectionValue(
        async () =>
          await indexingStore.db
            .insert(schema.account)
            .values({ address: zeroAddress, balance: null }),
      ),
    ).toBeTruthy();
  });
});

test("default", async () => {
  const { database } = await setupDatabaseServices();

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

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db
      .insert(schema.account)
      .values({ address: zeroAddress });

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 0,
    });
  });
});

test("$default", async () => {
  const { database } = await setupDatabaseServices();

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

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db
      .insert(schema.account)
      .values({ address: zeroAddress });

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 10n,
    });
  });
});

test("$onUpdateFn", async () => {
  const { database } = await setupDatabaseServices();

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

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // insert

    await indexingStore.db
      .insert(schema.account)
      .values({ address: zeroAddress });

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 10n,
    });

    // update
  });
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db.insert(schema.account).values({
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

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 20n,
      boolean: true,
      char: "2",
      doublePrecision: 20,
      int2: 20,
      int8b: 20n,
      int8n: 20,
      numeric: "20",
      real: 20,
      text: "20",
      varchar: "20",
    });

    await indexingCache.flush();
  });
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      balances: [20n],
    });

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balances: [20n],
    });

    await indexingCache.flush();

    // TODO(kyle) fixed size
  });
});

test("text array", async () => {
  const schema = {
    test: onchainTable("test", (p) => ({
      address: p.hex().primaryKey(),
      textArray: p.text().array().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    const STRING_ARRAY_VALUE = "//U_W_U\\\\";

    await indexingStore.db.insert(schema.test).values({
      address: zeroAddress,
      textArray: [STRING_ARRAY_VALUE],
    });

    const result = await indexingStore.db.find(schema.test, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      textArray: ["//U_W_U\\\\"],
    });

    await indexingCache.flush();
  });
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      mood: "ok",
    });

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      mood: "ok",
    });

    await indexingCache.flush();

    // TODO(kyle) error
  });
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    expect(
      await getRejectionValue(
        async () =>
          await indexingStore.db
            .insert(schema.account)
            .values({ address: zeroAddress, metadata: { balance: 10n } }),
      ),
    ).toBeInstanceOf(BigIntSerializationError);
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      calldata: toBytes(zeroAddress),
    });

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      calldata: new Uint8Array(20),
    });

    await indexingCache.flush();
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      name: "tencentclub\x00\x00\x00\x00\x00\x00",
    });

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      name: "tencentclub",
    });

    await indexingCache.flush();
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      time: "04:05:06",
    });

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchInlineSnapshot();

    await indexingCache.flush();
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      timestamp: new Date(1742925862000),
    });

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      timestamp: new Date(1742925862000),
    });

    await indexingCache.flush();
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      date: new Date(1742925862000),
    });

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchInlineSnapshot();

    await indexingCache.flush();
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      interval: "1 day",
    });

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchInlineSnapshot();

    await indexingCache.flush();
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      point: [1, 2],
    });

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      point: [1, 2],
    });

    await indexingCache.flush();
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

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: {},
  });

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      line: [1, 2, 3],
    });

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      line: [1, 2, 3],
    });

    await indexingCache.flush();
  });
});
