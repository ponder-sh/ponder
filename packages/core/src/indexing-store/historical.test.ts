import {
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
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { eq } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { zeroAddress } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import { createHistoricalIndexingStore } from "./historical.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

test("find", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    database,
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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

  await cleanup();
});

test("insert", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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

  await cleanup();
});

test("update", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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

  await cleanup();
});

test("delete", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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

  deleted = await indexingStore.delete(schema.account, {
    address: zeroAddress,
  });

  expect(deleted).toBe(true);

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toBe(null);

  await cleanup();
});

test("flush", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  // insert

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    balance: 10n,
  });

  await indexingStore.flush();

  let result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    balance: 10n,
  });

  // update

  await indexingStore.update(schema.account, { address: zeroAddress }).set({
    balance: 12n,
  });

  await indexingStore.flush();

  result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    balance: 12n,
  });

  await cleanup();
});

test("sql", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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

  // triggers

  const spy = vi.spyOn(database, "createTriggers");

  await indexingStore.sql.select().from(schema.account);

  expect(spy).toHaveBeenCalledOnce();

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

  await cleanup();
});

test("sql followed by find", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database, cleanup } = await setupDatabaseServices(context, {
    schema,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schema,
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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

  await cleanup();
});

test("onchain table", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const schema = {
    account: pgTable("account", (p) => ({
      address: p.text().primaryKey(),
      balance: p.integer().notNull(),
    })),
  };

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  // check error

  const error = await indexingStore
    // @ts-ignore
    .find(schema.account, { address: zeroAddress })
    .catch((error) => error);

  expect(error).toBeDefined();

  await cleanup();
});

test("missing rows", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  // error

  const error = await indexingStore
    .insert(schema.account)
    // @ts-ignore
    .values({ address: zeroAddress })
    .catch((error) => error);

  expect(error).toBeDefined();

  await cleanup();
});

test("notNull", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  let schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint(),
    })),
  };

  let indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

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

  indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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

  await cleanup();
});

test("default", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.integer().default(0),
    })),
  };

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  await indexingStore.insert(schema.account).values({ address: zeroAddress });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({ address: zeroAddress, balance: 0 });

  await cleanup();
});

test("$default", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().$default(() => 10n),
    })),
  };

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  await indexingStore.insert(schema.account).values({ address: zeroAddress });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({ address: zeroAddress, balance: 10n });

  await cleanup();
});

test("$onUpdateFn", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p
        .bigint()
        .notNull()
        .$onUpdateFn(() => 10n),
    })),
  };

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  // insert

  await indexingStore.insert(schema.account).values({ address: zeroAddress });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({ address: zeroAddress, balance: 10n });

  // update

  await cleanup();
});

test("array", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  // dynamic size

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balances: p.bigint().array().notNull(),
    })),
  };

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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

  await cleanup();
});

test("enum", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const moodEnum = onchainEnum("mood", ["sad", "ok", "happy"]);
  const schema = {
    moodEnum,
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      mood: moodEnum(),
    })),
  };

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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

  await cleanup();
});

test("json bigint", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);

  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      metadata: p.json().$type<{ balance: bigint }>(),
    })),
  };

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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

  await cleanup();
});
