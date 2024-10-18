import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { onchainTable } from "@/drizzle/db.js";
import {
  type Checkpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { wait } from "@/utils/wait.js";
import { sql } from "kysely";
import { beforeEach, expect, test, vi } from "vitest";
import { type Database, createDatabase } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

vi.mock("@/generated", async () => {
  return {
    instanceId: "1234",
  };
});

const account = onchainTable("account", (p) => ({
  address: p.evmHex().primaryKey(),
  balance: p.evmBigint(),
}));

function createCheckpoint(index: number): Checkpoint {
  return { ...zeroCheckpoint, blockTimestamp: index };
}

test("setup succeeds with a fresh database", async (context) => {
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

  expect(metadata).toHaveLength(2);

  await database.kill();
});

test("setup succeeds with a prior app in the same namespace", async (context) => {
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

  expect(metadata).toHaveLength(4);

  await databaseTwo.kill();
});

test("setup with the same build ID recovers the finality checkpoint", async (context) => {
  const database = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "1234",
    buildId: "abc",
  });

  await database.setup();

  // Simulate progress being made by updating the checkpoints.
  const newCheckpoint = {
    ...zeroCheckpoint,
    blockNumber: 10n,
  };

  await database.finalize({
    checkpoint: encodeCheckpoint(newCheckpoint),
  });

  // await realtimeIndexingStore.create({
  //   tableName: "Pet",
  //   encodedCheckpoint: encodeCheckpoint({
  //     ...zeroCheckpoint,
  //     blockNumber: 9n,
  //   }),
  //   id: "id1",
  //   data: { name: "Skip" },
  // });
  // await realtimeIndexingStore.create({
  //   tableName: "Pet",
  //   encodedCheckpoint: encodeCheckpoint({
  //     ...zeroCheckpoint,
  //     blockNumber: 11n,
  //   }),
  //   id: "id2",
  //   data: { name: "Kevin" },
  // });
  // await realtimeIndexingStore.create({
  //   tableName: "Pet",
  //   encodedCheckpoint: encodeCheckpoint({
  //     ...zeroCheckpoint,
  //     blockNumber: 12n,
  //   }),
  //   id: "id3",
  //   data: { name: "Foo" },
  // });

  await database.kill();

  const databaseTwo = await createDatabase({
    common: context.common,
    schema: { account },
    databaseConfig: context.databaseConfig,
    instanceId: "5678",
    buildId: "abc",
  });

  const { checkpoint } = await databaseTwo.setup();

  expect(checkpoint).toMatchObject(encodeCheckpoint(newCheckpoint));

  // const { items: pets } = await readonlyIndexingStore.findMany({
  //   tableName: "Pet",
  // });

  // expect(pets.length).toBe(1);
  // expect(pets[0]!.name).toBe("Skip");

  const metadata = await databaseTwo.qb.internal
    .selectFrom("_ponder_meta")
    .selectAll()
    .execute();

  expect(metadata).toHaveLength(2);

  await databaseTwo.kill();
});

test.todo("setup with the same build ID reverts rows");

test.todo("setup with the same build ID drops indexes and triggers");

test.skip("setup with the same build ID recovers if the lock expires after waiting", async (context) => {
  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 625;

  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });
  await database.setup({ buildId: "abc" });
  await database.kill();

  const databaseTwo = createDatabase({
    common: context.common,
    schema: schemaTwo,
    databaseConfig: context.databaseConfig,
  });

  // Update the prior app lock row to simulate an abrupt shutdown.
  const row = await databaseTwo.qb.internal
    .selectFrom("_ponder_meta")
    .where("key", "=", "app")
    .select("value")
    .executeTakeFirst();

  await databaseTwo.qb.internal
    .updateTable("_ponder_meta")
    .where("key", "=", "app")
    .set({
      value:
        database.dialect === "sqlite"
          ? JSON.stringify({
              ...JSON.parse(row!.value!),
              is_locked: true,
            })
          : {
              // @ts-ignore
              ...row!.value!,
              is_locked: true,
            },
    })
    .execute();

  const { checkpoint } = await databaseTwo.setup({
    buildId: "def",
  });

  expect(checkpoint).toMatchObject(encodeCheckpoint(zeroCheckpoint));

  await databaseTwo.kill();
});

test.todo("setup drops old tables");

test.todo('setup publishes views if run with "ponder dev"');

test.todo(
  "setup with the same build ID succeeds if the lock doesn't expires after waiting",
  async (context) => {
    context.common.options.databaseHeartbeatInterval = 250;
    context.common.options.databaseHeartbeatTimeout = 625;

    const database = createDatabase({
      common: context.common,
      schema,
      databaseConfig: context.databaseConfig,
    });

    await database.setup({ buildId: "abc" });

    const databaseTwo = createDatabase({
      common: context.common,
      schema: schemaTwo,
      databaseConfig: context.databaseConfig,
    });

    await expect(() =>
      databaseTwo.setup({
        buildId: "def",
      }),
    ).rejects.toThrow(
      "Failed to acquire lock on schema 'public'. A different Ponder app is actively using this database.",
    );

    await database.kill();
    await databaseTwo.kill();
  },
);

test.todo(
  "setup throws if there is a table name collision",
  async (context) => {
    const database = createDatabase({
      common: context.common,
      schema,
      databaseConfig: context.databaseConfig,
    });

    await database.qb.internal.executeQuery(
      sql`CREATE TABLE "Pet" (id TEXT)`.compile(database.qb.internal),
    );

    expect(await getUserTableNames(database)).toStrictEqual(["Pet"]);

    await expect(() => database.setup({ buildId: "abc" })).rejects.toThrow(
      "Unable to create table 'public'.'Pet' because a table with that name already exists. Is there another application using the 'public' database schema?",
    );

    await database.kill();
  },
);

test.todo("setup v0.7 migration");

test("heartbeat updates the heartbeat_at value", async (context) => {
  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 625;

  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });
  await database.setup({ buildId: "abc" });

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
    BigInt(
      database.dialect === "sqlite"
        ? JSON.parse(rowAfterHeartbeat!.value!).heartbeat_at
        : // @ts-ignore
          rowAfterHeartbeat!.value!.heartbeat_at,
    ),
  ).toBeGreaterThan(
    database.dialect === "sqlite"
      ? JSON.parse(row!.value!).heartbeat_at
      : // @ts-ignore
        row!.value!.heartbeat_at,
  );

  await database.kill();
});

test("finalize updates lock table", async (context) => {
  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  await database.setup({
    buildId: "abc",
  });

  await database.finalize({
    checkpoint: encodeCheckpoint(maxCheckpoint),
  });

  const row = await database.qb.internal
    .selectFrom("_ponder_meta")
    .where("key", "=", "app")
    .select("value")
    .executeTakeFirst();

  expect(
    database.dialect === "sqlite"
      ? JSON.parse(row!.value!).checkpoint
      : // @ts-ignore
        row!.value!.checkpoint,
  ).toStrictEqual(encodeCheckpoint(maxCheckpoint));

  await database.kill();
});

test("finalize delete reorg table rows", async (context) => {
  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  await database.setup({ buildId: "abc" });

  const realtimeIndexingStore = getRealtimeStore({
    dialect: context.databaseConfig.kind,
    schema,
    db: database.qb.user,
    common: context.common,
  });

  await realtimeIndexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint({
      ...zeroCheckpoint,
      blockNumber: 9n,
    }),
    id: "id1",
    data: { name: "Skip" },
  });
  await realtimeIndexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint({
      ...zeroCheckpoint,
      blockNumber: 11n,
    }),
    id: "id2",
    data: { name: "Kevin" },
  });
  await realtimeIndexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint({
      ...zeroCheckpoint,
      blockNumber: 12n,
    }),
    id: "id3",
    data: { name: "Foo" },
  });

  let rows = await database.qb.internal
    .selectFrom("_ponder_reorg__Pet")
    .select("id")
    .execute();

  expect(rows).toHaveLength(3);

  await database.finalize({
    checkpoint: encodeCheckpoint({
      ...zeroCheckpoint,
      blockNumber: 11n,
    }),
  });

  rows = await database.qb.internal
    .selectFrom("_ponder_reorg__Pet")
    .select("id")
    .execute();

  expect(rows).toHaveLength(1);

  await database.kill();
});

test("kill sets is_locked to false", async (context) => {
  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  await database.setup({ buildId: "abc" });

  const row = await database.qb.internal
    .selectFrom("_ponder_meta")
    .where("key", "=", "app")
    .select("value")
    .executeTakeFirst();

  await database.kill();

  // Only creating this database to use the `orm` object.
  const databaseTwo = createDatabase({
    common: context.common,
    schema: schemaTwo,
    databaseConfig: context.databaseConfig,
  });

  const rowAfterKill = await databaseTwo.qb.internal
    .selectFrom("_ponder_meta")
    .where("key", "=", "app")
    .select("value")
    .executeTakeFirst();

  expect(
    database.dialect === "sqlite"
      ? JSON.parse(row!.value!).is_locked
      : // @ts-ignore
        row!.value!.is_locked,
  ).toBe(1);
  expect(
    database.dialect === "sqlite"
      ? JSON.parse(rowAfterKill!.value!).is_locked
      : // @ts-ignore
        rowAfterKill!.value!.is_locked,
  ).toBe(0);

  await databaseTwo.kill();
});

test.skip("createIndexes()", async (context) => {
  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  await database.setup({ buildId: "abc" });

  await database.createIndexes({ schema });

  const indexes = await getUserIndexNames(database, "Person");

  expect(indexes).toHaveLength(2);

  expect(indexes).toContain("Person_nameIndex");

  await database.kill();
});

test.todo("createViews()");

test.todo("createTriggers()");

test.todo("complete() updates reorg table checkpoints");

test("revert() deletes versions newer than the safe timestamp", async (context) => {
  const { indexingStore, database, cleanup } = await setupDatabaseServices(
    context,
    {
      schema,
      indexing: "realtime",
    },
  );

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Skip" },
  });
  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(13)),
    id: "id2",
    data: { name: "Foo" },
  });
  await indexingStore.update({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(15)),
    id: "id1",
    data: { name: "SkipUpdated" },
  });
  await indexingStore.create({
    tableName: "Person",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
    data: { name: "Bob" },
  });
  await indexingStore.update({
    tableName: "Person",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(11)),
    id: "id1",
    data: { name: "Bobby" },
  });
  await indexingStore.create({
    tableName: "Person",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(12)),
    id: "id2",
    data: { name: "Kevin" },
  });

  await database.revert({
    checkpoint: encodeCheckpoint(createCheckpoint(12)),
  });

  const { items: pets } = await indexingStore.findMany({ tableName: "Pet" });

  expect(pets.length).toBe(1);
  expect(pets[0]!.name).toBe("Skip");

  const { items: persons } = await indexingStore.findMany({
    tableName: "Person",
  });

  expect(persons.length).toBe(2);
  expect(persons[0]!.name).toBe("Bobby");
  expect(persons[1]!.name).toBe("Kevin");

  const PetLogs = await database.qb.user
    .selectFrom("_ponder_reorg__Pet")
    .selectAll()
    .execute();

  expect(PetLogs).toHaveLength(1);

  const PersonLogs = await database.qb.user
    .selectFrom("_ponder_reorg__Person")
    .selectAll()
    .execute();
  expect(PersonLogs).toHaveLength(3);

  await cleanup();
});

test("revert() updates versions with intermediate logs", async (context) => {
  const { indexingStore, database, cleanup } = await setupDatabaseServices(
    context,
    {
      schema,
      indexing: "realtime",
    },
  );

  await indexingStore.create({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(9)),
    id: "id1",
    data: { name: "Skip" },
  });
  await indexingStore.delete({
    tableName: "Pet",
    encodedCheckpoint: encodeCheckpoint(createCheckpoint(10)),
    id: "id1",
  });

  await database.revert({
    checkpoint: encodeCheckpoint(createCheckpoint(8)),
  });

  const instancePet = await indexingStore.findUnique({
    tableName: "Pet",
    id: "id1",
  });
  expect(instancePet).toBe(null);

  const PetLogs = await database.qb.user
    .selectFrom("_ponder_reorg__Pet")
    .selectAll()
    .execute();
  expect(PetLogs).toHaveLength(0);

  await cleanup();
});

async function getUserTableNames(database: Database) {
  const { rows } = await database.qb.internal.executeQuery<{ name: string }>(
    database.dialect === "sqlite"
      ? sql`SELECT name FROM sqlite_master WHERE type='table'`.compile(
          database.qb.internal,
        )
      : sql`
    SELECT table_name as name
    FROM information_schema.tables
    WHERE table_schema = '${sql.raw(database.namespace)}'
    AND table_type = 'BASE TABLE'
  `.compile(database.qb.internal),
  );
  return rows.map(({ name }) => name);
}

async function getUserIndexNames(database: Database, tableName: string) {
  const { rows } = await database.qb.internal.executeQuery<{
    name: string;
    tbl_name: string;
  }>(
    database.dialect === "sqlite"
      ? sql`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='${sql.raw(tableName)}'`.compile(
          database.qb.internal,
        )
      : sql`
    SELECT indexname as name
    FROM pg_indexes
    WHERE schemaname = '${sql.raw(database.namespace)}'
    AND tablename = '${sql.raw(tableName)}'
  `.compile(database.qb.internal),
  );
  return rows.map((r) => r.name);
}
