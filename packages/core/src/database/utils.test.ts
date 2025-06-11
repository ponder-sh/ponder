import {
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { buildSchema } from "@/build/schema.js";
import { getReorgTable } from "@/drizzle/kit/index.js";
import { onchainTable, primaryKey } from "@/drizzle/onchain.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
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
import type { Database } from "./index.js";
import {
  commitBlock,
  createIndexes,
  createTrigger,
  finalize,
  revert,
} from "./utils.js";

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

test("finalize()", async (context) => {
  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  // setup tables, reorg tables, and metadata checkpoint

  await createTrigger(database.userQB, { table: account });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { account } },
  });
  indexingStore.qb = database.userQB;

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
    table: account,
  });

  await indexingStore
    .update(account, { address: zeroAddress })
    .set({ balance: 88n });

  await indexingStore
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
    table: account,
  });

  await finalize(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    table: account,
  });

  // reorg tables

  const rows = await database.userQB().select().from(getReorgTable(account));

  expect(rows).toHaveLength(2);
});

test("createIndexes()", async (context) => {
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

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  await createIndexes(database.userQB, {
    statements: buildSchema({ schema: { account } }).statements,
  });

  const indexNames = await getUserIndexNames(database, "public", "account");
  expect(indexNames).toContain("balance_index");
});

test("createTriggers()", async (context) => {
  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  await createTrigger(database.userQB, { table: account });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { account } },
  });
  indexingStore.qb = database.userQB;

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  const { rows } = await database
    .userQB()
    .execute(sql`SELECT * FROM _reorg__account`);

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

test("createTriggers() duplicate", async (context) => {
  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  await createTrigger(database.userQB, { table: account });
  await createTrigger(database.userQB, { table: account });
});

test("commitBlock()", async (context) => {
  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  await createTrigger(database.userQB, { table: account });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { account } },
  });
  indexingStore.qb = database.userQB;

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    table: account,
  });

  const { rows } = await database
    .userQB()
    .execute(sql`SELECT * FROM _reorg__account`);

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

test("revert()", async (context) => {
  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  // setup tables, reorg tables, and metadata checkpoint

  await createTrigger(database.userQB, { table: account });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { account } },
  });
  indexingStore.qb = database.userQB;

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
    table: account,
  });

  await indexingStore
    .update(account, { address: zeroAddress })
    .set({ balance: 88n });

  await indexingStore
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    table: account,
  });

  await indexingStore.delete(account, { address: zeroAddress });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
    table: account,
  });

  await database.userQB().transaction(async (tx) => {
    await revert(tx, {
      checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
      table: account,
    });
  });

  const rows = await database.userQB().select().from(account);

  expect(rows).toHaveLength(1);
  expect(rows[0]).toStrictEqual({ address: zeroAddress, balance: 10n });
});

test("revert() with composite primary key", async (context) => {
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

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { test } },
  });

  // setup tables, reorg tables, and metadata checkpoint

  await createTrigger(database.userQB, { table: test });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { test } },
  });
  indexingStore.qb = database.userQB;

  await indexingStore.insert(test).values({ a: 1, b: 1 });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
    table: test,
  });
  await indexingStore.update(test, { a: 1, b: 1 }).set({ c: 1 });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 12n }),
    table: test,
  });

  await database.userQB().transaction(async (tx) => {
    await revert(tx, {
      checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
      table: test,
    });
  });

  const rows = await database.userQB().select().from(test);

  expect(rows).toHaveLength(1);
  expect(rows[0]).toStrictEqual({ a: 1, b: 1, c: null });
});

async function getUserIndexNames(
  database: Database,
  namespace: string,
  tableName: string,
) {
  const rows = await database
    .userQB()
    .select({
      name: sql<string>`indexname`.as("name"),
    })
    .from(sql`pg_indexes`)
    .where(and(eq(sql`schemaname`, namespace), eq(sql`tablename`, tableName)));
  return rows.map((r) => r.name);
}
