import { setupCommon, setupIsolatedDatabase } from "@/_test/setup.js";
import { buildSchema } from "@/build/schema.js";
import { getReorgTable } from "@/drizzle/kit/index.js";
import { onchainEnum, onchainTable, primaryKey } from "@/drizzle/onchain.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { createShutdown } from "@/internal/shutdown.js";
import {
  type Checkpoint,
  MAX_CHECKPOINT_STRING,
  ZERO_CHECKPOINT,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { wait } from "@/utils/wait.js";
import { and, eq, sql } from "drizzle-orm";
import { index } from "drizzle-orm/pg-core";
import { zeroAddress } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import {
  type Database,
  TABLES,
  createDatabase,
  getPonderMetaTable,
} from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

const account = onchainTable("account", (p) => ({
  address: p.hex().primaryKey(),
  balance: p.bigint(),
}));

function createCheckpoint(checkpoint: Partial<Checkpoint>): string {
  return encodeCheckpoint({ ...ZERO_CHECKPOINT, ...checkpoint });
}

test("migrate() succeeds with empty schema", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.migrate({ buildId: "abc" });

  const tableNames = await getUserTableNames(database, "public");
  expect(tableNames).toContain("account");
  expect(tableNames).toContain("_reorg__account");
  expect(tableNames).toContain("_ponder_meta");

  const metadata = await database.qb.drizzle.select().from(sql`_ponder_meta`);

  expect(metadata).toHaveLength(1);

  await context.common.shutdown.kill();
});

test("migrate() with empty schema creates tables and enums", async (context) => {
  const mood = onchainEnum("mood", ["sad", "happy"]);

  const kyle = onchainTable("kyle", (p) => ({
    age: p.integer().primaryKey(),
    mood: mood().notNull(),
  }));

  const user = onchainTable(
    "table",
    (p) => ({
      name: p.text(),
      age: p.integer(),
      address: p.hex(),
    }),
    (table) => ({
      primaryKeys: primaryKey({ columns: [table.name, table.address] }),
    }),
  );

  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account, kyle, mood, user },
      statements: buildSchema({ schema: { account, kyle, mood, user } })
        .statements,
    },
  });

  await database.migrate({ buildId: "abc" });

  const tableNames = await getUserTableNames(database, "public");
  expect(tableNames).toContain("account");
  expect(tableNames).toContain("_reorg__account");
  expect(tableNames).toContain("kyle");
  expect(tableNames).toContain("_reorg__kyle");
  expect(tableNames).toContain("kyle");
  expect(tableNames).toContain("_reorg__kyle");
  expect(tableNames).toContain("_ponder_meta");

  await context.common.shutdown.kill();
});

test("migrate() throws with schema used", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });
  await database.migrate({ buildId: "abc" });
  await context.common.shutdown.kill();

  context.common.shutdown = createShutdown();

  const databaseTwo = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  const error = await databaseTwo
    .migrate({ buildId: "def" })
    .catch((err) => err);

  expect(error).toBeDefined();

  await context.common.shutdown.kill();
});

// PGlite not being able to concurrently connect to the same database from two different clients
// makes this test impossible.
test("migrate() throws with schema used after waiting for lock", async (context) => {
  if (context.databaseConfig.kind !== "postgres") return;

  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 1000;

  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });
  await database.migrate({ buildId: "abc" });

  const databaseTwo = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  const error = await databaseTwo
    .migrate({ buildId: "abc" })
    .catch((err) => err);

  expect(error).toBeDefined();

  await context.common.shutdown.kill();
});

test("migrate() succeeds with crash recovery", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.migrate({ buildId: "abc" });
  await context.common.shutdown.kill();

  context.common.shutdown = createShutdown();

  const databaseTwo = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await databaseTwo.migrate({ buildId: "abc" });

  const metadata = await databaseTwo.qb.drizzle
    .select()
    .from(getPonderMetaTable("public"));

  expect(metadata).toHaveLength(1);

  const tableNames = await getUserTableNames(databaseTwo, "public");
  expect(tableNames).toContain("account");
  expect(tableNames).toContain("_reorg__account");
  expect(tableNames).toContain("_ponder_meta");

  await context.common.shutdown.kill();
});

test("migrate() succeeds with crash recovery after waiting for lock", async (context) => {
  context.common.options.databaseHeartbeatInterval = 750;
  context.common.options.databaseHeartbeatTimeout = 500;

  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });
  await database.migrate({ buildId: "abc" });
  await database.finalize({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    db: database.qb.drizzle,
  });

  const databaseTwo = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await databaseTwo.migrate({ buildId: "abc" });

  await context.common.shutdown.kill();
});

test("migrateSync()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.migrateSync();

  // Note: this is a hack to avoid trying to update the metadata table on shutdown
  context.common.options.command = "list";

  await context.common.shutdown.kill();
});

// Note: this test doesn't do anything because we don't have a migration using the
// new design yet.
test.skip("migrateSync() handles concurrent migrations", async (context) => {
  if (context.databaseConfig.kind !== "postgres") return;

  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  // The second migration should error, then retry and succeed
  const spy = vi.spyOn(database.qb.sync, "transaction");

  await Promise.all([database.migrateSync(), database.migrateSync()]);

  // transaction gets called when perfoming a migration
  expect(spy).toHaveBeenCalledTimes(3);

  // Note: this is a hack to avoid trying to update the metadata table on shutdown
  context.common.options.command = "list";

  await context.common.shutdown.kill();
});

test("migrate() with crash recovery reverts rows", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.migrate({ buildId: "abc" });

  // setup tables, reorg tables, and metadata checkpoint

  await database.createTriggers();

  await database.setReady();

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { account } },
    database,
  });

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await database.commitBlock({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
    db: database.qb.drizzle,
  });

  await indexingStore
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await database.commitBlock({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
    db: database.qb.drizzle,
  });

  await database.setCheckpoints({
    checkpoints: [
      {
        chainId: 1,
        chainName: "mainnet",
        latestCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
        safeCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
      },
    ],
    db: database.qb.drizzle,
  });

  await context.common.shutdown.kill();

  context.common.shutdown = createShutdown();

  const databaseTwo = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  const checkpoint = await databaseTwo.migrate({ buildId: "abc" });

  expect(checkpoint).toMatchInlineSnapshot(`
    [
      {
        "chainId": 1,
        "checkpoint": "000000000000000000000000010000000000000010000000000000000000000000000000000",
      },
    ]
  `);

  const rows = await databaseTwo.qb.drizzle
    .execute(sql`SELECT * from "account"`)
    .then((result) => result.rows);

  expect(rows).toHaveLength(1);
  expect(rows[0]!.address).toBe(zeroAddress);

  const metadata = await databaseTwo.qb.drizzle
    .select()
    .from(getPonderMetaTable("public"));

  expect(metadata).toHaveLength(1);

  await context.common.shutdown.kill();
});

test("migrate() with crash recovery drops indexes and triggers", async (context) => {
  const account = onchainTable(
    "account",
    (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint(),
    }),
    (table) => ({
      balanceIdx: index().on(table.balance),
    }),
  );

  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.migrate({ buildId: "abc" });

  await database.createIndexes();

  await database.setCheckpoints({
    checkpoints: [
      {
        chainId: 1,
        chainName: "mainnet",
        latestCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
        safeCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
      },
    ],
    db: database.qb.drizzle,
  });

  await database.setReady();

  await context.common.shutdown.kill();

  context.common.shutdown = createShutdown();

  const databaseTwo = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await databaseTwo.migrate({ buildId: "abc" });

  const indexNames = await getUserIndexNames(databaseTwo, "public", "account");

  expect(indexNames).toHaveLength(1);

  await context.common.shutdown.kill();
});

test("heartbeat updates the heartbeat_at value", async (context) => {
  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 625;

  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.migrate({ buildId: "abc" });

  const row = await database.qb.drizzle
    .select()
    .from(getPonderMetaTable("public"))
    .then((result) => result[0]!.value);

  await wait(500);

  const rowAfterHeartbeat = await database.qb.drizzle
    .select()
    .from(getPonderMetaTable("public"))
    .then((result) => result[0]!.value);

  expect(BigInt(rowAfterHeartbeat!.heartbeat_at)).toBeGreaterThan(
    row!.heartbeat_at,
  );

  await context.common.shutdown.kill();
});

test("finalize()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.migrate({ buildId: "abc" });

  // setup tables, reorg tables, and metadata checkpoint

  await database.createTriggers();

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { account } },
    database,
  });

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await database.commitBlock({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
    db: database.qb.drizzle,
  });

  await indexingStore
    .update(account, { address: zeroAddress })
    .set({ balance: 88n });

  await indexingStore
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await database.commitBlock({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
    db: database.qb.drizzle,
  });

  await database.finalize({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    db: database.qb.drizzle,
  });

  // reorg tables

  const rows = await database.qb.drizzle.select().from(getReorgTable(account));

  expect(rows).toHaveLength(2);

  await context.common.shutdown.kill();
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

  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.migrate({ buildId: "abc" });
  await database.createIndexes();

  const indexNames = await getUserIndexNames(database, "public", "account");
  expect(indexNames).toContain("balance_index");

  await context.common.shutdown.kill();
});

test("createTriggers()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.migrate({ buildId: "abc" });
  await database.createTriggers();

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { account } },
    database,
  });

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  const { rows } = await database.qb.drizzle.execute(
    sql`SELECT * FROM _reorg__account`,
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

  await context.common.shutdown.kill();
});

test("createTriggers() duplicate", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.migrate({ buildId: "abc" });
  await database.createTriggers();
  await database.createTriggers();

  await context.common.shutdown.kill();
});

test("commitBlock()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.migrate({ buildId: "abc" });
  await database.createTriggers();

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { account } },
    database,
  });

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await database.commitBlock({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    db: database.qb.drizzle,
  });

  const { rows } = await database.qb.drizzle.execute(
    sql`SELECT * FROM _reorg__account`,
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

  await context.common.shutdown.kill();
});

test("revert()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.migrate({ buildId: "abc" });

  // setup tables, reorg tables, and metadata checkpoint

  await database.createTriggers();

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { account } },
    database,
  });

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await database.commitBlock({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
    db: database.qb.drizzle,
  });

  await indexingStore
    .update(account, { address: zeroAddress })
    .set({ balance: 88n });

  await indexingStore
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await database.commitBlock({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    db: database.qb.drizzle,
  });

  await indexingStore.delete(account, { address: zeroAddress });

  await database.commitBlock({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
    db: database.qb.drizzle,
  });

  await database.qb.drizzle.transaction(async (tx) => {
    await database.revert({
      checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
      tx,
    });
  });

  const rows = await database.qb.drizzle.select().from(account);

  expect(rows).toHaveLength(1);
  expect(rows[0]).toStrictEqual({ address: zeroAddress, balance: 10n });

  await context.common.shutdown.kill();
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

  const database = await createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { test },
      statements: buildSchema({ schema: { test } }).statements,
    },
  });

  await database.migrate({ buildId: "abc" });

  // setup tables, reorg tables, and metadata checkpoint

  await database.createTriggers();

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: { test } },
    database,
  });

  await indexingStore.insert(test).values({ a: 1, b: 1 });

  await database.commitBlock({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
    db: database.qb.drizzle,
  });

  await indexingStore.update(test, { a: 1, b: 1 }).set({ c: 1 });

  await database.commitBlock({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 12n }),
    db: database.qb.drizzle,
  });

  await database.qb.drizzle.transaction(async (tx) => {
    await database.revert({
      checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
      tx,
    });
  });

  const rows = await database.qb.drizzle.select().from(test);

  expect(rows).toHaveLength(1);
  expect(rows[0]).toStrictEqual({ a: 1, b: 1, c: null });

  await context.common.shutdown.kill();
});

async function getUserTableNames(database: Database, namespace: string) {
  const rows = await database.qb.drizzle
    .select({ name: TABLES.table_name })
    .from(TABLES)
    .where(
      and(
        eq(TABLES.table_schema, namespace),
        eq(TABLES.table_type, "BASE TABLE"),
      ),
    );

  return rows.map(({ name }) => name);
}

async function getUserIndexNames(
  database: Database,
  namespace: string,
  tableName: string,
) {
  const rows = await database.qb.drizzle
    .select({
      name: sql<string>`indexname`.as("name"),
    })
    .from(sql`pg_indexes`)
    .where(and(eq(sql`schemaname`, namespace), eq(sql`tablename`, tableName)));
  return rows.map((r) => r.name);
}
