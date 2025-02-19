import {
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { onchainEnum, onchainTable } from "@/drizzle/onchain.js";
import {
  BigIntSerializationError,
  NotNullConstraintError,
  UniqueConstraintError,
} from "@/internal/errors.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { eq } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import { createIndexingCache } from "./cache.js";
import { createHistoricalIndexingStore } from "./historical.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("find", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const indexingCache = createIndexingCache({
    common: context.common,
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    database,
    indexingCache,
    db: database.qb.drizzle,
  });

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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

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

  // @ts-ignore
  let error = await indexingStore.sql
    .insert(schema.account)
    .values({
      address: "0x0000000000000000000000000000000000000001",
      balance: undefined,
    })
    .catch((error) => error);

  expect(error).instanceOf(NotNullConstraintError);

  // TODO(kyle) check constraint

  // unique constraint

  error = await indexingStore.sql
    .insert(schema.account)
    .values({
      address: zeroAddress,
      balance: 10n,
    })
    .catch((error) => error);

  expect(error).instanceOf(UniqueConstraintError);
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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

  // check error

  const error = await indexingStore
    // @ts-ignore
    .find(schema.account, { address: zeroAddress })
    .catch((error) => error);

  expect(error).toBeDefined();
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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

  // error

  const error = await indexingStore
    .insert(schema.account)
    // @ts-ignore
    .values({ address: zeroAddress })
    .catch((error) => error);

  expect(error).toBeDefined();
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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  let indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

  await indexingStore.insert(schema.account).values({ address: zeroAddress });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({ address: zeroAddress, balance: 0 });
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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

  await indexingStore.insert(schema.account).values({ address: zeroAddress });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({ address: zeroAddress, balance: 10n });
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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

  // insert

  await indexingStore.insert(schema.account).values({ address: zeroAddress });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({ address: zeroAddress, balance: 10n });

  // update
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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

  const error = await indexingStore
    .insert(schema.account)
    .values({
      address: zeroAddress,
      metadata: {
        balance: 10n,
      },
    })
    .catch((error) => error);

  expect(error).toBeInstanceOf(BigIntSerializationError);
});
