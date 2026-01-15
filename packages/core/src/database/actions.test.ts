import {
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { buildSchema } from "@/build/schema.js";
import { getReorgTable } from "@/drizzle/kit/index.js";
import { onchainTable, primaryKey } from "@/drizzle/onchain.js";
import type { IndexingErrorHandler } from "@/internal/types.js";
import {
  type Checkpoint,
  MAX_CHECKPOINT_STRING,
  ZERO_CHECKPOINT,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { and, eq, sql } from "drizzle-orm";
import { index } from "drizzle-orm/pg-core";
import { zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import {
  commitBlock,
  createIndexes,
  createTriggers,
  createViews,
  dropTriggers,
  finalizeMultichain,
  revertMultichain,
} from "./actions.js";
import { type Database, getPonderCheckpointTable } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

const account = onchainTable("account", (p) => ({
  address: p.hex().primaryKey(),
  balance: p.bigint(),
}));

function createCheckpoint(checkpoint: Partial<Checkpoint>): string {
  return encodeCheckpoint({ ...ZERO_CHECKPOINT, ...checkpoint });
}

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

test("finalize()", async () => {
  const { database } = await setupDatabaseServices({
    schemaBuild: { schema: { account } },
  });

  // setup tables, reorg tables, and metadata checkpoint
  await database.userQB.wrap((tx) =>
    tx.insert(getPonderCheckpointTable()).values({
      chainName: "mainnet",
      chainId: 1,
      safeCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 0n }),
      finalizedCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 0n }),
      latestCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 0n }),
    }),
  );

  await createTriggers(database.userQB, { tables: [account] });

  await database.userQB.raw
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
    table: account,
    preBuild: { ordering: "multichain" },
  });

  await database.userQB.raw
    .update(account)
    .set({ balance: 88n })
    .where(eq(account.address, zeroAddress));

  await database.userQB.raw
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
    table: account,
    preBuild: { ordering: "multichain" },
  });

  await finalizeMultichain(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    tables: [account],
    namespaceBuild: { schema: "public", viewsSchema: undefined },
  });

  // reorg tables

  const rows = await database.userQB.wrap((tx) =>
    tx.select().from(getReorgTable(account)),
  );

  expect(rows).toHaveLength(2);
});

test("createIndexes()", async () => {
  const account = onchainTable(
    "account",
    (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint(),
    }),
    (table) => ({
      balanceIdx: index("balance_index").on(table.balance),
    }),
  );

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema: { account } },
  });

  await createIndexes(database.userQB, {
    statements: buildSchema({
      schema: { account },
      preBuild: { ordering: "multichain" },
    }).statements,
  });

  const indexNames = await getUserIndexNames(database, "public", "account");
  expect(indexNames).toContain("balance_index");
});

test("createTriggers()", async () => {
  const { database } = await setupDatabaseServices({
    schemaBuild: { schema: { account } },
  });

  await createTriggers(database.userQB, { tables: [account] });

  await database.userQB.raw
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  const { rows } = await database.userQB.wrap((tx) =>
    tx.execute(sql`SELECT * FROM _reorg__account`),
  );

  expect(rows).toStrictEqual([
    {
      address: zeroAddress,
      balance: "10",
      operation: 0,
      operation_id: 1,
      checkpoint: MAX_CHECKPOINT_STRING,
    },
  ]);
});

test("createTriggers() duplicate", async () => {
  const { database } = await setupDatabaseServices({
    schemaBuild: { schema: { account } },
  });

  await createTriggers(database.userQB, { tables: [account] });
  await createTriggers(database.userQB, { tables: [account] });
});

test("commitBlock()", async () => {
  const { database } = await setupDatabaseServices({
    schemaBuild: { schema: { account } },
  });

  await createTriggers(database.userQB, { tables: [account] });

  await database.userQB.raw
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    table: account,
    preBuild: { ordering: "multichain" },
  });

  const { rows } = await database.userQB.wrap((tx) =>
    tx.execute(sql`SELECT * FROM _reorg__account`),
  );

  expect(rows).toStrictEqual([
    {
      address: zeroAddress,
      balance: "10",
      operation: 0,
      operation_id: 1,
      checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    },
  ]);
});

test("commitBlock() isolated", async () => {
  const account = onchainTable(
    "account",
    (p) => ({
      chainId: p.integer().notNull(),
      address: p.hex().notNull(),
      balance: p.bigint(),
    }),
    (table) => ({
      pk: primaryKey({ columns: [table.chainId, table.address] }),
    }),
  );

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema: { account } },
  });

  await createTriggers(database.userQB, { tables: [account] });

  await database.userQB.raw
    .insert(account)
    .values({ chainId: 1, address: zeroAddress, balance: 10n });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 2n, blockNumber: 10n }),
    table: account,
    preBuild: { ordering: "experimental_isolated" },
  });

  const { rows: rows1 } = await database.userQB.wrap((tx) =>
    tx.execute(sql`SELECT * FROM _reorg__account`),
  );

  expect(rows1).toMatchInlineSnapshot(`
    [
      {
        "address": "0x0000000000000000000000000000000000000000",
        "balance": "10",
        "chain_id": 1,
        "checkpoint": "999999999999999999999999999999999999999999999999999999999999999999999999999",
        "operation": 0,
        "operation_id": 1,
      },
    ]
  `);

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    table: account,
    preBuild: { ordering: "experimental_isolated" },
  });

  const { rows: rows2 } = await database.userQB.wrap((tx) =>
    tx.execute(sql`SELECT * FROM _reorg__account`),
  );

  expect(rows2).toMatchInlineSnapshot(`
    [
      {
        "address": "0x0000000000000000000000000000000000000000",
        "balance": "10",
        "chain_id": 1,
        "checkpoint": "000000000000000000000000010000000000000010000000000000000000000000000000000",
        "operation": 0,
        "operation_id": 1,
      },
    ]
  `);
});

test("revert()", async () => {
  const { database } = await setupDatabaseServices({
    schemaBuild: { schema: { account } },
  });

  // setup tables, reorg tables, and metadata checkpoint

  await createTriggers(database.userQB, { tables: [account] });

  await database.userQB.raw
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
    table: account,
    preBuild: { ordering: "multichain" },
  });

  await database.userQB.raw
    .update(account)
    .set({ balance: 88n })
    .where(eq(account.address, zeroAddress));

  await database.userQB.raw
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    table: account,
    preBuild: { ordering: "multichain" },
  });

  await database.userQB.raw
    .delete(account)
    .where(eq(account.address, zeroAddress));

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
    table: account,
    preBuild: { ordering: "multichain" },
  });

  await database.userQB.transaction(async (tx) => {
    await revertMultichain(tx, {
      checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
      tables: [account],
    });
  });

  const rows = await database.userQB.wrap((tx) => tx.select().from(account));

  expect(rows).toHaveLength(1);
  expect(rows[0]).toStrictEqual({ address: zeroAddress, balance: 10n });
});

test("revert() with composite primary key", async () => {
  const test = onchainTable(
    "Test",
    (p) => ({
      a: p.integer("A").notNull(),
      b: p.integer("B").notNull(),
      c: p.integer("C"),
    }),
    (table) => ({
      pk: primaryKey({ columns: [table.a, table.b] }),
    }),
  );

  const { database } = await setupDatabaseServices({
    schemaBuild: { schema: { test } },
  });

  // setup tables, reorg tables, and metadata checkpoint

  await createTriggers(database.userQB, { tables: [test] });

  await database.userQB.raw.insert(test).values({ a: 1, b: 1 });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
    table: test,
    preBuild: { ordering: "multichain" },
  });
  await database.userQB.raw
    .update(test)
    .set({ c: 1 })
    .where(and(eq(test.a, 1), eq(test.b, 1)));

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 12n }),
    table: test,
    preBuild: { ordering: "multichain" },
  });

  await database.userQB.transaction(async (tx) => {
    await revertMultichain(tx, {
      checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
      tables: [test],
    });
  });

  const rows = await database.userQB.wrap((tx) => tx.select().from(test));

  expect(rows).toHaveLength(1);
  expect(rows[0]).toStrictEqual({ a: 1, b: 1, c: null });
});

test("empty schema", async () => {
  const { database } = await setupDatabaseServices({
    schemaBuild: { schema: {} },
  });
  await createTriggers(database.userQB, { tables: [] });
  await dropTriggers(database.userQB, { tables: [] });
  await createViews(database.userQB, {
    tables: [],
    views: [],
    namespaceBuild: { schema: "public", viewsSchema: undefined },
  });
  await revertMultichain(database.userQB, {
    tables: [],
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
  });
  await finalizeMultichain(database.userQB, {
    tables: [],
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),

    namespaceBuild: { schema: "public", viewsSchema: undefined },
  });
});

async function getUserIndexNames(
  database: Database,
  namespace: string,
  tableName: string,
) {
  const rows = await database.userQB.wrap((tx) =>
    tx
      .select({ name: sql<string>`indexname`.as("name") })
      .from(sql`pg_indexes`)
      .where(
        and(eq(sql`schemaname`, namespace), eq(sql`tablename`, tableName)),
      ),
  );
  return rows.map((r) => r.name);
}
