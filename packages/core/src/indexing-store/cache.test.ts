import { parseEther, zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import { ALICE, BOB } from "@/_test/constants.js";
import {
  context,
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
import { createIndexingCache, getCopyText } from "./cache.js";
import { createIndexingStore } from "./index.js";

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

test("flush() insert", async () => {
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

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      balance: 10n,
    });

    await indexingCache.flush();

    const result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 10n,
    });
  });
});

test("flush() update", async () => {
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

    // mutate the cache to skip hot loops

    indexingCache.invalidate();

    await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      balance: 10n,
    });

    // first flush takes "insert" path
    await indexingCache.flush();

    await indexingStore.db
      .update(schema.account, { address: zeroAddress })
      .set({
        balance: 12n,
      });

    // second flush takes "update" path
    await indexingCache.flush();

    let result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 12n,
    });

    // flush again to make sure temp tables are cleaned up

    await indexingStore.db
      .update(schema.account, { address: zeroAddress })
      .set({
        balance: 12n,
      });

    await indexingCache.flush();

    result = await indexingStore.db.find(schema.account, {
      address: zeroAddress,
    });

    expect(result).toMatchObject({
      address: "0x0000000000000000000000000000000000000000",
      balance: 12n,
    });
  });
});

test("flush() recovers error", async () => {
  if (context.databaseConfig.kind !== "postgres") {
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

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      balance: 10n,
    });

    await indexingCache.flush();

    await indexingStore.db.insert(schema.account).values({
      address: zeroAddress,
      balance: 10n,
    });

    await expect(indexingCache.flush()).rejects.toThrowError(
      `duplicate key value violates unique constraint "account_pkey"`,
    );
  });
});

test("flush() encoding", async () => {
  const e = onchainEnum("e", ["a", "b", "c"]);
  const schema = {
    e,
    test: onchainTable("test", (p) => ({
      hex: p.hex().primaryKey(),
      bigint: p.bigint().notNull(),
      e: e().notNull(),
      array: p.integer().array().notNull(),
      bytes: p.bytes().notNull(),
      json: p.json().notNull(),
      null: p.text(),
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

    const values = [
      {
        hex: zeroAddress,
        bigint: 10n,
        e: "a" as const,
        array: [1, 2, 4],
        bytes: new Uint8Array([0, 128, 255, 1]),
        json: { a: 1, b: 2 },
        null: null,
      },
      {
        hex: "0x0000000000000000000000000000000000000001" as const,
        bigint: 11n,
        e: "b" as const,
        array: [],
        bytes: new Uint8Array([]),
        json: {},
        null: null,
      },
      {
        hex: "0x0000000000000000000000000000000000000002" as const,
        bigint: 12n,
        e: "c" as const,
        array: [0],
        bytes: new Uint8Array([0x5c, 0x4e, 0x09, 0x0a, 0x0d]),
        json: { c: 3 },
        null: null,
      },
    ];

    await indexingStore.db.insert(schema.test).values(values);

    await indexingCache.flush();

    indexingCache.clear();
    const result = (await indexingStore.db.sql.select().from(schema.test)).sort(
      (a, b) => a.hex.localeCompare(b.hex),
    );

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "array": [
            1,
            2,
            4,
          ],
          "bigint": 10n,
          "bytes": Uint8Array [
            0,
            128,
            255,
            1,
          ],
          "e": "a",
          "hex": "0x0000000000000000000000000000000000000000",
          "json": {
            "a": 1,
            "b": 2,
          },
          "null": null,
        },
        {
          "array": [],
          "bigint": 11n,
          "bytes": Uint8Array [],
          "e": "b",
          "hex": "0x0000000000000000000000000000000000000001",
          "json": {},
          "null": null,
        },
        {
          "array": [
            0,
          ],
          "bigint": 12n,
          "bytes": Uint8Array [
            92,
            78,
            9,
            10,
            13,
          ],
          "e": "c",
          "hex": "0x0000000000000000000000000000000000000002",
          "json": {
            "c": 3,
          },
          "null": null,
        },
      ]
    `);
  });
});

test("flush() encoding escape", async () => {
  const schema = {
    test: onchainTable("test", (p) => ({
      backslash: p.text().primaryKey(),
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

    await indexingStore.db.insert(schema.test).values(values);

    await indexingCache.flush();

    indexingCache.clear();
    const result = await indexingStore.db.sql.select().from(schema.test);

    expect(result).toStrictEqual(values);
  });
});

test("getCopyText() encodes bytes", () => {
  const schema = {
    test: onchainTable("test", (p) => ({
      bytes: p.bytes().primaryKey(),
    })),
  };

  expect(
    getCopyText(schema.test, [
      { bytes: new Uint8Array([0, 128, 255, 1]) },
      { bytes: new Uint8Array([]) },
      { bytes: new Uint8Array([0x5c, 0x4e, 0x09, 0x0a, 0x0d]) },
    ]),
  ).toBe("\\\\x0080ff01\n\\\\x\n\\\\x5c4e090a0d");

  const multiColumnSchema = {
    test: onchainTable("test", (p) => ({
      bytes: p.bytes().primaryKey(),
      text: p.text().notNull(),
    })),
  };

  expect(
    getCopyText(multiColumnSchema.test, [
      { bytes: new Uint8Array([0x5c, 0x4e, 0x09, 0x0a, 0x0d]), text: "ok" },
    ]),
  ).toBe("\\\\x5c4e090a0d\tok");
});

test("prefetch() uses profile metadata", async () => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices({
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

  const indexingStore = createIndexingStore({
    common: context.common,
    schemaBuild: { schema },
    indexingCache,
    indexingErrorHandler,
  });

  indexingCache.event = event;

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db
      .insert(schema.account)
      .values({
        address: ALICE,
        balance: parseEther("1"),
      })
      .onConflictDoNothing();

    // @ts-expect-error
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

test("prefetch() evicts rows", async () => {
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

  // skip hot loop
  indexingCache.invalidate();

  await database.userQB.transaction(async (tx) => {
    indexingCache.qb = tx;
    indexingStore.qb = tx;

    await indexingStore.db.insert(schema.account).values({
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
