import { ALICE, BOB } from "@/_test/constants.js";
import {
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { onchainEnum, onchainTable } from "@/drizzle/onchain.js";
import type { LogEvent } from "@/internal/types.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { parseEther, zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import { createIndexingCache } from "./cache.js";
import { createHistoricalIndexingStore } from "./historical.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("flush() insert", async (context) => {
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

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.insert(schema.account).values({
      address: zeroAddress,
      balance: 10n,
    });

    await indexingCache.flush();

    const result = await indexingStore.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toStrictEqual({
      address: zeroAddress,
      balance: 10n,
    });
  });
});

test("flush() update", async (context) => {
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

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    // mutate the cache to skip hot loops

    indexingCache.invalidate();

    await indexingStore.find(schema.account, {
      address: zeroAddress,
    });

    await indexingStore.insert(schema.account).values({
      address: zeroAddress,
      balance: 10n,
    });

    // first flush takes "insert" path
    await indexingCache.flush();

    await indexingStore.update(schema.account, { address: zeroAddress }).set({
      balance: 12n,
    });

    // second flush takes "update" path
    await indexingCache.flush();

    let result = await indexingStore.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toStrictEqual({
      address: zeroAddress,
      balance: 12n,
    });

    // flush again to make sure temp tables are cleaned up

    await indexingStore.update(schema.account, { address: zeroAddress }).set({
      balance: 12n,
    });

    await indexingCache.flush();

    result = await indexingStore.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toStrictEqual({
      address: zeroAddress,
      balance: 12n,
    });
  });
});

test("flush() encoding", async (context) => {
  const e = onchainEnum("e", ["a", "b", "c"]);
  const schema = {
    e,
    test: onchainTable("test", (p) => ({
      hex: p.hex().primaryKey(),
      bigint: p.bigint().notNull(),
      e: e().notNull(),
      array: p.integer().array().notNull(),
      json: p.json().notNull(),
      null: p.text(),
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

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.insert(schema.test).values({
      hex: zeroAddress,
      bigint: 10n,
      e: "a",
      array: [1, 2, 4],
      json: { a: 1, b: 2 },
      null: null,
    });

    await indexingCache.flush();

    indexingCache.clear();
    const result = await indexingStore.sql.select().from(schema.test);

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "array": [
            1,
            2,
            4,
          ],
          "bigint": 10n,
          "e": "a",
          "hex": "0x0000000000000000000000000000000000000000",
          "json": {
            "a": 1,
            "b": 2,
          },
          "null": null,
        },
      ]
    `);
  });
});

test("flush() encoding escape", async (context) => {
  const schema = {
    test: onchainTable("test", (p) => ({
      backslash: p.text().primaryKey(),
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

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    const values = [
      { backslash: "\\\\" },
      { backslash: "\\b" },
      { backslash: "\\f" },
      { backslash: "\\n" },
      { backslash: "\\r" },
      { backslash: "\\t" },
      { backslash: "\\v" },
      { backslash: "\\00" },
      { backslash: "\\x00" },
      { backslash: "\\" },
      { backslash: "\b" },
      { backslash: "\f" },
      { backslash: "\n" },
      { backslash: "\r" },
      { backslash: "\t" },
      { backslash: "\v" },
      // { backslash: "\00" },
      // { backslash: "\x00" },
    ];

    await indexingStore.insert(schema.test).values(values);

    await indexingCache.flush();

    indexingCache.clear();
    const result = await indexingStore.sql.select().from(schema.test);

    expect(result).toStrictEqual(values);
  });
});

test("prefetch() uses profile metadata", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "Contract:Event",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: {
        from: zeroAddress,
        to: ALICE,
        amount: parseEther("1"),
      },
      log: {} as LogEvent["event"]["log"],
      block: {} as LogEvent["event"]["block"],
      transaction: {} as LogEvent["event"]["transaction"],
    },
  } satisfies LogEvent;

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: { "Contract:Event": 0 },
  });

  indexingCache.event = event;

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore
      .insert(schema.account)
      .values({
        address: ALICE,
        balance: parseEther("1"),
      })
      .onConflictDoNothing();

    // @ts-ignore
    event.event.args.to = BOB;

    await indexingCache.flush();
    await indexingCache.prefetch({ events: [event] });

    const result = indexingCache.has({
      table: schema.account,
      key: { address: BOB },
    });

    expect(result).toBe(true);
  });
});

test("prefetch() evicts rows", async (context) => {
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

  // skip hot loop
  indexingCache.invalidate();

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
  });

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.insert(schema.account).values({
      address: zeroAddress,
      balance: 10n,
    });

    await indexingCache.flush();
    // prefetch() should evict rows from the cache to free memory
    await indexingCache.prefetch({ events: [] });

    const result = indexingCache.has({
      table: schema.account,
      key: { address: zeroAddress },
    });

    expect(result).toBe(false);
  });
});
