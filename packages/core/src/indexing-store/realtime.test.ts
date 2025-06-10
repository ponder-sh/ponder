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
import { eq } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { toBytes, zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import { createRealtimeIndexingStore } from "./realtime.js";

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

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

test("insert", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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
});

test("update", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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
});

test("update throw error when primary key is updated", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

  expect(error).toBeInstanceOf(NonRetryableError);

  // function

  error = await indexingStore
    .update(schema.account, { address: zeroAddress })
    .set(() => ({ address: ALICE }))
    .catch((error) => error);

  expect(error).toBeInstanceOf(NonRetryableError);
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

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

test("onchain table", async (context) => {
  const { database } = await setupDatabaseServices(context);

  const schema = {
    account: pgTable("account", (p) => ({
      address: p.text().primaryKey(),
      balance: p.integer().notNull(),
    })),
  };

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
  });
  indexingStore.qb = database.userQB;

  // check error

  const error = await indexingStore
    // @ts-ignore
    .find(schema.account, { address: zeroAddress })
    .catch((error) => error);

  expect(error).toBeDefined();
});

test("missing rows", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

test("notNull", async (context) => {
  let schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint(),
    })),
  };
  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  let indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

test("default", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().default(10n),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({ address: zeroAddress });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({ address: zeroAddress, balance: 10n });
});

test("$default", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().$default(() => 10n),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(schema.account).values({ address: zeroAddress });

  const result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({ address: zeroAddress, balance: 10n });
});

test("$onUpdateFn", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p
        .bigint()
        .notNull()
        .$onUpdateFn(() => 10n),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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
    .catch((error) => error);

  expect(error).toBeInstanceOf(BigIntSerializationError);
});

const BIGINT_MAX = 2n ** 256n - 1n;
// https://github.com/ponder-sh/ponder/issues/1475#issuecomment-2625967710
const BIGINT_LARGE =
  81043282338925483631878461732084420541800751556297842951124152226153187811344n;

test("bigint array", async (context) => {
  const schema = {
    account: onchainTable("account", (t) => ({
      address: t.hex().primaryKey(),
      balances: t.bigint().array().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema },
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
