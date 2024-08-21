import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getReadonlyStore } from "@/indexing-store/readonly.js";
import { getRealtimeStore } from "@/indexing-store/realtime.js";
import { createSchema } from "@/schema/schema.js";
import {
  type Checkpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { wait } from "@/utils/wait.js";
import { sql } from "kysely";
import { beforeEach, expect, test } from "vitest";
import { type Database, createDatabase } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

const schema = createSchema((p) => ({
  PetKind: p.createEnum(["CAT", "DOG"]),
  Pet: p.createTable(
    {
      id: p.string(),
      name: p.string(),
      age: p.int().optional(),
      bigAge: p.bigint().optional(),
      kind: p.enum("PetKind").optional(),
    },
    {
      multiIndex: p.index(["name", "age"]),
    },
  ),
  Person: p.createTable(
    {
      id: p.string(),
      name: p.string(),
    },
    {
      nameIndex: p.index("name"),
    },
  ),
}));

const schemaTwo = createSchema((p) => ({
  Dog: p.createTable({
    id: p.string(),
    name: p.string(),
    age: p.int().optional(),
    bigAge: p.bigint().optional(),
  }),
  Apple: p.createTable({
    id: p.string(),
    name: p.string(),
  }),
}));

function createCheckpoint(index: number): Checkpoint {
  return { ...zeroCheckpoint, blockTimestamp: index };
}

test("setup succeeds with a fresh database", async (context) => {
  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  const { checkpoint } = await database.prepareEnv({ buildId: "abc" });

  expect(checkpoint).toMatchObject(encodeCheckpoint(zeroCheckpoint));

  const tableNames = await getUserTableNames(database);
  expect(tableNames).toContain("Pet");
  expect(tableNames).toContain("Person");
  expect(tableNames).toContain("_ponder_meta");
  expect(tableNames).toContain("_ponder_reorg_Pet");
  expect(tableNames).toContain("_ponder_reorg_Person");

  await database.kill();
});

test("setup succeeds with a prior app in the same namespace", async (context) => {
  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  await database.prepareEnv({ buildId: "abc" });
  await database.kill();

  const databaseTwo = createDatabase({
    common: context.common,
    schema: schemaTwo,
    databaseConfig: context.databaseConfig,
  });

  let tableNames = await getUserTableNames(databaseTwo);
  expect(tableNames).toContain("Pet");
  expect(tableNames).toContain("Person");
  expect(tableNames).toContain("_ponder_meta");
  expect(tableNames).toContain("_ponder_reorg_Pet");
  expect(tableNames).toContain("_ponder_reorg_Person");

  await databaseTwo.prepareEnv({ buildId: "def" });

  tableNames = await getUserTableNames(databaseTwo);

  expect(tableNames).toContain("Dog");
  expect(tableNames).toContain("Apple");
  expect(tableNames).toContain("_ponder_meta");
  expect(tableNames).toContain("_ponder_reorg_Dog");
  expect(tableNames).toContain("_ponder_reorg_Apple");

  await databaseTwo.kill();
});

test("setup does not drop tables that are not managed by ponder", async (context) => {
  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  await database.prepareEnv({ buildId: "abc" });
  await database.kill();

  const databaseTwo = createDatabase({
    common: context.common,
    schema: schemaTwo,
    databaseConfig: context.databaseConfig,
  });
  await databaseTwo.orm.internal.executeQuery(
    sql`CREATE TABLE public.not_a_ponder_table (id TEXT)`.compile(
      databaseTwo.orm.internal,
    ),
  );
  await databaseTwo.orm.internal.executeQuery(
    sql`CREATE TABLE public."AnotherTable" (id TEXT)`.compile(
      databaseTwo.orm.internal,
    ),
  );
  let tableNames = await getUserTableNames(databaseTwo);
  expect(tableNames).toContain("Pet");
  expect(tableNames).toContain("Person");
  expect(tableNames).toContain("_ponder_meta");
  expect(tableNames).toContain("_ponder_reorg_Pet");
  expect(tableNames).toContain("_ponder_reorg_Person");
  expect(tableNames).toContain("not_a_ponder_table");
  expect(tableNames).toContain("AnotherTable");

  await databaseTwo.prepareEnv({ buildId: "def" });

  tableNames = await getUserTableNames(databaseTwo);

  expect(tableNames).toContain("Dog");
  expect(tableNames).toContain("Apple");
  expect(tableNames).toContain("_ponder_meta");
  expect(tableNames).toContain("_ponder_reorg_Dog");
  expect(tableNames).toContain("_ponder_reorg_Apple");

  await databaseTwo.kill();
});

test("setup with the same build ID and namespace reverts to and returns the finality checkpoint", async (context) => {
  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  await database.prepareEnv({ buildId: "abc" });

  const realtimeIndexingStore = getRealtimeStore({
    encoding: context.databaseConfig.kind,
    schema,
    db: database.orm.user,
    common: context.common,
  });

  // Simulate progress being made by updating the checkpoints.
  const newCheckpoint = {
    ...zeroCheckpoint,
    blockNumber: 10n,
  };

  await database.updateFinalizedCheckpoint({
    checkpoint: encodeCheckpoint(newCheckpoint),
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

  await database.kill();

  const databaseTwo = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  const { checkpoint } = await databaseTwo.prepareEnv({
    buildId: "abc",
  });

  const readonlyIndexingStore = getReadonlyStore({
    encoding: context.databaseConfig.kind,
    schema,
    db: databaseTwo.orm.user,
    common: context.common,
  });

  expect(checkpoint).toMatchObject(encodeCheckpoint(newCheckpoint));

  const { items: pets } = await readonlyIndexingStore.findMany({
    tableName: "Pet",
  });

  expect(pets.length).toBe(1);
  expect(pets[0]!.name).toBe("Skip");

  await databaseTwo.kill();
});

test("setup succeeds if the lock expires after waiting to expire", async (context) => {
  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 625;

  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });
  await database.prepareEnv({ buildId: "abc" });
  await database.kill();

  const databaseTwo = createDatabase({
    common: context.common,
    schema: schemaTwo,
    databaseConfig: context.databaseConfig,
  });

  // Update the prior app lock row to simulate an abrupt shutdown.
  const row = await databaseTwo.orm.internal
    .selectFrom("_ponder_meta")
    .where("key", "=", "app")
    .select("value")
    .executeTakeFirst();

  await databaseTwo.orm.internal
    .updateTable("_ponder_meta")
    .where("key", "=", "app")
    .set({
      value:
        database.sql === "sqlite"
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

  const { checkpoint } = await databaseTwo.prepareEnv({
    buildId: "def",
  });

  expect(checkpoint).toMatchObject(encodeCheckpoint(zeroCheckpoint));

  await databaseTwo.kill();
});

test("setup throws if the namespace is still locked after waiting to expire", async (context) => {
  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 625;

  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  await database.prepareEnv({ buildId: "abc" });

  const databaseTwo = createDatabase({
    common: context.common,
    schema: schemaTwo,
    databaseConfig: context.databaseConfig,
  });

  await expect(() =>
    databaseTwo.prepareEnv({
      buildId: "def",
    }),
  ).rejects.toThrow(
    "Failed to acquire lock on schema 'public'. A different Ponder app is actively using this database.",
  );

  await database.kill();
  await databaseTwo.kill();
});

test("setup throws if there is a table name collision", async (context) => {
  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  await database.orm.internal.executeQuery(
    sql`CREATE TABLE public."Pet" (id TEXT)`.compile(database.orm.internal),
  );

  expect(await getUserTableNames(database)).toStrictEqual(["Pet"]);

  await expect(() => database.prepareEnv({ buildId: "abc" })).rejects.toThrow(
    "Unable to create table 'public'.'Pet' because a table with that name already exists. Is there another application using the 'public' database schema?",
  );

  await database.kill();
});

test("heartbeat updates the heartbeat_at value", async (context) => {
  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 625;

  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });
  await database.prepareEnv({ buildId: "abc" });

  const row = await database.orm.internal
    .selectFrom("_ponder_meta")
    .where("key", "=", "app")
    .select("value")
    .executeTakeFirst();

  await wait(500);

  const rowAfterHeartbeat = await database.orm.internal
    .selectFrom("_ponder_meta")
    .where("key", "=", "app")
    .select("value")
    .executeTakeFirst();

  expect(
    BigInt(
      database.sql === "sqlite"
        ? JSON.parse(rowAfterHeartbeat!.value!).heartbeat_at
        : // @ts-ignore
          rowAfterHeartbeat!.value!.heartbeat_at,
    ),
  ).toBeGreaterThan(
    database.sql === "sqlite"
      ? JSON.parse(row!.value!).heartbeat_at
      : // @ts-ignore
        row!.value!.heartbeat_at,
  );

  await database.kill();
});

test("updateFinalizedCheckpoint updates lock table", async (context) => {
  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  await database.prepareEnv({
    buildId: "abc",
  });

  await database.updateFinalizedCheckpoint({
    checkpoint: encodeCheckpoint(maxCheckpoint),
  });

  const row = await database.orm.internal
    .selectFrom("_ponder_meta")
    .where("key", "=", "app")
    .select("value")
    .executeTakeFirst();

  expect(
    database.sql === "sqlite"
      ? JSON.parse(row!.value!).checkpoint
      : // @ts-ignore
        row!.value!.checkpoint,
  ).toStrictEqual(encodeCheckpoint(maxCheckpoint));

  await database.kill();
});

test("kill releases the namespace lock", async (context) => {
  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  await database.prepareEnv({ buildId: "abc" });

  const row = await database.orm.internal
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

  const rowAfterKill = await databaseTwo.orm.internal
    .selectFrom("_ponder_meta")
    .where("key", "=", "app")
    .select("value")
    .executeTakeFirst();

  expect(
    database.sql === "sqlite"
      ? JSON.parse(row!.value!).is_locked
      : // @ts-ignore
        row!.value!.is_locked,
  ).toBe(true);
  expect(
    database.sql === "sqlite"
      ? JSON.parse(rowAfterKill!.value!).is_locked
      : // @ts-ignore
        rowAfterKill!.value!.is_locked,
  ).toBe(false);

  await databaseTwo.kill();
});

test("createIndexes adds a single column index", async (context) => {
  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  await database.prepareEnv({ buildId: "abc" });

  await database.createIndexes({ schema });

  const indexes = await getUserIndexNames(database, "Person");

  expect(indexes).toHaveLength(2);

  expect(indexes).toContain("Person_nameIndex");

  await database.kill();
});

test("createIndexes adds a multi column index", async (context) => {
  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  await database.prepareEnv({ buildId: "abc" });

  await database.createIndexes({ schema });

  const indexes = await getUserIndexNames(database, "Pet");

  expect(indexes).toHaveLength(2);

  expect(indexes).toContain("Pet_multiIndex");

  await database.kill();
});

test("createIndexes with ordering", async (context) => {
  const schema = createSchema((p) => ({
    Kevin: p.createTable(
      {
        id: p.string(),
        age: p.int(),
      },
      {
        kevinIndex: p.index("age").asc().nullsLast(),
      },
    ),
  }));

  const database = createDatabase({
    common: context.common,
    schema,
    databaseConfig: context.databaseConfig,
  });

  await database.prepareEnv({ buildId: "abc" });

  await database.createIndexes({ schema });

  const indexes = await getUserIndexNames(database, "Kevin");

  expect(indexes).toHaveLength(2);

  expect(indexes).toContain("Kevin_kevinIndex");

  await database.kill();
});

test(
  "setup with the same build ID drops indexes",
  async (context) => {
    const database = createDatabase({
      common: context.common,
      schema,
      databaseConfig: context.databaseConfig,
    });

    await database.prepareEnv({ buildId: "abc" });

    await database.createIndexes({ schema });

    await database.kill();

    const databaseTwo = createDatabase({
      common: context.common,
      schema,
      databaseConfig: context.databaseConfig,
    });

    await databaseTwo.prepareEnv({ buildId: "abc" });

    const indexes = await getUserIndexNames(databaseTwo, "Person");

    expect(indexes).toStrictEqual([
      database.sql === "sqlite" ? "sqlite_autoindex_Person_1" : "Person_pkey",
    ]);

    await databaseTwo.kill();
  },
  { timeout: 30_000 },
);

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

  const PetLogs = await database.orm.user
    .selectFrom("_ponder_reorg_Pet")
    .selectAll()
    .execute();

  expect(PetLogs).toHaveLength(1);

  const PersonLogs = await database.orm.user
    .selectFrom("_ponder_reorg_Person")
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

  const PetLogs = await database.orm.user
    .selectFrom("_ponder_reorg_Pet")
    .selectAll()
    .execute();
  expect(PetLogs).toHaveLength(0);

  await cleanup();
});

async function getUserTableNames(database: Database) {
  const { rows } = await database.orm.internal.executeQuery<{ name: string }>(
    database.sql === "sqlite"
      ? sql`SELECT name FROM ${sql.raw(
          database.namespace,
        )}.sqlite_master WHERE type='table'`.compile(database.orm.internal)
      : sql`
    SELECT table_name as name
    FROM information_schema.tables
    WHERE table_schema = '${sql.raw(database.namespace)}'
    AND table_type = 'BASE TABLE'
  `.compile(database.orm.internal),
  );
  return rows.map(({ name }) => name);
}

async function getUserIndexNames(database: Database, tableName: string) {
  const { rows } = await database.orm.internal.executeQuery<{
    name: string;
    tbl_name: string;
  }>(
    database.sql === "sqlite"
      ? sql`SELECT name FROM ${sql.raw(
          database.namespace,
        )}.sqlite_master WHERE type='index' AND tbl_name='${sql.raw(tableName)}'`.compile(
          database.orm.internal,
        )
      : sql`
    SELECT indexname as name
    FROM pg_indexes
    WHERE schemaname = '${sql.raw(database.namespace)}'
    AND tablename = '${sql.raw(tableName)}'
  `.compile(database.orm.internal),
  );
  return rows.map((r) => r.name);
}
