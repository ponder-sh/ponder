import { setupCommon, setupIsolatedDatabase } from "@/_test/setup.js";
import { buildSchema } from "@/build/schema.js";
import { onchainEnum, onchainTable, primaryKey } from "@/drizzle/onchain.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import {
  type Checkpoint,
  MAX_CHECKPOINT_STRING,
  ZERO_CHECKPOINT,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { wait } from "@/utils/wait.js";
import { sql } from "drizzle-orm";
import { index } from "drizzle-orm/pg-core";
import { sql as ksql } from "kysely";
import { zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import { type Database, type PonderApp, createDatabase } from "./index.js";

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
    namespace: "public",
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

  const metadata = await database.qb.internal
    .selectFrom("_ponder_meta")
    .selectAll()
    .execute();

  expect(metadata).toHaveLength(1);

  await database.unlock();
  await database.kill();
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
    namespace: "public",
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

  await database.unlock();
  await database.kill();
});

test("migrate() throws with schema used", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: "public",
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });
  await database.migrate({ buildId: "abc" });
  await database.kill();

  const databaseTwo = await createDatabase({
    common: context.common,
    namespace: "public",
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

  await databaseTwo.kill();
});

// PGlite not being able to concurrently connect to the same database from two different clients
// makes this test impossible.
test("migrate() throws with schema used after waiting for lock", async (context) => {
  if (context.databaseConfig.kind !== "postgres") return;

  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 1000;

  const database = await createDatabase({
    common: context.common,
    namespace: "public",
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
  });

  const databaseTwo = await createDatabase({
    common: context.common,
    namespace: "public",
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

  await database.kill();
  await databaseTwo.kill();
});

test("migrate() succeeds with crash recovery", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: "public",
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
  });

  await database.unlock();
  await database.kill();

  const databaseTwo = await createDatabase({
    common: context.common,
    namespace: "public",
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await databaseTwo.migrate({ buildId: "abc" });

  const metadata = await databaseTwo.qb.internal
    .selectFrom("_ponder_meta")
    .selectAll()
    .execute();

  expect(metadata).toHaveLength(1);

  const tableNames = await getUserTableNames(databaseTwo, "public");
  expect(tableNames).toContain("account");
  expect(tableNames).toContain("_reorg__account");
  expect(tableNames).toContain("_ponder_meta");

  await databaseTwo.kill();
});

test("migrate() succeeds with crash recovery after waiting for lock", async (context) => {
  context.common.options.databaseHeartbeatInterval = 750;
  context.common.options.databaseHeartbeatTimeout = 500;

  const database = await createDatabase({
    common: context.common,
    namespace: "public",
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
  });

  const databaseTwo = await createDatabase({
    common: context.common,
    namespace: "public",
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await databaseTwo.migrate({ buildId: "abc" });

  await database.unlock();
  await database.kill();
  await databaseTwo.kill();
});

test("recoverCheckpoint() with crash recovery reverts rows", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: "public",
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

  await database.complete({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
  });

  await indexingStore
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await database.complete({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
  });

  await database.finalize({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
  });

  await database.unlock();
  await database.kill();

  const databaseTwo = await createDatabase({
    common: context.common,
    namespace: "public",
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await databaseTwo.migrate({ buildId: "abc" });
  const checkpoints = await databaseTwo.recoverCheckpoint();

  expect(checkpoints).toStrictEqual([
    {
      chainId: 1,
      checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    },
  ]);

  const rows = await databaseTwo.qb.drizzle
    .execute(sql`SELECT * from "account"`)
    .then((result) => result.rows);

  expect(rows).toHaveLength(1);
  expect(rows[0]!.address).toBe(zeroAddress);

  const metadata = await databaseTwo.qb.internal
    .selectFrom("_ponder_meta")
    .selectAll()
    .execute();

  expect(metadata).toHaveLength(1);

  await databaseTwo.kill();
});

test("recoverCheckpoint() with crash recovery drops indexes and triggers", async (context) => {
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
    namespace: "public",
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
  });

  await database.createIndexes();

  await database.unlock();
  await database.kill();

  const databaseTwo = await createDatabase({
    common: context.common,
    namespace: "public",
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await databaseTwo.migrate({ buildId: "abc" });
  await databaseTwo.recoverCheckpoint();

  const indexNames = await getUserIndexNames(databaseTwo, "public", "account");

  expect(indexNames).toHaveLength(1);

  await databaseTwo.kill();
});

test("heartbeat updates the heartbeat_at value", async (context) => {
  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 625;

  const database = await createDatabase({
    common: context.common,
    namespace: "public",
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.migrate({ buildId: "abc" });

  const row = await database.qb.internal
    .selectFrom("_ponder_meta")
    .where("key", "=", "app")
    .select("value")
    .executeTakeFirst();

  await wait(500);

  const rowAfterHeartbeat = await database.qb.internal
    .selectFrom("_ponder_meta")
    .where("key", "=", "app")
    .select("value")
    .executeTakeFirst();

  expect(
    // @ts-ignore
    BigInt(rowAfterHeartbeat!.value!.heartbeat_at as number),
    // @ts-ignore
  ).toBeGreaterThan(row!.value!.heartbeat_at as number);

  await database.unlock();
  await database.kill();
});

test("finalize()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: "public",
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

  await database.complete({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
  });

  await indexingStore
    .update(account, { address: zeroAddress })
    .set({ balance: 88n });

  await indexingStore
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await database.complete({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
  });

  await database.finalize({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
  });

  // reorg tables

  const rows = await database.qb.user
    .selectFrom("_reorg__account")
    .selectAll()
    .execute();

  expect(rows).toHaveLength(2);

  // metadata

  const metadata = await database.qb.internal
    .selectFrom("_ponder_meta")
    .where("key", "=", "app")
    .select("value")
    .executeTakeFirstOrThrow()
    .then(({ value }) => value);

  expect(metadata.checkpoint).toStrictEqual(
    createCheckpoint({ chainId: 1n, blockNumber: 10n }),
  );

  await database.kill();
});

test("unlock()", async (context) => {
  let database = await createDatabase({
    common: context.common,
    namespace: "public",
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.migrate({ buildId: "abc" });
  await database.unlock();
  await database.kill();

  database = await createDatabase({
    common: context.common,
    namespace: "public",
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  const metadata = await database.qb.internal
    .selectFrom("_ponder_meta")
    .selectAll()
    .where("key", "=", "app")
    .execute();

  expect((metadata[0]!.value as PonderApp).is_locked).toBe(0);

  await database.unlock();
  await database.kill();
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
    namespace: "public",
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

  await database.unlock();
  await database.kill();
});

test("createTriggers()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: "public",
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

  const rows = await database.qb.user
    .selectFrom("_reorg__account")
    .selectAll()
    .execute();

  expect(rows).toStrictEqual([
    {
      address: zeroAddress,
      balance: "10",
      operation: 0,
      operation_id: 1,
      checkpoint: MAX_CHECKPOINT_STRING,
    },
  ]);

  await database.unlock();
  await database.kill();
});

test("createTriggers() duplicate", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: "public",
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

  await database.unlock();
  await database.kill();
});

test("complete()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: "public",
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

  await database.complete({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
  });

  const rows = await database.qb.user
    .selectFrom("_reorg__account")
    .selectAll()
    .execute();

  expect(rows).toStrictEqual([
    {
      address: zeroAddress,
      balance: "10",
      operation: 0,
      operation_id: 1,
      checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    },
  ]);

  await database.kill();
});

test("revert()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    namespace: "public",
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

  await database.complete({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
  });

  await indexingStore
    .update(account, { address: zeroAddress })
    .set({ balance: 88n });

  await indexingStore
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await database.complete({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
  });

  await database.revert({
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
  });

  const rows = await database.qb.user
    .selectFrom("account")
    .selectAll()
    .execute();

  expect(rows).toHaveLength(1);
  expect(rows[0]).toStrictEqual({ address: zeroAddress, balance: "10" });

  await database.kill();
});

async function getUserTableNames(database: Database, namespace: string) {
  const { rows } = await database.qb.internal.executeQuery<{ name: string }>(
    ksql`
      SELECT table_name as name
      FROM information_schema.tables
      WHERE table_schema = '${ksql.raw(namespace)}'
      AND table_type = 'BASE TABLE'
    `.compile(database.qb.internal),
  );
  return rows.map(({ name }) => name);
}

async function getUserIndexNames(
  database: Database,
  namespace: string,
  tableName: string,
) {
  const { rows } = await database.qb.internal.executeQuery<{
    name: string;
    tbl_name: string;
  }>(
    ksql`
      SELECT indexname as name
      FROM pg_indexes
      WHERE schemaname = '${ksql.raw(namespace)}'
      AND tablename = '${ksql.raw(tableName)}'
    `.compile(database.qb.internal),
  );
  return rows.map((r) => r.name);
}
