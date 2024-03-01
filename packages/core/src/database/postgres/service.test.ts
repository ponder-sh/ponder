import { setupIsolatedDatabase } from "@/_test/setup.js";
import { getTableIds } from "@/_test/utils.js";
import { PostgresIndexingStore } from "@/indexing-store/postgres/store.js";
import { createSchema } from "@/schema/schema.js";
import {
  type Checkpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { Kysely, sql } from "kysely";
import { beforeEach, describe, expect, test } from "vitest";
import { PostgresDatabaseService } from "./service.js";

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

const shouldSkip = process.env.DATABASE_URL === undefined;

describe.skipIf(shouldSkip)("postgres database", () => {
  test("setup with fresh database", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup();

    // Cache schema and cache metadata tables were created
    expect(await getTableNames(database.db, "ponder_cache")).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "function_metadata",
      "table_metadata",
    ]);

    // Public schema and public metadata table was created
    expect(await getTableNames(database.db, "ponder")).toStrictEqual([
      "_metadata",
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
      "Pet",
      "Person",
    ]);

    // Instance tables were created in the instance schema
    expect(await getTableNames(database.db, "ponder_instance_1")).toStrictEqual(
      ["Pet", "Person"],
    );

    // Row was inserted to public metadata
    const { rows: metadataRows } = await database.db.executeQuery(
      sql`SELECT * FROM ponder._metadata`.compile(database.db),
    );
    expect(metadataRows).toEqual([
      {
        created_at: expect.any(Number),
        heartbeat_at: expect.any(Number),
        instance_id: 1,
        published_at: null,
        schema: schema,
      },
    ]);

    // No views were created in public
    expect(await getViewNames(database.db, "ponder")).toStrictEqual([]);

    await database.kill();
  });

  test("setup with cache hit", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    // TODO add some data and then flush
    const indexingStoreConfig = database.getIndexingStoreConfig();
    const indexingStore = new PostgresIndexingStore({
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
        functionId: "function",
        functionName: "function",
        fromCheckpoint: null,
        toCheckpoint: createCheckpoint(1),
        eventCount: 3,
      },
    ]);

    await database.kill();

    const databaseTwo = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await databaseTwo.setup();
    await databaseTwo.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: { function: "function" },
      tableAccess: {},
    });

    const { rows: instancePetRows } = await databaseTwo.db.executeQuery(
      sql`SELECT * FROM ponder_instance_2."Pet"`.compile(databaseTwo.db),
    );

    console.log(instancePetRows);
    // expect(instancePetRows).length(3);

    // expect(databaseTwo.functionMetadata).toStrictEqual([
    //   {
    //     functionId: "function",
    //     fromCheckpoint: null,
    //     toCheckpoint: createCheckpoint(1),
    //     eventCount: 3,
    //   },
    // ]);

    await databaseTwo.kill();
  });

  test.todo("setup with cache hit, truncate required");

  test("publish with fresh database", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    await database.publish();

    // Views were created in public
    expect(await getViewNames(database.db, "ponder")).toStrictEqual([
      "Pet",
      "Person",
    ]);

    // Public metadata row was updated to include "published_at"
    const { rows: metadataRows } = await database.db.executeQuery(
      sql`SELECT * FROM ponder._metadata`.compile(database.db),
    );
    expect(metadataRows).toEqual([
      {
        created_at: expect.any(Number),
        heartbeat_at: expect.any(Number),
        instance_id: 1,
        published_at: expect.any(Number),
        schema: schema,
      },
    ]);

    await database.kill();
  });

  test("publish with another instance live", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    const databaseTwo = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });
    await databaseTwo.setup();
    await databaseTwo.reset({
      schema: schemaTwo,
      tableIds: getTableIds(schemaTwo),
      functionIds: {},
      tableAccess: {},
    });
    await databaseTwo.publish();

    expect(await getViewNames(database.db, "ponder")).toStrictEqual([
      "Dog",
      "Apple",
    ]);

    const { rows: firstMetadataRows } = await database.db.executeQuery(
      sql`SELECT * FROM ponder._metadata ORDER BY instance_id asc`.compile(
        database.db,
      ),
    );
    expect(firstMetadataRows).toEqual([
      {
        created_at: expect.any(Number),
        heartbeat_at: expect.any(Number),
        instance_id: 1,
        published_at: null,
        schema: schema,
      },
      {
        created_at: expect.any(Number),
        heartbeat_at: expect.any(Number),
        instance_id: 2,
        published_at: expect.any(Number),
        schema: schemaTwo,
      },
    ]);

    await database.publish();

    // Previous views were dropped from public
    expect(await getViewNames(database.db, "ponder")).toStrictEqual([
      "Pet",
      "Person",
    ]);

    // Public metadata row was updated to include "published_at"
    const { rows: metadataRows } = await database.db.executeQuery(
      sql`SELECT * FROM ponder._metadata ORDER BY instance_id asc`.compile(
        database.db,
      ),
    );
    expect(metadataRows).toEqual([
      {
        created_at: expect.any(Number),
        heartbeat_at: expect.any(Number),
        instance_id: 1,
        published_at: expect.any(Number),
        schema: schema,
      },
      {
        created_at: expect.any(Number),
        heartbeat_at: expect.any(Number),
        instance_id: 2,
        published_at: expect.any(Number),
        schema: schemaTwo,
      },
    ]);

    await database.kill();
    await databaseTwo.kill();
  });

  test("publish twice for same instance", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    await database.publish();

    await expect(() => database.publish()).rejects.toThrowError(
      "Invariant violation: Attempted to publish twice within one process.",
    );

    await database.kill();
  });

  test("flush with no existing cache tables", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    const indexingStoreConfig = database.getIndexingStoreConfig();
    const indexingStore = new PostgresIndexingStore({
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
      sql`SELECT * FROM ponder_instance_1."Pet"`.compile(database.db),
    );
    expect(instancePetRows).toHaveLength(3);

    const { rows: metadataRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsBefore).toStrictEqual([]);

    const { rows: petRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."Pet"`.compile(database.db),
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

    const { rows: metadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsAfter).toStrictEqual([
      {
        function_id: "function",
        function_name: "function",
        from_checkpoint: null,
        to_checkpoint: encodeCheckpoint(zeroCheckpoint),
        event_count: 3,
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."Pet"`.compile(database.db),
    );
    expect(petRowsAfter).length(3);

    await database.kill();
  });

  test("flush with existing cache tables", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    const indexingStoreConfig = database.getIndexingStoreConfig();
    const indexingStore = new PostgresIndexingStore({
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
      sql`SELECT * FROM ponder_instance_1."Pet"`.compile(database.db),
    );
    expect(instancePetRows).toHaveLength(3);

    const { rows: metadataRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsBefore).toStrictEqual([]);

    const { rows: petRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."Pet"`.compile(database.db),
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
        functionName: "function",
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
        function_name: "function",
        from_checkpoint: null,
        to_checkpoint: encodeCheckpoint(maxCheckpoint),
        event_count: 6,
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."Pet"`.compile(database.db),
    );
    expect(petRowsAfter).length(6);

    await database.kill();
  });

  test("flush with partial cache tables", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    const indexingStoreConfig = database.getIndexingStoreConfig();
    const indexingStore = new PostgresIndexingStore({
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
      sql`SELECT * FROM ponder_instance_1."Pet"`.compile(database.db),
    );
    expect(instancePetRows).toHaveLength(3);

    const { rows: metadataRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(metadataRowsBefore).toStrictEqual([]);

    const { rows: petRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."Pet"`.compile(database.db),
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
        functionName: "function",

        fromCheckpoint: null,
        toCheckpoint: maxCheckpoint,
        eventCount: 6,
      },
      {
        functionId: "function1",
        functionName: "function1",
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
        function_name: "function",
        from_checkpoint: null,
        to_checkpoint: encodeCheckpoint(maxCheckpoint),
        event_count: 6,
      },
      {
        function_id: "function1",
        function_name: "function1",
        from_checkpoint: null,
        to_checkpoint: encodeCheckpoint(zeroCheckpoint),
        event_count: 0,
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."Pet"`.compile(database.db),
    );
    expect(petRowsAfter).length(6);

    await database.kill();
  });

  test.todo("flush with less cache tables");

  test("kill before publish", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    await database.kill();

    const tempDb = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    // Instance schema was dropped
    expect(await getTableNames(tempDb.db, "ponder_instance_1")).toStrictEqual(
      [],
    );

    await tempDb.db.destroy();
  });

  test("kill after publish", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    await database.publish();

    await database.kill();

    const tempDb = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    // Instance schema was not dropped
    expect(await getTableNames(tempDb.db, "ponder_instance_1")).toStrictEqual([
      "Pet",
      "Person",
    ]);

    // Views are still present in public schema
    expect(await getViewNames(tempDb.db, "ponder")).toStrictEqual([
      "Pet",
      "Person",
    ]);

    await tempDb.db.destroy();
  });

  test("kill after publish with another instance live", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });
    await database.publish();

    const otherDatabase = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await otherDatabase.setup();
    await otherDatabase.reset({
      schema: schemaTwo,
      tableIds: getTableIds(schemaTwo),
      functionIds: {},
      tableAccess: {},
    });
    await otherDatabase.publish();

    await database.kill();

    const tempDb = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    // Instance schema was dropped
    expect(await getTableNames(tempDb.db, "ponder_instance_1")).toStrictEqual(
      [],
    );

    // Other instance views are still present in public schema
    expect(await getViewNames(tempDb.db, "ponder")).toStrictEqual([
      "Dog",
      "Apple",
    ]);

    await tempDb.db.destroy();

    await otherDatabase.kill();
  });
});

async function getTableNames(db: Kysely<any>, schemaName: string) {
  const { rows } = await db.executeQuery<{
    table_name: string;
  }>(
    sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = '${sql.raw(schemaName)}'
    `.compile(db),
  );
  return rows.map((r) => r.table_name);
}

async function getViewNames(db: Kysely<any>, schemaName: string) {
  const { rows } = await db.executeQuery<{
    table_name: string;
  }>(
    sql`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = '${sql.raw(schemaName)}'
    `.compile(db),
  );
  return rows.map((r) => r.table_name);
}
