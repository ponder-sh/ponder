import { setupCommon, setupIsolatedDatabase } from "@/_test/setup.js";
import { buildSchema } from "@/build/schema.js";
import {
  bigint,
  hex,
  onchainEnum,
  onchainTable,
  primaryKey,
} from "@/drizzle/onchain.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import {
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { wait } from "@/utils/wait.js";
import { sql } from "drizzle-orm";
import { index, pgSchema } from "drizzle-orm/pg-core";
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

function createCheckpoint(index: number): string {
  return encodeCheckpoint({ ...zeroCheckpoint, blockTimestamp: index });
}

// skip pglite because it doesn't support multiple connections
test("createDatabase() readonly", async (context) => {
  if (context.databaseConfig.kind === "pglite_test") return;
  const database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.prepareNamespace({ buildId: "abc" });

  const error = await database.qb.drizzleReadonly
    .insert(account)
    .values({
      address: zeroAddress,
      balance: 10n,
    })
    .catch((error) => error);

  expect(error).toBeDefined();
  expect(error?.message).toContain("permission denied for table");

  await database.kill();
});

test("createDatabase() search path", async (context) => {
  // create table in "ponder" schema

  const schemaAccount = pgSchema("ponder").table("account", {
    address: hex().primaryKey(),
    balance: bigint(),
  });

  const database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "ponder",
    },
    schemaBuild: {
      schema: { account: schemaAccount },
      statements: buildSchema({ schema: { account: schemaAccount } })
        .statements,
    },
  });
  await database.prepareNamespace({ buildId: "abc" });

  // using bare "account" will leave schema empty, and the search_path
  // will then use the "ponder" schema

  const rows = await database.qb.drizzleReadonly.select().from(account);

  expect(rows).toStrictEqual([]);

  await database.kill();
});

test("prepareNamespace() succeeds with empty schema", async (context) => {
  const database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  const { checkpoint } = await database.prepareNamespace({ buildId: "abc" });

  expect(checkpoint).toMatchObject(encodeCheckpoint(zeroCheckpoint));

  const tableNames = await getUserTableNames(database, "public");
  expect(tableNames).toContain("account");
  expect(tableNames).toContain("_reorg__account");
  expect(tableNames).toContain("_ponder_meta");

  const metadata = await database.qb.internal
    .selectFrom("_ponder_meta")
    .selectAll()
    .execute();

  expect(metadata).toHaveLength(2);

  await database.unlock();
  await database.kill();
});

test("prepareNamespace() throws with schema used", async (context) => {
  const database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });
  await database.prepareNamespace({ buildId: "abc" });
  await database.kill();

  const databaseTwo = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  const error = await databaseTwo
    .prepareNamespace({ buildId: "def" })
    .catch((err) => err);

  expect(error).toBeDefined();

  await databaseTwo.kill();
});

test("prepareNamespace() succeeds with crash recovery", async (context) => {
  const database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.prepareNamespace({ buildId: "abc" });

  await database.finalize({
    checkpoint: createCheckpoint(10),
  });

  await database.unlock();
  await database.kill();

  const databaseTwo = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  const { checkpoint } = await databaseTwo.prepareNamespace({ buildId: "abc" });

  expect(checkpoint).toMatchObject(createCheckpoint(10));

  const metadata = await databaseTwo.qb.internal
    .selectFrom("_ponder_meta")
    .selectAll()
    .execute();

  expect(metadata).toHaveLength(2);

  const tableNames = await getUserTableNames(databaseTwo, "public");
  expect(tableNames).toContain("account");
  expect(tableNames).toContain("_reorg__account");
  expect(tableNames).toContain("_ponder_meta");

  await databaseTwo.kill();
});

test("prepareNamespace() succeeds with crash recovery after waiting for lock", async (context) => {
  context.common.options.databaseHeartbeatInterval = 750;
  context.common.options.databaseHeartbeatTimeout = 500;

  const database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });
  await database.prepareNamespace({ buildId: "abc" });
  await database.finalize({ checkpoint: createCheckpoint(10) });

  const databaseTwo = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  const { checkpoint } = await databaseTwo.prepareNamespace({ buildId: "abc" });

  expect(checkpoint).toMatchObject(createCheckpoint(10));

  await database.unlock();
  await database.kill();
  await databaseTwo.kill();
});

// PGlite not being able to concurrently connect to the same database from two different clients
// makes this test impossible.
test("prepareNamespace() throws with schema used after waiting for lock", async (context) => {
  if (context.databaseConfig.kind !== "postgres") return;

  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 1000;

  const database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });
  await database.prepareNamespace({ buildId: "abc" });
  await database.finalize({ checkpoint: createCheckpoint(10) });

  const databaseTwo = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  const error = await databaseTwo
    .prepareNamespace({ buildId: "abc" })
    .catch((err) => err);

  expect(error).toBeDefined();

  await database.kill();
  await databaseTwo.kill();
});

test("prepareNamespace() with empty schema creates tables and enums", async (context) => {
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
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account, kyle, mood, user },
      statements: buildSchema({ schema: { account, kyle, mood, user } })
        .statements,
    },
  });

  await database.prepareNamespace({ buildId: "abc" });

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

test("prepareNamespace() with crash recovery reverts rows", async (context) => {
  const database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.prepareNamespace({ buildId: "abc" });

  // setup tables, reorg tables, and metadata checkpoint

  await database.createTriggers();

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    database,
    schema: { account },
  });

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await database.complete({
    checkpoint: createCheckpoint(9),
  });

  await indexingStore
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await database.complete({
    checkpoint: createCheckpoint(11),
  });

  await database.finalize({
    checkpoint: createCheckpoint(10),
  });

  await database.unlock();
  await database.kill();

  const databaseTwo = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  const { checkpoint } = await databaseTwo.prepareNamespace({ buildId: "abc" });

  expect(checkpoint).toMatchObject(createCheckpoint(10));

  const rows = await databaseTwo.qb.drizzle
    .execute(sql`SELECT * from "account"`)
    .then((result) => result.rows);

  expect(rows).toHaveLength(1);
  expect(rows[0]!.address).toBe(zeroAddress);

  const metadata = await databaseTwo.qb.internal
    .selectFrom("_ponder_meta")
    .selectAll()
    .execute();

  expect(metadata).toHaveLength(2);

  await databaseTwo.kill();
});

test("prepareNamespace() with crash recovery drops indexes and triggers", async (context) => {
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
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.prepareNamespace({ buildId: "abc" });

  await database.finalize({
    checkpoint: createCheckpoint(10),
  });

  await database.createIndexes();

  await database.unlock();
  await database.kill();

  const databaseTwo = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await databaseTwo.prepareNamespace({ buildId: "abc" });

  const indexNames = await getUserIndexNames(databaseTwo, "public", "account");

  expect(indexNames).toHaveLength(1);

  await databaseTwo.kill();
});

test("heartbeat updates the heartbeat_at value", async (context) => {
  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 625;

  const database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.prepareNamespace({ buildId: "abc" });

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
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.prepareNamespace({ buildId: "abc" });

  // setup tables, reorg tables, and metadata checkpoint

  await database.createTriggers();

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    database,
    schema: { account },
  });

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await database.complete({
    checkpoint: createCheckpoint(9),
  });

  await indexingStore
    .update(account, { address: zeroAddress })
    .set({ balance: 88n });

  await indexingStore
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await database.complete({
    checkpoint: createCheckpoint(11),
  });

  await database.finalize({
    checkpoint: createCheckpoint(10),
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
    .executeTakeFirst();

  // @ts-ignore
  expect(metadata?.value?.checkpoint).toBe(createCheckpoint(10));

  await database.kill();
});

test("unlock()", async (context) => {
  let database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.prepareNamespace({ buildId: "abc" });
  await database.unlock();
  await database.kill();

  database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
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
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.prepareNamespace({ buildId: "abc" });
  await database.createIndexes();

  const indexNames = await getUserIndexNames(database, "public", "account");
  expect(indexNames).toContain("balance_index");

  await database.unlock();
  await database.kill();
});

test("createTriggers()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.prepareNamespace({ buildId: "abc" });
  await database.createTriggers();

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    database,
    schema: { account },
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
      checkpoint: encodeCheckpoint(maxCheckpoint),
    },
  ]);

  await database.unlock();
  await database.kill();
});

test("complete()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.prepareNamespace({ buildId: "abc" });
  await database.createTriggers();

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    database,
    schema: { account },
  });

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await database.complete({
    checkpoint: createCheckpoint(10),
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
      checkpoint: createCheckpoint(10),
    },
  ]);

  await database.kill();
});

test("revert()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({ schema: { account } }).statements,
    },
  });

  await database.prepareNamespace({ buildId: "abc" });

  // setup tables, reorg tables, and metadata checkpoint

  await database.createTriggers();

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    database,
    schema: { account },
  });

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await database.complete({
    checkpoint: createCheckpoint(9),
  });

  await indexingStore
    .update(account, { address: zeroAddress })
    .set({ balance: 88n });

  await indexingStore
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await database.complete({
    checkpoint: createCheckpoint(11),
  });

  await database.revert({
    checkpoint: createCheckpoint(10),
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
