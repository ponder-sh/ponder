import { setupIsolatedDatabase } from "@/_test/setup.js";
import { getTableIds } from "@/_test/utils.js";
import { SqliteIndexingStore } from "@/indexing-store/sqlite/store.js";
import { createSchema } from "@/schema/schema.js";
import {
  type Checkpoint,
  encodeCheckpoint,
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

    await database.setup({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    // Cache database, metadata tables, and cache tables were created
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

    await database.setup({
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

    await databaseTwo.setup({
      schema: schemaTwo,
      tableIds: getTableIds(schemaTwo),
      functionIds: {},
      tableAccess: {},
    });

    // New tables were created
    expect(await getTableNames(databaseTwo.db)).toStrictEqual(["Dog", "Apple"]);

    await databaseTwo.kill();
  });

  test("setup with cache hit", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: { function: "0xfunction" },
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
        { id: "11", name: "Fido", age: 3, kind: "DOG" },
        { id: "12", name: "Fido", age: 3, kind: "DOG" },
        { id: "13", name: "Fido", age: 3, kind: "DOG" },
      ],
    });

    await database.flush([
      {
        functionId: "0xfunction",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(1),
        eventCount: 3,
      },
    ]);

    const { rows: instancePetRows1 } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );
    expect(instancePetRows1).toHaveLength(3);

    await database.kill();

    const databaseTwo = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await databaseTwo.setup({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: { function: "0xfunction" },
      tableAccess: {},
    });

    const { rows: instancePetRows } = await databaseTwo.db.executeQuery(
      sql`SELECT * FROM "Pet"`.compile(databaseTwo.db),
    );

    expect(instancePetRows).length(3);

    expect(databaseTwo.functionMetadata).toStrictEqual([
      {
        functionId: "0xfunction",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(1),
        eventCount: 3,
      },
    ]);

    await databaseTwo.kill();
  });

  test("publish is a no-op", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup({
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

    await database.setup({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {
        function: {
          access: [
            {
              storeMethod: "create",
              tableName: "Pet",
            },
          ],
          hash: "",
        },
      },
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
        functionId: "0xfunction",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(1),
        eventCount: 3,
      },
    ]);

    const { rows: metadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsAfter).toStrictEqual([
      {
        function_id: "0xfunction",
        function_name: "function",
        from_checkpoint: null,
        hash_version: 1,
        to_checkpoint: encodeCheckpoint(createCheckpoint(1)),
        event_count: 3,
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );
    expect(petRowsAfter).length(3);

    await database.kill();
  });

  test("flush with no new rows", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {
        function: {
          access: [
            {
              storeMethod: "create",
              tableName: "Pet",
            },
          ],
          hash: "",
        },
      },
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

    await database.flush([
      {
        functionId: "0xfunction",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(1),
        eventCount: 3,
      },
    ]);

    await database.flush([
      {
        functionId: "0xfunction",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(2),
        eventCount: 3,
      },
    ]);

    const { rows: metadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsAfter).toStrictEqual([
      {
        function_id: "0xfunction",
        function_name: "function",
        from_checkpoint: null,
        hash_version: 1,
        to_checkpoint: encodeCheckpoint(createCheckpoint(2)),
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

    await database.setup({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {
        function: {
          access: [
            {
              storeMethod: "create",
              tableName: "Pet",
            },
          ],
          hash: "",
        },
      },
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
        functionId: "0xfunction",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(1),
        eventCount: 3,
      },
    ]);

    await indexingStore.createMany({
      tableName: "Pet",
      checkpoint: createCheckpoint(2),
      data: [
        { id: "11", name: "Fido", age: 3, kind: "DOG" },
        { id: "12", name: "Fido", age: 3, kind: "DOG" },
        { id: "13", name: "Fido", age: 3, kind: "DOG" },
      ],
    });

    await database.flush([
      {
        functionId: "0xfunction",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(3),
        eventCount: 6,
      },
    ]);

    const { rows: metadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsAfter).toStrictEqual([
      {
        function_id: "0xfunction",
        function_name: "function",
        from_checkpoint: null,
        hash_version: 1,
        to_checkpoint: encodeCheckpoint(createCheckpoint(3)),
        event_count: 6,
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );

    expect(petRowsAfter).length(6);

    await database.kill();
  });

  test("flush updates cache tables with new rows", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {
        function: {
          access: [
            {
              storeMethod: "create",
              tableName: "Pet",
            },
          ],
          hash: "",
        },
      },
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
        functionId: "0xfunction",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(1),
        eventCount: 3,
      },
    ]);

    await indexingStore.update({
      tableName: "Pet",
      checkpoint: createCheckpoint(2),
      id: "1",
      data: { name: "Fido", age: 4, kind: "DOG" },
    });
    await indexingStore.update({
      tableName: "Pet",
      checkpoint: createCheckpoint(2),
      id: "2",
      data: { name: "Fido", age: 4, kind: "DOG" },
    });
    await indexingStore.update({
      tableName: "Pet",
      checkpoint: createCheckpoint(3),
      id: "1",
      data: { name: "Fido", age: 5, kind: "DOG" },
    });

    await database.flush([
      {
        functionId: "0xfunction",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(3),
        eventCount: 4,
      },
    ]);

    const { rows: metadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsAfter).toStrictEqual([
      {
        function_id: "0xfunction",
        function_name: "function",
        from_checkpoint: null,
        hash_version: 1,
        to_checkpoint: encodeCheckpoint(createCheckpoint(3)),
        event_count: 4,
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );

    expect(petRowsAfter).length(6);

    await database.kill();
  });

  test("flush updates cache tables when multiple versions of same id", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {
        function: {
          access: [
            {
              storeMethod: "create",
              tableName: "Pet",
            },
          ],
          hash: "",
        },
      },
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

    await indexingStore.update({
      tableName: "Pet",
      checkpoint: createCheckpoint(2),
      id: "1",
      data: { name: "Fido", age: 4, kind: "DOG" },
    });

    await database.flush([
      {
        functionId: "0xfunction",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(2),
        eventCount: 3,
      },
    ]);

    await indexingStore.update({
      tableName: "Pet",
      checkpoint: createCheckpoint(3),
      id: "2",
      data: { name: "Fido", age: 4, kind: "DOG" },
    });
    await indexingStore.update({
      tableName: "Pet",
      checkpoint: createCheckpoint(3),
      id: "1",
      data: { name: "Fido", age: 5, kind: "DOG" },
    });

    console.log("before");

    await database.flush([
      {
        functionId: "0xfunction",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(3),
        eventCount: 4,
      },
    ]);

    const { rows: metadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsAfter).toStrictEqual([
      {
        function_id: "0xfunction",
        function_name: "function",
        from_checkpoint: null,
        hash_version: 1,
        to_checkpoint: encodeCheckpoint(createCheckpoint(3)),
        event_count: 4,
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );

    expect(petRowsAfter).length(6);

    await database.kill();
  });

  test("flush with table checkpoints", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {
        function1: {
          access: [
            {
              storeMethod: "create",
              tableName: "Pet",
            },
          ],
          hash: "",
        },
        function2: {
          access: [
            {
              storeMethod: "upsert",
              tableName: "Pet",
            },
          ],
          hash: "",
        },
        function3: {
          access: [
            {
              storeMethod: "create",
              tableName: "Person",
            },
            {
              storeMethod: "findUnique",
              tableName: "Pet",
            },
          ],
          hash: "",
        },
      },
    });

    await database.flush([
      {
        functionId: "0xfunction1",
        functionName: "function1",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(4),
        eventCount: 3,
      },
      {
        functionId: "0xfunction2",
        functionName: "function2",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(5),
        eventCount: 3,
      },
      {
        functionId: "0xfunction3",
        functionName: "function3",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(12),
        eventCount: 3,
      },
    ]);

    const { rows: functionMetadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(functionMetadataRowsAfter).toStrictEqual([
      {
        function_id: "0xfunction1",
        function_name: "function1",
        from_checkpoint: null,
        hash_version: 1,
        to_checkpoint: encodeCheckpoint(createCheckpoint(4)),
        event_count: 3,
      },
      {
        function_id: "0xfunction2",
        function_name: "function2",
        from_checkpoint: null,
        hash_version: 1,
        to_checkpoint: encodeCheckpoint(createCheckpoint(5)),
        event_count: 3,
      },
      {
        function_id: "0xfunction3",
        function_name: "function3",
        from_checkpoint: null,
        hash_version: 1,
        to_checkpoint: encodeCheckpoint(createCheckpoint(12)),
        event_count: 3,
      },
    ]);

    const { rows: tableMetadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.table_metadata`.compile(database.db),
    );
    expect(tableMetadataRowsAfter).toStrictEqual([
      {
        hash_version: 1,
        table_id: "0xPet",
        table_name: "Pet",
        to_checkpoint: encodeCheckpoint(createCheckpoint(5)),
        schema: expect.any(String),
      },
      {
        hash_version: 1,
        table_id: "0xPerson",
        table_name: "Person",
        to_checkpoint: encodeCheckpoint(createCheckpoint(12)),
        schema: expect.any(String),
      },
    ]);

    await database.kill();
  });

  test("flush with truncated tables", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {
        function: {
          access: [
            {
              storeMethod: "create",
              tableName: "Pet",
            },
          ],
          hash: "",
        },
      },
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

    await database.flush([
      {
        functionId: "0xfunction",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(1),
        eventCount: 3,
      },
    ]);

    await indexingStore.update({
      tableName: "Pet",
      checkpoint: createCheckpoint(2),
      id: "1",
      data: { name: "Fido", age: 4, kind: "DOG" },
    });
    await indexingStore.update({
      tableName: "Pet",
      checkpoint: createCheckpoint(2),
      id: "2",
      data: { name: "Fido", age: 4, kind: "DOG" },
    });
    await indexingStore.update({
      tableName: "Pet",
      checkpoint: createCheckpoint(3),
      id: "1",
      data: { name: "Fido", age: 5, kind: "DOG" },
    });

    await database.flush([
      {
        functionId: "0xfunction",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(2),
        eventCount: 4,
      },
    ]);

    const { rows: metadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsAfter).toStrictEqual([
      {
        function_id: "0xfunction",
        function_name: "function",
        from_checkpoint: null,
        hash_version: 1,
        to_checkpoint: encodeCheckpoint(createCheckpoint(2)),
        event_count: 4,
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );

    expect(petRowsAfter).toContainEqual({
      id: "1",
      age: expect.any(Number),
      bigAge: null,
      kind: expect.any(String),
      name: expect.any(String),
      effective_from: encodeCheckpoint(createCheckpoint(2)),
      effective_to: "latest",
    });

    expect(petRowsAfter).length(5);

    await database.kill();
  });

  test("kill", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup({
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
