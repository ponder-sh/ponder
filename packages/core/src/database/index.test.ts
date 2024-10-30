import { setupCommon, setupIsolatedDatabase } from "@/_test/setup.js";
import { onchainEnum, onchainTable, primaryKey } from "@/drizzle/index.js";
import { createIndexingStore } from "@/indexing-store/index.js";
import {
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
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

function createCheckpoint(index: number): string {
  return encodeCheckpoint({ ...zeroCheckpoint, blockTimestamp: index });
}

test("setup() succeeds with a fresh database", async (context) => {
  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  const { checkpoint } = await database.setup();

  expect(checkpoint).toMatchObject(encodeCheckpoint(zeroCheckpoint));

  const tableNames = await getUserTableNames(database);
  expect(tableNames).toContain("1234__account");
  expect(tableNames).toContain("1234_reorg__account");
  expect(tableNames).toContain("_ponder_meta");

  const metadata = await database.qb.internal
    .selectFrom("_ponder_meta")
    .selectAll()
    .execute();

  expect(metadata).toHaveLength(3);

  await database.kill();
});

test("setup() create tables", async (context) => {
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
    schema: { account, kyle, mood, user },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  await database.setup();

  const tableNames = await getUserTableNames(database);
  expect(tableNames).toContain("1234__account");
  expect(tableNames).toContain("1234_reorg__account");
  expect(tableNames).toContain("1234__kyle");
  expect(tableNames).toContain("1234_reorg__kyle");
  expect(tableNames).toContain("1234__kyle");
  expect(tableNames).toContain("1234_reorg__kyle");
  expect(tableNames).toContain("_ponder_meta");

  await database.kill();
});

test("setup() succeeds with a prior app in the same namespace", async (context) => {
  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });
  await database.setup();

  let tableNames = await getUserTableNames(database);
  expect(tableNames).toContain("1234__account");
  expect(tableNames).toContain("1234_reorg__account");
  expect(tableNames).toContain("_ponder_meta");

  await database.kill();

  const databaseTwo = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "5678",
    buildId: "def",
  });

  await databaseTwo.setup();

  tableNames = await getUserTableNames(databaseTwo);

  expect(tableNames).toContain("1234__account");
  expect(tableNames).toContain("1234_reorg__account");
  expect(tableNames).toContain("5678__account");
  expect(tableNames).toContain("5678_reorg__account");
  expect(tableNames).toContain("_ponder_meta");

  const metadata = await databaseTwo.qb.internal
    .selectFrom("_ponder_meta")
    .selectAll()
    .execute();

  expect(metadata).toHaveLength(5);

  await databaseTwo.kill();
});

test("setup() with the same build ID recovers the finality checkpoint", async (context) => {
  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  await database.setup();

  await database.finalize({
    checkpoint: createCheckpoint(10),
  });

  await database.kill();

  const databaseTwo = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "5678",
    buildId: "abc",
  });

  const { checkpoint } = await databaseTwo.setup();

  expect(checkpoint).toMatchObject(createCheckpoint(10));

  const metadata = await databaseTwo.qb.internal
    .selectFrom("_ponder_meta")
    .selectAll()
    .execute();

  expect(metadata).toHaveLength(3);

  const tableNames = await getUserTableNames(databaseTwo);
  expect(tableNames).toContain("5678__account");
  expect(tableNames).toContain("5678_reorg__account");
  expect(tableNames).toContain("_ponder_meta");

  await databaseTwo.kill();
});

test("setup() with the same build ID reverts rows", async (context) => {
  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  await database.setup();

  // setup tables, reorg tables, and metadata checkpoint

  await database.createTriggers();

  const indexingStore = createIndexingStore({
    common: context.common,
    database,
    schema: { account },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await indexingStore.flush();
  await database.complete({
    checkpoint: createCheckpoint(9),
  });

  await indexingStore
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await indexingStore.flush();
  await database.complete({
    checkpoint: createCheckpoint(11),
  });

  await database.finalize({
    checkpoint: createCheckpoint(10),
  });

  await database.kill();

  const databaseTwo = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "5678",
    buildId: "abc",
  });

  const { checkpoint } = await databaseTwo.setup();

  expect(checkpoint).toMatchObject(createCheckpoint(10));

  const rows = await databaseTwo.drizzle
    .execute(sql`SELECT * from "5678__account"`)
    .then((result) => result.rows);

  expect(rows).toHaveLength(1);
  expect(rows[0]!.address).toBe(zeroAddress);

  const metadata = await databaseTwo.qb.internal
    .selectFrom("_ponder_meta")
    .selectAll()
    .execute();

  expect(metadata).toHaveLength(3);

  await databaseTwo.kill();
});

test.todo("setup() with the same build ID drops indexes and triggers");

test("setup() with the same build ID recovers if the lock expires after waiting", async (context) => {
  context.common.options.databaseHeartbeatInterval = 750;
  context.common.options.databaseHeartbeatTimeout = 500;

  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });
  await database.setup();
  await database.finalize({ checkpoint: createCheckpoint(10) });

  const databaseTwo = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "5678",
    buildId: "abc",
  });

  const { checkpoint } = await databaseTwo.setup();

  expect(checkpoint).toMatchObject(createCheckpoint(10));

  await database.kill();
  await databaseTwo.kill();
});

test("setup() with the same build ID succeeds if the lock doesn't expires after waiting", async (context) => {
  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 625;

  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });
  await database.setup();
  await database.finalize({ checkpoint: createCheckpoint(10) });

  const databaseTwo = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "5678",
    buildId: "abc",
  });

  const { checkpoint } = await databaseTwo.setup();

  expect(checkpoint).toMatchObject(encodeCheckpoint(zeroCheckpoint));

  await database.kill();
  await databaseTwo.kill();
});

test("setup() drops old tables", async (context) => {
  for (let i = 0; i < 5; i++) {
    const database = await createDatabase({
      common: context.common,
      schema: { account },
      databaseConfig: context.databaseConfig,
      instanceId: `123${i}`,
      buildId: `${i}`,
    });
    await database.setup();
    await database.kill();
  }

  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1239",
    buildId: "abc",
  });
  await database.setup();

  const tableNames = await getUserTableNames(database);
  expect(tableNames).toHaveLength(7);
  await database.kill();
});

test('setup() with "ponder dev" publishes views', async (context) => {
  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  context.common.options.command = "dev";

  await database.setup();

  const viewNames = await getUserViewNames(database);
  expect(viewNames).toContain("account");

  await database.kill();
});

test.todo(
  "setup() throws if there is a table name collision",
  async (context) => {
    const database = await createDatabase({
      common: context.common,
      schema: { account },
      databaseConfig: context.databaseConfig,
      instanceId: "1234",
      buildId: "abc",
    });

    await database.qb.internal.executeQuery(
      ksql`CREATE TABLE "account" (id TEXT)`.compile(database.qb.internal),
    );

    expect(await getUserTableNames(database)).toStrictEqual(["account"]);

    await expect(() => database.setup()).rejects.toThrow(
      "Unable to create table 'public'.'account' because a table with that name already exists. Is there another application using the 'public' database schema?",
    );

    await database.kill();
  },
);

test("setup() v0.7 migration", async (context) => {
  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  await database.qb.internal.schema
    .createTable("account")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .execute();

  await database.qb.internal.schema
    .createTable("_ponder_reorg__account")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .execute();

  await database.qb.internal.schema
    .createTable("_ponder_meta")
    .addColumn("key", "text", (col) => col.primaryKey())
    .addColumn("value", "jsonb")
    .execute();

  await database.qb.internal
    .insertInto("_ponder_meta")
    .values({
      // @ts-ignore
      key: "app",
      value: {
        is_locked: 0,
        is_dev: 0,
        heartbeat_at: 0,
        build_id: "build",
        checkpoint: encodeCheckpoint(zeroCheckpoint),
        table_names: ["account"],
      },
    })
    .execute();

  const { checkpoint } = await database.setup();

  expect(checkpoint).toMatchObject(encodeCheckpoint(zeroCheckpoint));

  const tableNames = await getUserTableNames(database);
  expect(tableNames).toContain("1234__account");
  expect(tableNames).toContain("1234_reorg__account");
  expect(tableNames).not.toContain("account");
  expect(tableNames).not.toContain("_ponder_reorg__account");
  expect(tableNames).toContain("_ponder_meta");

  const metadata = await database.qb.internal
    .selectFrom("_ponder_meta")
    .selectAll()
    .execute();

  expect(metadata).toHaveLength(3);

  await database.kill();
});

test("heartbeat updates the heartbeat_at value", async (context) => {
  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 625;

  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  await database.setup();

  const row = await database.qb.internal
    .selectFrom("_ponder_meta")
    .where("key", "like", "app_%")
    .select("value")
    .executeTakeFirst();

  await wait(500);

  const rowAfterHeartbeat = await database.qb.internal
    .selectFrom("_ponder_meta")
    .where("key", "like", "app_%")
    .select("value")
    .executeTakeFirst();

  expect(
    // @ts-ignore
    BigInt(rowAfterHeartbeat!.value!.heartbeat_at as number),
    // @ts-ignore
  ).toBeGreaterThan(row!.value!.heartbeat_at as number);

  await database.kill();
});

test("finalize()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  await database.setup();

  // setup tables, reorg tables, and metadata checkpoint

  await database.createTriggers();

  const indexingStore = createIndexingStore({
    common: context.common,
    database,
    schema: { account },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await indexingStore.flush();
  await database.complete({
    checkpoint: createCheckpoint(9),
  });

  await indexingStore
    .update(account, { address: zeroAddress })
    .set({ balance: 88n });

  await indexingStore
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await indexingStore.flush();
  await database.complete({
    checkpoint: createCheckpoint(11),
  });

  await database.finalize({
    checkpoint: createCheckpoint(10),
  });

  // reorg tables

  const rows = await database.qb.user
    .selectFrom("1234_reorg__account")
    .selectAll()
    .execute();

  expect(rows).toHaveLength(2);

  // metadata

  const metadata = await database.qb.internal
    .selectFrom("_ponder_meta")
    .where("key", "like", "app_%")
    .select("value")
    .executeTakeFirst();

  // @ts-ignore
  expect(metadata?.value?.checkpoint).toBe(createCheckpoint(10));

  await database.kill();
});

test("kill()", async (context) => {
  let database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  await database.setup();
  await database.kill();

  database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  const metadata = await database.qb.internal
    .selectFrom("_ponder_meta")
    .selectAll()
    .where("key", "like", "app_%")
    .execute();

  expect((metadata[0]!.value as PonderApp).is_locked).toBe(0);

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
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  await database.setup();
  await database.createIndexes();

  const indexNames = await getUserIndexNames(database, "1234__account");
  expect(indexNames).toContain("balance_index");

  await database.kill();
});

test("createLiveViews()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  await database.setup();
  await database.createLiveViews();

  const viewNames = await getUserViewNames(database);
  expect(viewNames).toContain("account");

  const metadata = await database.qb.internal
    .selectFrom("_ponder_meta")
    .select("value")
    .where("key", "=", "live")
    .executeTakeFirst();

  expect(metadata!.value).toStrictEqual({ instance_id: "1234" });

  await database.kill();
});

test("createLiveViews() drops old views", async (context) => {
  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  await database.setup();
  await database.createLiveViews();
  await database.kill();

  const databaseTwo = await createDatabase({
    common: context.common,
    schema: {
      transfer: onchainTable("transfer", (p) => ({
        id: p.serial().primaryKey(),
        from: p.hex().notNull(),
        to: p.hex().notNull(),
        amount: p.hex().notNull(),
      })),
    },
    databaseConfig: context.databaseConfig,
    instanceId: "5678",
    buildId: "def",
  });

  await databaseTwo.setup();
  await databaseTwo.createLiveViews();

  const viewNames = await getUserViewNames(databaseTwo);
  expect(viewNames).toHaveLength(1);
  expect(viewNames).toContain("transfer");

  const metadata = await databaseTwo.qb.internal
    .selectFrom("_ponder_meta")
    .select("value")
    .where("key", "=", "live")
    .executeTakeFirst();

  expect(metadata!.value).toStrictEqual({ instance_id: "5678" });

  await databaseTwo.kill();
});

test("createTriggers()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  await database.setup();
  await database.createTriggers();

  const indexingStore = createIndexingStore({
    common: context.common,
    database,
    schema: { account },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await indexingStore.flush();

  const rows = await database.qb.user
    .selectFrom("1234_reorg__account")
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

  await database.kill();
});

test("complete()", async (context) => {
  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  await database.setup();
  await database.createTriggers();

  const indexingStore = createIndexingStore({
    common: context.common,
    database,
    schema: { account },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await indexingStore.flush();
  await database.complete({
    checkpoint: createCheckpoint(10),
  });

  const rows = await database.qb.user
    .selectFrom("1234_reorg__account")
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
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  await database.setup();

  // setup tables, reorg tables, and metadata checkpoint

  await database.createTriggers();

  const indexingStore = createIndexingStore({
    common: context.common,
    database,
    schema: { account },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  await indexingStore
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await indexingStore.flush();
  await database.complete({
    checkpoint: createCheckpoint(9),
  });

  await indexingStore
    .update(account, { address: zeroAddress })
    .set({ balance: 88n });

  await indexingStore
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await indexingStore.flush();
  await database.complete({
    checkpoint: createCheckpoint(11),
  });

  await database.revert({
    checkpoint: createCheckpoint(10),
  });

  const rows = await database.qb.user
    .selectFrom("1234__account")
    .selectAll()
    .execute();

  expect(rows).toHaveLength(1);
  expect(rows[0]).toStrictEqual({ address: zeroAddress, balance: "10" });

  await database.kill();
});

async function getUserTableNames(database: Database) {
  const { rows } = await database.qb.internal.executeQuery<{ name: string }>(
    ksql`
      SELECT table_name as name
      FROM information_schema.tables
      WHERE table_schema = '${ksql.raw(database.namespace)}'
      AND table_type = 'BASE TABLE'
    `.compile(database.qb.internal),
  );
  return rows.map(({ name }) => name);
}

async function getUserViewNames(database: Database) {
  const { rows } = await database.qb.internal.executeQuery<{ name: string }>(
    ksql`
      SELECT table_name as name
      FROM information_schema.tables
      WHERE table_schema = '${ksql.raw(database.namespace)}'
      AND table_type = 'VIEW'
    `.compile(database.qb.internal),
  );
  return rows.map(({ name }) => name);
}

async function getUserIndexNames(database: Database, tableName: string) {
  const { rows } = await database.qb.internal.executeQuery<{
    name: string;
    tbl_name: string;
  }>(
    ksql`
      SELECT indexname as name
      FROM pg_indexes
      WHERE schemaname = '${ksql.raw(database.namespace)}'
      AND tablename = '${ksql.raw(tableName)}'
    `.compile(database.qb.internal),
  );
  return rows.map((r) => r.name);
}
