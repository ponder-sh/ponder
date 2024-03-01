import { setupIsolatedDatabase } from "@/_test/setup.js";
import { getTableIds } from "@/_test/utils.js";
import { SqliteIndexingStore } from "@/indexing-store/sqlite/store.js";
import { createSchema } from "@/schema/schema.js";
import {
  type Checkpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { Kysely, sql } from "kysely";
import { beforeEach, describe, expect, test } from "vitest";
import { SqliteDatabaseService } from "./service.js";

beforeEach(setupIsolatedDatabase);

const schema = createSchema((p) => ({
  PetKind: p.createEnum(["CAT", "DOG"]),
  Pet: p.createTable({
    id: p.string(),
    name: p.string(),
    age: p.int().optional(),
    bigAge: p.bigint().optional(),
    kind: p.enum("PetKind").optional(),
  }),
  Person: p.createTable({
    id: p.string(),
    name: p.string(),
  }),
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

const shouldSkip = process.env.DATABASE_URL !== undefined;

describe.skipIf(shouldSkip)("sqlite database", () => {
  test("setup with fresh database", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup();

    // Cache database and metadata tables were created
    expect(await getTableNames(database.db, "ponder_cache")).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "function_metadata",
      "table_metadata",
    ]);

    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    // Instance tables were created in the cache schema
    expect(await getTableNames(database.db, "ponder_cache")).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "function_metadata",
      "table_metadata",
      "0xPet",
      "0xPerson",
    ]);

    // Instance tables were created in the public schema
    expect(await getTableNames(database.db)).toStrictEqual(["Pet", "Person"]);

    await database.kill();
  });

  test("setup with existing tables", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });
    await database.kill();

    const databaseTwo = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    // Old tables still exist
    expect(await getTableNames(databaseTwo.db)).toStrictEqual([
      "Pet",
      "Person",
    ]);

    await databaseTwo.setup();

    // Existing tables were deleted
    expect(await getTableNames(databaseTwo.db)).toStrictEqual([]);

    await databaseTwo.reset({
      schema: schemaTwo,
      tableIds: getTableIds(schemaTwo),
      functionIds: {},
      tableAccess: {},
    });

    // New tables were created
    expect(await getTableNames(databaseTwo.db)).toStrictEqual(["Dog", "Apple"]);

    await databaseTwo.kill();
  });

  test.todo("setup with cache hit");

  test.todo("setup with cache hit, truncate required");

  test("publish is a no-op", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    await database.publish();

    await expect(database.publish()).resolves.not.toThrow();

    await database.kill();
  });

  test("flush with no existing cache tables", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    const indexingStoreConfig = database.getIndexingStoreConfig();
    const indexingStore = new SqliteIndexingStore({
      common: context.common,
      ...indexingStoreConfig,
      schema,
    });
    await indexingStore.createMany({
      tableName: "Pet",
      checkpoint: createCheckpoint(1),
      data: [
        { id: "1", name: "Fido", age: 3, kind: "DOG" },
        { id: "2", name: "Fido", age: 3, kind: "DOG" },
        { id: "3", name: "Fido", age: 3, kind: "DOG" },
      ],
    });

    const { rows: instancePetRows } = await database.db.executeQuery(
      sql`SELECT * FROM "Pet"`.compile(database.db),
    );
    expect(instancePetRows).toHaveLength(3);

    const { rows: metadataRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsBefore).toStrictEqual([]);

    const { rows: petRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );
    expect(petRowsBefore).toStrictEqual([]);

    await database.flush([
      {
        functionId: "function",
        functionName: "0xfunction",
        fromCheckpoint: null,
        toCheckpoint: zeroCheckpoint,
        eventCount: 3,
      },
    ]);

    const { rows: metadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsAfter).toStrictEqual([
      {
        function_id: "function",
        function_name: "0xfunction",
        from_checkpoint: null,
        to_checkpoint: encodeCheckpoint(zeroCheckpoint),
        event_count: 3,
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );
    expect(petRowsAfter).length(3);

    await database.kill();
  });

  test("flush with existing cache tables", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    const indexingStoreConfig = database.getIndexingStoreConfig();
    const indexingStore = new SqliteIndexingStore({
      common: context.common,
      ...indexingStoreConfig,
      schema,
    });
    await indexingStore.createMany({
      tableName: "Pet",
      checkpoint: createCheckpoint(1),
      data: [
        { id: "1", name: "Fido", age: 3, kind: "DOG" },
        { id: "2", name: "Fido", age: 3, kind: "DOG" },
        { id: "3", name: "Fido", age: 3, kind: "DOG" },
      ],
    });

    const { rows: instancePetRows } = await database.db.executeQuery(
      sql`SELECT * FROM "Pet"`.compile(database.db),
    );
    expect(instancePetRows).toHaveLength(3);

    const { rows: metadataRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsBefore).toStrictEqual([]);

    const { rows: petRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );
    expect(petRowsBefore).toStrictEqual([]);

    await database.flush([
      {
        functionId: "function",
        functionName: "0xfunction",
        fromCheckpoint: null,
        toCheckpoint: zeroCheckpoint,
        eventCount: 3,
      },
    ]);

    await indexingStore.createMany({
      tableName: "Pet",
      checkpoint: createCheckpoint(1),
      data: [
        { id: "11", name: "Fido", age: 3, kind: "DOG" },
        { id: "12", name: "Fido", age: 3, kind: "DOG" },
        { id: "13", name: "Fido", age: 3, kind: "DOG" },
      ],
    });

    await database.flush([
      {
        functionId: "function",
        functionName: "0xfunction",
        fromCheckpoint: null,
        toCheckpoint: maxCheckpoint,
        eventCount: 6,
      },
    ]);

    const { rows: metadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsAfter).toStrictEqual([
      {
        function_id: "function",
        function_name: "0xfunction",
        from_checkpoint: null,
        to_checkpoint: encodeCheckpoint(maxCheckpoint),
        event_count: 6,
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );
    expect(petRowsAfter).length(6);

    await database.kill();
  });

  test("flush with partial cache tables", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    const indexingStoreConfig = database.getIndexingStoreConfig();
    const indexingStore = new SqliteIndexingStore({
      common: context.common,
      ...indexingStoreConfig,
      schema,
    });
    await indexingStore.createMany({
      tableName: "Pet",
      checkpoint: createCheckpoint(1),
      data: [
        { id: "1", name: "Fido", age: 3, kind: "DOG" },
        { id: "2", name: "Fido", age: 3, kind: "DOG" },
        { id: "3", name: "Fido", age: 3, kind: "DOG" },
      ],
    });

    const { rows: instancePetRows } = await database.db.executeQuery(
      sql`SELECT * FROM "Pet"`.compile(database.db),
    );
    expect(instancePetRows).toHaveLength(3);

    const { rows: metadataRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsBefore).toStrictEqual([]);

    const { rows: petRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );
    expect(petRowsBefore).toStrictEqual([]);

    await database.flush([
      {
        functionId: "function",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: zeroCheckpoint,
        eventCount: 3,
      },
    ]);

    await indexingStore.createMany({
      tableName: "Pet",
      checkpoint: createCheckpoint(1),
      data: [
        { id: "11", name: "Fido", age: 3, kind: "DOG" },
        { id: "12", name: "Fido", age: 3, kind: "DOG" },
        { id: "13", name: "Fido", age: 3, kind: "DOG" },
      ],
    });

    await database.flush([
      {
        functionId: "function",
        functionName: "0xfunction",
        fromCheckpoint: null,
        toCheckpoint: maxCheckpoint,
        eventCount: 6,
      },
      {
        functionId: "function1",
        functionName: "0xfunction1",
        fromCheckpoint: null,
        toCheckpoint: zeroCheckpoint,
        eventCount: 0,
      },
    ]);

    const { rows: metadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsAfter).toStrictEqual([
      {
        function_id: "function",
        function_name: "0xfunction",
        from_checkpoint: null,
        to_checkpoint: encodeCheckpoint(maxCheckpoint),
        event_count: 6,
      },
      {
        function_id: "function1",
        function_name: "0xfunction1",
        from_checkpoint: null,
        to_checkpoint: encodeCheckpoint(zeroCheckpoint),
        event_count: 0,
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );
    expect(petRowsAfter).length(6);

    await database.kill();
  });

  test("kill", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    await database.publish();

    await expect(database.kill()).resolves.not.toThrow();
  });
});

async function getTableNames(db: Kysely<any>, schemaName?: string) {
  const { rows } = await db.executeQuery<{ name: string }>(
    sql`SELECT name FROM ${sql.raw(
      schemaName ? `${schemaName}.` : "",
    )}sqlite_master WHERE type='table'`.compile(db),
  );
  return rows.map((r) => r.name);
}
