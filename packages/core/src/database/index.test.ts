import { setupCommon, setupIsolatedDatabase } from "@/_test/setup.js";
import { buildSchema } from "@/build/schema.js";
import { onchainEnum, onchainTable, primaryKey } from "@/drizzle/onchain.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { createShutdown } from "@/internal/shutdown.js";
import {
  type Checkpoint,
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
  getPonderCheckpointTable,
  getPonderMetaTable,
} from "./index.js";
import {
  commitBlock,
  createIndexes,
  createTrigger,
  finalize,
} from "./utils.js";

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

  const metadata = await database.userQB.select().from(sql`_ponder_meta`);

  expect(metadata).toHaveLength(1);

  // TODO(kyle) how to shutdown
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

  const metadata = await databaseTwo.userQB
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

  await finalize(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    table: account,
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
  const spy = vi.spyOn(database.userQB, "transaction");

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

  await createTrigger(database.userQB, { table: account });

  await database.userQB
    .update(getPonderMetaTable())
    .set({ value: sql`jsonb_set(value, '{is_ready}', to_jsonb(1))` });

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
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
    table: account,
  });

  await database.userQB.insert(getPonderCheckpointTable()).values({
    chainId: 1,
    chainName: "mainnet",
    latestCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    safeCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
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

  const rows = await databaseTwo.userQB
    .execute(sql`SELECT * from "account"`)
    .then((result) => result.rows);

  expect(rows).toHaveLength(1);
  expect(rows[0]!.address).toBe(zeroAddress);

  const metadata = await databaseTwo.userQB
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

  await createIndexes(database.userQB, {
    statements: buildSchema({ schema: { account } }).statements,
  });

  await database.userQB.insert(getPonderCheckpointTable()).values({
    chainId: 1,
    chainName: "mainnet",
    latestCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    safeCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
  });

  await database.userQB
    .update(getPonderMetaTable())
    .set({ value: sql`jsonb_set(value, '{is_ready}', to_jsonb(1))` });

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

  const row = await database.userQB
    .select()
    .from(getPonderMetaTable("public"))
    .then((result) => result[0]!.value);

  await wait(500);

  const rowAfterHeartbeat = await database.userQB
    .select()
    .from(getPonderMetaTable("public"))
    .then((result) => result[0]!.value);

  expect(BigInt(rowAfterHeartbeat!.heartbeat_at)).toBeGreaterThan(
    row!.heartbeat_at,
  );

  await context.common.shutdown.kill();
});

async function getUserTableNames(database: Database, namespace: string) {
  const rows = await database.userQB
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
  const rows = await database.userQB
    .select({
      name: sql<string>`indexname`.as("name"),
    })
    .from(sql`pg_indexes`)
    .where(and(eq(sql`schemaname`, namespace), eq(sql`tablename`, tableName)));
  return rows.map((r) => r.name);
}
