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
import type { RetryableError } from "@/internal/errors.js";
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
  finalize,
  revert,
} from "./actions.js";
import type { Database } from "./index.js";

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

test("finalize()", async (context) => {
  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  // setup tables, reorg tables, and metadata checkpoint

  await createTriggers(database.userQB, { tables: [account] });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { account } },
    indexingErrorHandler,
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
    tables: [account],
  });

  // reorg tables

  const rows = await database.userQB.wrap((tx) =>
    tx.select().from(getReorgTable(account)),
  );

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

  await createTriggers(database.userQB, { tables: [account] });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { account } },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore
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

test("createTriggers() duplicate", async (context) => {
  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  await createTriggers(database.userQB, { tables: [account] });
  await createTriggers(database.userQB, { tables: [account] });
});

test("commitBlock()", async (context) => {
  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  await createTriggers(database.userQB, { tables: [account] });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { account } },
    indexingErrorHandler,
  });
  indexingStore.qb = database.userQB;

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    table: account,
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

test("revert()", async (context) => {
  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  // setup tables, reorg tables, and metadata checkpoint

  await createTriggers(database.userQB, { tables: [account] });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { account } },
    indexingErrorHandler,
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

  await database.userQB.transaction(async (tx) => {
    await revert(tx, {
      checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
      tables: [account],
      ordering: "multichain",
    });
  });

  const rows = await database.userQB.wrap((tx) => tx.select().from(account));

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

  await createTriggers(database.userQB, { tables: [test] });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { test } },
    indexingErrorHandler,
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

  await database.userQB.transaction(async (tx) => {
    await revert(tx, {
      checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
      tables: [test],
      ordering: "multichain",
    });
  });

  const rows = await database.userQB.wrap((tx) => tx.select().from(test));

  expect(rows).toHaveLength(1);
  expect(rows[0]).toStrictEqual({ a: 1, b: 1, c: null });
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
