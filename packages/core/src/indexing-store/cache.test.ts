import { ALICE, BOB } from "@/_test/constants.js";
import {
  setupAnvil,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { deployErc20, mintErc20 } from "@/_test/simulate.js";
import { getErc20IndexingBuild, getSimulatedEvent } from "@/_test/utils.js";
import { onchainEnum, onchainTable } from "@/drizzle/onchain.js";
import { getEventCount } from "@/indexing/index.js";
import type { RetryableError } from "@/internal/errors.js";
import type { IndexingErrorHandler } from "@/internal/types.js";
import { parseEther, zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import { createIndexingCache } from "./cache.js";
import { createHistoricalIndexingStore } from "./historical.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);
beforeEach(setupAnvil);

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
    indexingErrorHandler,
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

    expect(result).toMatchInlineSnapshot(`
      {
        "address": "0x0000000000000000000000000000000000000000",
        "balance": 10n,
        Symbol(nodejs.util.inspect.custom): [Function],
      }
    `);
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
    indexingErrorHandler,
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

    expect(result).toMatchInlineSnapshot(`
      {
        "address": "0x0000000000000000000000000000000000000000",
        "balance": 12n,
        Symbol(nodejs.util.inspect.custom): [Function],
      }
    `);

    // flush again to make sure temp tables are cleaned up

    await indexingStore.update(schema.account, { address: zeroAddress }).set({
      balance: 12n,
    });

    await indexingCache.flush();

    result = await indexingStore.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchInlineSnapshot(`
      {
        "address": "0x0000000000000000000000000000000000000000",
        "balance": 12n,
        Symbol(nodejs.util.inspect.custom): [Function],
      }
    `);
  });
});

test("flush() recovers error", async (context) => {
  if (context.databaseConfig.kind !== "postgres") {
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

    await indexingStore.insert(schema.account).values({
      address: zeroAddress,
      balance: 10n,
    });

    await indexingCache.flush();

    await indexingStore.insert(schema.account).values({
      address: zeroAddress,
      balance: 10n,
    });

    await expect(() =>
      indexingCache.flush(),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[DelayedInsertError: duplicate key value violates unique constraint "account_pkey"]`,
    );
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
    indexingErrorHandler,
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
    indexingErrorHandler,
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

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const event = getSimulatedEvent({
    eventCallback: eventCallbacks[0]!,
    blockData,
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    schemaBuild: { schema },
    crashRecoveryCheckpoint: undefined,
    eventCount: getEventCount(indexingFunctions),
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  indexingCache.event = event;

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

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  // skip hot loop
  indexingCache.invalidate();

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
    await indexingCache.prefetch({ events: [] });

    const result = indexingCache.has({
      table: schema.account,
      key: { address: zeroAddress },
    });

    expect(result).toBe(false);
  });
});
