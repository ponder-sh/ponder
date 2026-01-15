import { context, setupCommon, setupIsolatedDatabase } from "@/_test/setup.js";
import { getChain } from "@/_test/utils.js";
import { buildSchema } from "@/build/schema.js";
import {
  onchainEnum,
  onchainTable,
  onchainView,
  primaryKey,
} from "@/drizzle/onchain.js";
import { createShutdown } from "@/internal/shutdown.js";
import type { IndexingErrorHandler } from "@/internal/types.js";
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
  commitBlock,
  crashRecovery,
  createIndexes,
  createLiveQueryProcedures,
  createLiveQueryTriggers,
  createTriggers,
  createViews,
  dropLiveQueryTriggers,
  dropTriggers,
  finalizeMultichain,
  revertMultichain,
} from "./actions.js";
import {
  type Database,
  TABLES,
  VIEWS,
  createDatabase,
  getPonderCheckpointTable,
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

test("migrate() succeeds with empty schema", async () => {
  const database = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      ordering: "multichain",
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  await database.migrate({
    buildId: "abc",
    chains: [],
    finalizedBlocks: [],
  });

  const tableNames = await getUserTableNames(database, "public");
  expect(tableNames).toContain("account");
  expect(tableNames).toContain("_reorg__account");
  expect(tableNames).toContain("_ponder_meta");

  const metadata = await database.userQB.wrap((db) =>
    db.select().from(sql`_ponder_meta`),
  );

  expect(metadata).toHaveLength(1);

  await context.common.shutdown.kill();
});

test("migrate() with empty schema creates tables, views, and enums", async () => {
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

  const userView = onchainView("user_view").as((qb) => qb.select().from(user));

  const database = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account, kyle, mood, user, userView },
      statements: buildSchema({
        schema: { account, kyle, mood, user, userView },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  await database.migrate({
    buildId: "abc",
    chains: [],
    finalizedBlocks: [],
  });

  const tableNames = await getUserTableNames(database, "public");
  expect(tableNames).toContain("account");
  expect(tableNames).toContain("_reorg__account");
  expect(tableNames).toContain("kyle");
  expect(tableNames).toContain("_reorg__kyle");
  expect(tableNames).toContain("kyle");
  expect(tableNames).toContain("_reorg__kyle");
  expect(tableNames).toContain("_ponder_meta");
  expect(tableNames).toContain("_ponder_checkpoint");

  const viewNames = await getUserViewNames(database, "public");
  expect(viewNames).toContain("user_view");

  await context.common.shutdown.kill();
});

test("migrate() throws with schema used", async () => {
  const database = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });
  await database.migrate({
    buildId: "abc",
    chains: [],
    finalizedBlocks: [],
  });
  await context.common.shutdown.kill();

  context.common.shutdown = createShutdown();

  const databaseTwo = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  const error = await databaseTwo
    .migrate({
      buildId: "def",
      chains: [],
      finalizedBlocks: [],
    })
    .catch((err) => err);

  expect(error).toBeDefined();

  await context.common.shutdown.kill();
});

// PGlite not being able to concurrently connect to the same database from two different clients
// makes this test impossible.
test("migrate() throws with schema used after waiting for lock", async () => {
  if (context.databaseConfig.kind !== "postgres") return;

  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 1000;

  const database = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });
  await database.migrate({
    buildId: "abc",
    chains: [],
    finalizedBlocks: [],
  });

  const databaseTwo = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  const error = await databaseTwo
    .migrate({
      buildId: "abc",
      chains: [],
      finalizedBlocks: [],
    })
    .catch((err) => err);

  expect(error).toBeDefined();

  await context.common.shutdown.kill();
});

test("migrate() succeeds with crash recovery", async () => {
  const database = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  await database.migrate({
    buildId: "abc",
    chains: [],
    finalizedBlocks: [],
  });
  await context.common.shutdown.kill();

  context.common.shutdown = createShutdown();

  const databaseTwo = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  await databaseTwo.migrate({
    buildId: "abc",
    chains: [],
    finalizedBlocks: [],
  });

  const metadata = await databaseTwo.userQB.wrap((db) =>
    db.select().from(getPonderMetaTable("public")),
  );

  expect(metadata).toHaveLength(1);

  const tableNames = await getUserTableNames(databaseTwo, "public");
  expect(tableNames).toContain("account");
  expect(tableNames).toContain("_reorg__account");
  expect(tableNames).toContain("_ponder_meta");

  await context.common.shutdown.kill();
});

test("migrate() succeeds with crash recovery after waiting for lock", async () => {
  context.common.options.databaseHeartbeatInterval = 750;
  context.common.options.databaseHeartbeatTimeout = 500;

  const database = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });
  await database.migrate({
    buildId: "abc",
    chains: [],
    finalizedBlocks: [],
  });

  const databaseTwo = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  await databaseTwo.migrate({
    buildId: "abc",
    chains: [],
    finalizedBlocks: [],
  });

  await context.common.shutdown.kill();
});

test("migrateSync()", async () => {
  const database = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  await database.migrateSync();

  // Note: this is a hack to avoid trying to update the metadata table on shutdown
  context.common.options.command = "list";

  await context.common.shutdown.kill();
});

// Note: this test doesn't do anything because we don't have a migration using the
// new design yet.
test.skip("migrateSync() handles concurrent migrations", async () => {
  if (context.databaseConfig.kind !== "postgres") return;

  const database = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  // The second migration should error, then retry and succeed
  const spy = vi.spyOn(database.userQB, "transaction");

  await Promise.all([database.migrateSync(), database.migrateSync()]);

  // transaction gets called when performing a migration
  expect(spy).toHaveBeenCalledTimes(3);

  // Note: this is a hack to avoid trying to update the metadata table on shutdown
  context.common.options.command = "list";

  await context.common.shutdown.kill();
});

test("migrate() with crash recovery reverts rows", async () => {
  const database = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  await database.migrate({
    buildId: "abc",
    chains: [],
    finalizedBlocks: [],
  });

  // setup tables, reorg tables, and metadata checkpoint

  await database.userQB.wrap((db) =>
    db.update(getPonderMetaTable("public")).set({
      value: sql`jsonb_set(value, '{is_ready}', to_jsonb(1))`,
    }),
  );

  await database.userQB.raw
    .insert(account)
    .values({ address: zeroAddress, balance: 10n });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 9n }),
    table: account,
    preBuild: { ordering: "multichain" },
  });

  await createTriggers(database.userQB, { tables: [account] });

  await database.userQB.raw
    .insert(account)
    .values({ address: "0x0000000000000000000000000000000000000001" });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 11n }),
    table: account,
    preBuild: { ordering: "multichain" },
  });

  await database.userQB.wrap((db) =>
    db.insert(getPonderCheckpointTable()).values({
      chainId: 1,
      chainName: "mainnet",
      latestCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
      finalizedCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
      safeCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    }),
  );

  await context.common.shutdown.kill();

  context.common.shutdown = createShutdown();

  const databaseTwo = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  const checkpoint = await databaseTwo.migrate({
    buildId: "abc",
    chains: [getChain()],
    finalizedBlocks: [
      {
        timestamp: "0x1",
        number: "0xa",
        hash: "0x",
        parentHash: "0x",
      },
    ],
  });

  expect(checkpoint).toMatchInlineSnapshot(`
    [
      {
        "chainId": 1,
        "checkpoint": "000000000000000000000000010000000000000010000000000000000000000000000000000",
      },
    ]
  `);

  const rows = await databaseTwo.userQB.wrap((db) =>
    db.execute(sql`SELECT * from "account"`).then((result) => result.rows),
  );

  expect(rows).toHaveLength(1);
  expect(rows[0]!.address).toBe(zeroAddress);

  const metadata = await databaseTwo.userQB.wrap((db) =>
    db.select().from(getPonderMetaTable("public")),
  );

  expect(metadata).toHaveLength(1);

  await context.common.shutdown.kill();
});

test("migrate() with crash recovery drops indexes and triggers", async () => {
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

  const database = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  await database.migrate({
    buildId: "abc",
    chains: [],
    finalizedBlocks: [],
  });

  await createIndexes(database.userQB, {
    statements: buildSchema({
      schema: { account },
      preBuild: { ordering: "multichain" },
    }).statements,
  });

  await database.userQB.wrap((db) =>
    db.insert(getPonderCheckpointTable()).values({
      chainId: 1,
      chainName: "mainnet",
      latestCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
      finalizedCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
      safeCheckpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    }),
  );

  await database.userQB.wrap((db) =>
    db.update(getPonderMetaTable("public")).set({
      value: sql`jsonb_set(value, '{is_ready}', to_jsonb(1))`,
    }),
  );

  await context.common.shutdown.kill();

  context.common.shutdown = createShutdown();

  const databaseTwo = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  await databaseTwo.migrate({
    buildId: "abc",
    chains: [getChain()],
    finalizedBlocks: [
      {
        timestamp: "0x1",
        number: "0xa",
        hash: "0x",
        parentHash: "0x",
      },
    ],
  });

  const indexNames = await getUserIndexNames(databaseTwo, "public", "account");

  expect(indexNames).toHaveLength(1);

  await context.common.shutdown.kill();
});

test("heartbeat updates the heartbeat_at value", async () => {
  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 625;

  const database = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { account },
      statements: buildSchema({
        schema: { account },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  await database.migrate({
    buildId: "abc",
    chains: [],
    finalizedBlocks: [],
  });

  const row = await database.userQB.wrap((db) =>
    db
      .select()
      .from(getPonderMetaTable("public"))
      .then((result) => result[0]!.value),
  );

  await wait(500);

  const rowAfterHeartbeat = await database.userQB.wrap((db) =>
    db
      .select()
      .from(getPonderMetaTable("public"))
      .then((result) => result[0]!.value),
  );

  expect(BigInt(rowAfterHeartbeat!.heartbeat_at)).toBeGreaterThan(
    row!.heartbeat_at,
  );

  await context.common.shutdown.kill();
});

test("camelCase", async () => {
  const accountCC = onchainTable("accountCc", (p) => ({
    address: p.hex("addressCc").primaryKey(),
    balance: p.bigint(),
  }));

  const accountViewCC = onchainView("accountViewCc").as((qb) =>
    qb.select().from(accountCC),
  );

  const database = createDatabase({
    common: context.common,
    namespace: {
      schema: "public",
      viewsSchema: "viewCc",
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
      ordering: "multichain",
    },
    schemaBuild: {
      schema: { accountCC, accountViewCC },
      statements: buildSchema({
        schema: { accountCC, accountViewCC },
        preBuild: { ordering: "multichain" },
      }).statements,
    },
  });

  await database.migrate({
    buildId: "abc",
    chains: [],
    finalizedBlocks: [],
  });

  const tableNames = await getUserTableNames(database, "public");
  expect(tableNames).toContain("accountCc");
  expect(tableNames).toContain("_reorg__accountCc");
  expect(tableNames).toContain("_ponder_meta");

  const metadata = await database.userQB.wrap((db) =>
    db.select().from(sql`_ponder_meta`),
  );

  expect(metadata).toHaveLength(1);

  await createTriggers(database.userQB, { tables: [accountCC] });

  await createIndexes(database.userQB, {
    statements: buildSchema({
      schema: { accountCC },
      preBuild: { ordering: "multichain" },
    }).statements,
  });

  await createViews(database.userQB, {
    tables: [accountCC],
    views: [accountViewCC],
    namespaceBuild: { schema: "public", viewsSchema: "viewCc" },
  });

  await commitBlock(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    table: accountCC,
    preBuild: { ordering: "multichain" },
  });

  await dropTriggers(database.userQB, { tables: [accountCC] });

  await createLiveQueryProcedures(database.userQB, {
    namespaceBuild: { schema: "public", viewsSchema: "viewCc" },
  });
  await createLiveQueryTriggers(database.userQB, {
    tables: [accountCC],
    namespaceBuild: { schema: "public", viewsSchema: "viewCc" },
  });
  await dropLiveQueryTriggers(database.userQB, {
    tables: [accountCC],
    namespaceBuild: { schema: "public", viewsSchema: "viewCc" },
  });

  await revertMultichain(database.userQB, {
    tables: [accountCC],
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
  });
  await finalizeMultichain(database.userQB, {
    checkpoint: createCheckpoint({ chainId: 1n, blockNumber: 10n }),
    tables: [accountCC],
    namespaceBuild: { schema: "public", viewsSchema: "viewCc" },
  });
  await crashRecovery(database.userQB, {
    table: accountCC,
  });

  await context.common.shutdown.kill();
});

async function getUserTableNames(database: Database, namespace: string) {
  const rows = await database.userQB.wrap((db) =>
    db
      .select({ name: TABLES.table_name })
      .from(TABLES)
      .where(
        and(
          eq(TABLES.table_schema, namespace),
          eq(TABLES.table_type, "BASE TABLE"),
        ),
      ),
  );

  return rows.map(({ name }) => name);
}

async function getUserViewNames(database: Database, namespace: string) {
  const rows = await database.userQB.wrap((db) =>
    db
      .select({ name: VIEWS.table_name })
      .from(VIEWS)
      .where(and(eq(VIEWS.table_schema, namespace))),
  );

  return rows.map(({ name }) => name);
}

async function getUserIndexNames(
  database: Database,
  namespace: string,
  tableName: string,
) {
  const rows = await database.userQB.wrap((db) =>
    db
      .select({
        name: sql<string>`indexname`.as("name"),
      })
      .from(sql`pg_indexes`)
      .where(
        and(eq(sql`schemaname`, namespace), eq(sql`tablename`, tableName)),
      ),
  );
  return rows.map((r) => r.name);
}
