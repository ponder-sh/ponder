import { setupCommon, setupIsolatedDatabase } from "@/_test/setup.js";
import { createSchema } from "@/schema/schema.js";
import {
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { wait } from "@/utils/wait.js";
import { sql } from "kysely";
import { beforeEach, expect, test } from "vitest";
import { createSqliteDatabase } from "./index.js";
import type { HeadlessKysely } from "./kysely.js";

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

test("setup succeeds with a fresh database", async (context) => {
  if (context.databaseConfig.kind !== "sqlite") return;
  const database = createSqliteDatabase({
    common: context.common,
    schema,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  const { checkpoint } = await database.manageDatabaseEnv({ buildId: "abc" });

  expect(checkpoint).toMatchObject(encodeCheckpoint(zeroCheckpoint));

  const tableNames = await getTableNames(database.orm.internal, "public");
  expect(tableNames).toContain("Pet");
  expect(tableNames).toContain("Person");
  expect(tableNames).toContain("_ponder_meta");
  expect(tableNames).toContain("_ponder_reorg_Pet");
  expect(tableNames).toContain("_ponder_reorg_Person");

  await database.kill();
});

test("setup succeeds with a prior app in the same namespace", async (context) => {
  if (context.databaseConfig.kind !== "sqlite") return;
  const database = createSqliteDatabase({
    common: context.common,
    schema,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  await database.manageDatabaseEnv({ buildId: "abc" });
  await database.kill();

  const databaseTwo = createSqliteDatabase({
    common: context.common,
    schema: schemaTwo,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  let tableNames = await getTableNames(databaseTwo.orm.internal);
  expect(tableNames).toContain("Pet");
  expect(tableNames).toContain("Person");
  expect(tableNames).toContain("_ponder_meta");
  expect(tableNames).toContain("_ponder_reorg_Pet");
  expect(tableNames).toContain("_ponder_reorg_Person");

  await databaseTwo.manageDatabaseEnv({ buildId: "def" });

  tableNames = await getTableNames(databaseTwo.orm.internal);

  expect(tableNames).toContain("Dog");
  expect(tableNames).toContain("Apple");
  expect(tableNames).toContain("_ponder_meta");
  expect(tableNames).toContain("_ponder_reorg_Dog");
  expect(tableNames).toContain("_ponder_reorg_Apple");

  await databaseTwo.kill();
});

test("setup does not drop tables that are not managed by ponder", async (context) => {
  if (context.databaseConfig.kind !== "sqlite") return;
  const database = createSqliteDatabase({
    common: context.common,
    schema,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  await database.manageDatabaseEnv({ buildId: "abc" });
  await database.kill();

  const databaseTwo = createSqliteDatabase({
    common: context.common,
    schema: schemaTwo,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
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
  let tableNames = await getTableNames(databaseTwo.orm.internal, "public");
  expect(tableNames).toContain("Pet");
  expect(tableNames).toContain("Person");
  expect(tableNames).toContain("_ponder_meta");
  expect(tableNames).toContain("_ponder_reorg_Pet");
  expect(tableNames).toContain("_ponder_reorg_Person");
  expect(tableNames).toContain("not_a_ponder_table");
  expect(tableNames).toContain("AnotherTable");

  await databaseTwo.manageDatabaseEnv({ buildId: "def" });

  tableNames = await getTableNames(databaseTwo.orm.internal);

  expect(tableNames).toContain("Dog");
  expect(tableNames).toContain("Apple");
  expect(tableNames).toContain("_ponder_meta");
  expect(tableNames).toContain("_ponder_reorg_Dog");
  expect(tableNames).toContain("_ponder_reorg_Apple");

  await databaseTwo.kill();
});

test.skip("setup with the same build ID and namespace reverts to and returns the finality checkpoint", async (context) => {
  if (context.databaseConfig.kind !== "sqlite") return;
  const database = createSqliteDatabase({
    common: context.common,
    schema,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  await database.manageDatabaseEnv({ buildId: "abc" });

  // const realtimeIndexingStore = getRealtimeStore({
  //   encoding: context.databaseConfig.kind,
  //   schema,
  //   db: database.indexingDb,
  //   namespaceInfo,
  //   common: context.common,
  // });

  // Simulate progress being made by updating the checkpoints.
  // TODO: Actually use the indexing store.
  const newCheckpoint = {
    ...zeroCheckpoint,
    blockNumber: 10n,
  };

  await database.db
    .withSchema(namespaceInfo.internalNamespace)
    .updateTable("namespace_lock")
    .set({ finalized_checkpoint: encodeCheckpoint(newCheckpoint) })
    .where("namespace", "=", "public")
    .execute();

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

  const databaseTwo = createSqliteDatabase({
    common: context.common,
    schema: schemaTwo,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  const { checkpoint, namespaceInfo: namespaceInfoTwo } =
    await databaseTwo.setup({
      schema,
      buildId: "abc",
    });

  const readonlyIndexingStore = getReadonlyStore({
    encoding: context.databaseConfig.kind,
    schema,
    db: databaseTwo.indexingDb,
    namespaceInfo: namespaceInfoTwo,
    common: context.common,
  });

  expect(checkpoint).toMatchObject(newCheckpoint);

  const { items: pets } = await readonlyIndexingStore.findMany({
    tableName: "Pet",
  });

  expect(pets.length).toBe(1);
  expect(pets[0]!.name).toBe("Skip");

  await databaseTwo.kill();
});

test("setup succeeds if the lock expires after waiting to expire", async (context) => {
  if (context.databaseConfig.kind !== "sqlite") return;
  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 625;

  const database = createSqliteDatabase({
    common: context.common,
    schema,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });
  await database.manageDatabaseEnv({ buildId: "abc" });
  await database.kill();

  const databaseTwo = createSqliteDatabase({
    common: context.common,
    schema: schemaTwo,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
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
      value: JSON.stringify({
        ...JSON.parse(row!.value!),
        is_locked: true,
      }),
    })
    .execute();

  const { checkpoint } = await databaseTwo.manageDatabaseEnv({
    buildId: "def",
  });

  expect(checkpoint).toMatchObject(encodeCheckpoint(zeroCheckpoint));

  await databaseTwo.kill();
});

test("setup throws if the namespace is still locked after waiting to expire", async (context) => {
  if (context.databaseConfig.kind !== "sqlite") return;
  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 625;

  const database = createSqliteDatabase({
    common: context.common,
    schema,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  await database.manageDatabaseEnv({ buildId: "abc" });

  const databaseTwo = createSqliteDatabase({
    common: context.common,
    schema: schemaTwo,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  await expect(() =>
    databaseTwo.manageDatabaseEnv({
      buildId: "def",
    }),
  ).rejects.toThrow(
    "Failed to acquire lock on database file 'public.db'. A different Ponder app is actively using this database.",
  );

  await database.kill();
  await databaseTwo.kill();
});

test("setup throws if there is a table name collision", async (context) => {
  if (context.databaseConfig.kind !== "sqlite") return;
  const database = createSqliteDatabase({
    common: context.common,
    schema,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  await database.orm.internal.executeQuery(
    sql`CREATE TABLE public.'Pet' (id TEXT)`.compile(database.orm.internal),
  );

  expect(await getTableNames(database.orm.internal, "public")).toStrictEqual([
    "Pet",
  ]);

  await expect(() =>
    database.manageDatabaseEnv({ buildId: "abc" }),
  ).rejects.toThrow(
    "Unable to create table 'Pet' in 'public.db' because a table with that name already exists. Is there another application using the 'public.db' database file?",
  );

  await database.kill();
});

test("heartbeat updates the heartbeat_at value", async (context) => {
  if (context.databaseConfig.kind !== "sqlite") return;
  context.common.options.databaseHeartbeatInterval = 250;
  context.common.options.databaseHeartbeatTimeout = 625;

  const database = createSqliteDatabase({
    common: context.common,
    schema,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });
  await database.manageDatabaseEnv({ buildId: "abc" });

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
    BigInt(JSON.parse(rowAfterHeartbeat!.value!).heartbeat_at),
  ).toBeGreaterThan(BigInt(JSON.parse(row!.value!).heartbeat_at));

  await database.kill();
});

test("updateFinalizedCheckpoint updates lock table", async (context) => {
  if (context.databaseConfig.kind !== "sqlite") return;
  const database = createSqliteDatabase({
    common: context.common,
    schema,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  await database.manageDatabaseEnv({
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

  expect(JSON.parse(row!.value!).checkpoint).toStrictEqual(
    encodeCheckpoint(maxCheckpoint),
  );

  await database.kill();
});

test("kill releases the namespace lock", async (context) => {
  if (context.databaseConfig.kind !== "sqlite") return;
  const database = createSqliteDatabase({
    common: context.common,
    schema,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  await database.manageDatabaseEnv({ buildId: "abc" });

  const row = await database.orm.internal
    .selectFrom("_ponder_meta")
    .where("key", "=", "app")
    .select("value")
    .executeTakeFirst();

  await database.kill();

  // Only creating this database to use the `orm` object.
  const databaseTwo = createSqliteDatabase({
    common: context.common,
    schema: schemaTwo,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  const rowAfterKill = await databaseTwo.orm.internal
    .selectFrom("_ponder_meta")
    .where("key", "=", "app")
    .select("value")
    .executeTakeFirst();

  expect(JSON.parse(row!.value!).is_locked).toBe(true);
  expect(JSON.parse(rowAfterKill!.value!).is_locked).toBe(false);

  await databaseTwo.kill();
});

test("createIndexes adds a single column index", async (context) => {
  if (context.databaseConfig.kind !== "sqlite") return;
  const database = createSqliteDatabase({
    common: context.common,
    schema,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  await database.manageDatabaseEnv({ buildId: "abc" });

  await database.createIndexes({ schema });

  const indexes = await getIndexNames(
    database.orm.internal,
    "Person",
    "public",
  );

  expect(indexes).toHaveLength(2);

  expect(indexes).toContain("Person_nameIndex");

  await database.kill();
});

test("createIndexes adds a multi column index", async (context) => {
  if (context.databaseConfig.kind !== "sqlite") return;
  const database = createSqliteDatabase({
    common: context.common,
    schema,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  await database.manageDatabaseEnv({ buildId: "abc" });

  await database.createIndexes({ schema });

  const indexes = await getIndexNames(database.orm.internal, "Pet", "public");

  expect(indexes).toHaveLength(2);

  expect(indexes).toContain("Pet_multiIndex");

  await database.kill();
});

test("createIndexes with ordering", async (context) => {
  if (context.databaseConfig.kind !== "sqlite") return;

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

  const database = createSqliteDatabase({
    common: context.common,
    schema,
    databaseConfig: {
      kind: "sqlite",
      directory: context.databaseConfig.directory,
    },
  });

  await database.manageDatabaseEnv({ buildId: "abc" });

  await database.createIndexes({ schema });

  const indexes = await getIndexNames(database.orm.internal, "Kevin", "public");

  expect(indexes).toHaveLength(2);

  expect(indexes).toContain("Kevin_kevinIndex");

  await database.kill();
});

test(
  "setup with the same build ID drops indexes",
  async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = createSqliteDatabase({
      common: context.common,
      schema,
      databaseConfig: {
        kind: "sqlite",
        directory: context.databaseConfig.directory,
      },
    });

    await database.manageDatabaseEnv({ buildId: "abc" });

    await database.createIndexes({ schema });

    await database.kill();

    const databaseTwo = createSqliteDatabase({
      common: context.common,
      schema,
      databaseConfig: {
        kind: "sqlite",
        directory: context.databaseConfig.directory,
      },
    });

    await databaseTwo.manageDatabaseEnv({ buildId: "abc" });

    const indexes = await getIndexNames(
      databaseTwo.orm.internal,
      "Person",
      "public",
    );

    expect(indexes).toStrictEqual(["sqlite_autoindex_Person_1"]);

    await databaseTwo.kill();
  },
  { timeout: 30_000 },
);

async function getTableNames(db: HeadlessKysely<any>, schemaName?: string) {
  const { rows } = await db.executeQuery<{ name: string }>(
    sql`SELECT name FROM ${sql.raw(
      schemaName ? `${schemaName}.` : "",
    )}sqlite_master WHERE type='table'`.compile(db),
  );
  return rows.map((r) => r.name);
}

async function getIndexNames(
  db: HeadlessKysely<any>,
  tableName: string,
  schemaName?: string,
) {
  const { rows } = await db.executeQuery<{ name: string; tbl_name: string }>(
    sql`SELECT name, tbl_name FROM ${sql.raw(
      schemaName ? `${schemaName}.` : "",
    )}sqlite_master WHERE type='index' AND tbl_name='${sql.raw(tableName)}'`.compile(
      db,
    ),
  );
  return rows.map((r) => r.name);
}
