import {
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { onchainTable } from "@/drizzle/onchain.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { zeroAddress } from "viem";
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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  await database.transaction(async (client, tx) => {
    const indexingStore = createHistoricalIndexingStore({
      common: context.common,
      database,
      schemaBuild: { schema },
      indexingCache,
      db: tx,
      client,
    });

    await indexingStore.insert(schema.account).values({
      address: zeroAddress,
      balance: 10n,
    });

    await indexingCache.flush({ client });

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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  await database.transaction(async (client, tx) => {
    const indexingStore = createHistoricalIndexingStore({
      common: context.common,
      database,
      schemaBuild: { schema },
      indexingCache,
      db: tx,
      client,
    });

    await indexingStore.insert(schema.account).values({
      address: zeroAddress,
      balance: 10n,
    });

    await indexingCache.flush({ client });
    indexingCache.commit();

    await indexingStore.update(schema.account, { address: zeroAddress }).set({
      balance: 12n,
    });

    await indexingCache.flush({ client });

    const result = await indexingStore.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toStrictEqual({
      address: zeroAddress,
      balance: 12n,
    });
  });
});

test("flush() encoding", async (context) => {
  const schema = {
    test: onchainTable("test", (p) => ({
      hex: p.hex().primaryKey(),
      bigint: p.bigint().notNull(),
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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  await database.transaction(async (client, tx) => {
    const indexingStore = createHistoricalIndexingStore({
      common: context.common,
      database,
      schemaBuild: { schema },
      indexingCache,
      db: tx,
      client,
    });

    await indexingStore.insert(schema.test).values({
      hex: zeroAddress,
      bigint: 10n,
      array: [1, 2, 4],
      json: { a: 1, b: 2 },
      null: null,
    });

    await indexingCache.flush({ client });

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

test.skip("flush() encoding escape", async (context) => {
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
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  await database.transaction(async (client, tx) => {
    const indexingStore = createHistoricalIndexingStore({
      common: context.common,
      database,
      schemaBuild: { schema },
      indexingCache,
      db: tx,
      client,
    });

    await indexingStore.insert(schema.test).values([
      // { backslash: "\\\\" },
      // { backslash: "\\\\b" },
      // { backslash: "\f" },
      // { backslash: "\n" },
      // { backslash: "\r" },
      // { backslash: "\t" },
      // { backslash: "\v" },
      // { backslash: "\0" },
      // { backslash: "\\x0" },
    ]);

    await indexingCache.flush({ client });

    indexingCache.clear();
    const result = await indexingStore.sql.select().from(schema.test);

    expect(result).toMatchInlineSnapshot();
  });
});
