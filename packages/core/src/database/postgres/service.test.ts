import { setupIsolatedDatabase } from "@/_test/setup.js";
import { getTableIds } from "@/_test/utils.js";
import { PostgresIndexingStore } from "@/indexing-store/postgres/store.js";
import { createSchema } from "@/schema/schema.js";
import {
  type Checkpoint,
  encodeCheckpoint,
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

    await database.setup({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    // Cache database, metadata tables, and cache tables were created
    expect(
      (await getTableNames(database.db, "ponder_cache")).sort(),
    ).toStrictEqual(
      [
        "kysely_migration",
        "kysely_migration_lock",
        "function_metadata",
        "table_metadata",
        "instance_metadata",
        "0xPet",
        "0xPerson",
      ].sort(),
    );

    // Instance tables were created in the instance schema
    expect(await getTableNames(database.db, "ponder_instance_1")).toStrictEqual(
      ["Pet", "Person"],
    );

    // Row was inserted to public metadata
    const { rows: metadataRows } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.instance_metadata`.compile(database.db),
    );
    expect(metadataRows).toEqual([
      {
        created_at: expect.any(Number),
        hash_version: 2,
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

    await database.setup({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: { function: "0xfunction" },
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

    const databaseTwo = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await databaseTwo.setup({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: { function: "0xfunction" },
      tableAccess: {},
    });

    const { rows: instancePetRows } = await databaseTwo.db.executeQuery(
      sql`SELECT * FROM ponder_instance_2."Pet"`.compile(databaseTwo.db),
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

  test("publish with fresh database", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup({
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
      "_raw_Pet",
      "_raw_Person",
    ]);

    // Public metadata row was updated to include "published_at"
    const { rows: metadataRows } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.instance_metadata`.compile(database.db),
    );
    expect(metadataRows).toEqual([
      {
        created_at: expect.any(Number),
        hash_version: 2,
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

    await database.setup({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: {},
    });

    const databaseTwo = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });
    await databaseTwo.setup({
      schema: schemaTwo,
      tableIds: getTableIds(schemaTwo),
      functionIds: {},
      tableAccess: {},
    });
    await databaseTwo.publish();

    expect(await getViewNames(database.db, "ponder")).toStrictEqual([
      "Dog",
      "Apple",
      "_raw_Dog",
      "_raw_Apple",
    ]);

    const { rows: firstMetadataRows } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.instance_metadata ORDER BY instance_id asc`.compile(
        database.db,
      ),
    );
    expect(firstMetadataRows).toEqual([
      {
        created_at: expect.any(Number),
        hash_version: 2,
        heartbeat_at: expect.any(Number),
        instance_id: 1,
        published_at: null,
        schema: schema,
      },
      {
        created_at: expect.any(Number),
        hash_version: 2,
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
      "_raw_Pet",
      "_raw_Person",
    ]);

    // Public metadata row was updated to include "published_at"
    const { rows: metadataRows } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.instance_metadata ORDER BY instance_id asc`.compile(
        database.db,
      ),
    );
    expect(metadataRows).toEqual([
      {
        created_at: expect.any(Number),
        hash_version: 2,
        heartbeat_at: expect.any(Number),
        instance_id: 1,
        published_at: expect.any(Number),
        schema: schema,
      },
      {
        created_at: expect.any(Number),
        hash_version: 2,
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

    await database.setup({
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

    const { rows: functionMetadataRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(functionMetadataRowsBefore).toStrictEqual([]);

    const { rows: tableMetadataRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.table_metadata`.compile(database.db),
    );
    expect(tableMetadataRowsBefore).toStrictEqual([]);

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

    const { rows: functionMetadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(functionMetadataRowsAfter).toStrictEqual([
      {
        function_id: "0xfunction",
        function_name: "function",
        from_checkpoint: null,
        hash_version: 2,
        to_checkpoint: encodeCheckpoint(createCheckpoint(1)),
        event_count: 3,
      },
    ]);

    const { rows: tableMetadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.table_metadata`.compile(database.db),
    );
    expect(tableMetadataRowsAfter).toStrictEqual([
      {
        hash_version: 2,
        table_id: "0xPet",
        table_name: "Pet",
        to_checkpoint: encodeCheckpoint(createCheckpoint(1)),
        schema: expect.any(Object),
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );
    expect(petRowsAfter).length(3);

    await database.kill();
  });

  test("flush with no new rows", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
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

    const { rows: functionMetadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(functionMetadataRowsAfter).toStrictEqual([
      {
        function_id: "0xfunction",
        function_name: "function",
        from_checkpoint: null,
        hash_version: 2,
        to_checkpoint: encodeCheckpoint(createCheckpoint(2)),
        event_count: 3,
      },
    ]);

    const { rows: tableMetadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.table_metadata`.compile(database.db),
    );
    expect(tableMetadataRowsAfter).toStrictEqual([
      {
        hash_version: 2,
        table_id: "0xPet",
        table_name: "Pet",
        to_checkpoint: encodeCheckpoint(createCheckpoint(2)),
        schema: expect.any(Object),
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
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

    const { rows: tableMetadataRowsBefore } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.table_metadata`.compile(database.db),
    );
    expect(tableMetadataRowsBefore).toStrictEqual([]);

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
        toCheckpoint: createCheckpoint(2),
        eventCount: 6,
      },
    ]);

    const { rows: functionMetadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
    );
    expect(functionMetadataRowsAfter).toStrictEqual([
      {
        function_id: "0xfunction",
        function_name: "function",
        from_checkpoint: null,
        hash_version: 2,
        to_checkpoint: encodeCheckpoint(createCheckpoint(2)),
        event_count: 6,
      },
    ]);

    const { rows: tableMetadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.table_metadata`.compile(database.db),
    );
    expect(tableMetadataRowsAfter).toStrictEqual([
      {
        hash_version: 2,
        table_id: "0xPet",
        table_name: "Pet",
        to_checkpoint: encodeCheckpoint(createCheckpoint(2)),
        schema: expect.any(Object),
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );
    expect(petRowsAfter).length(6);

    await database.kill();
  });

  test("flush updates cache tables with new rows", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
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
        hash_version: 2,
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

  test("flush updates cache tables with multiple versions of same id", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
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
        hash_version: 2,
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
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
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
        hash_version: 2,
        to_checkpoint: encodeCheckpoint(createCheckpoint(4)),
        event_count: 3,
      },
      {
        function_id: "0xfunction2",
        function_name: "function2",
        from_checkpoint: null,
        hash_version: 2,
        to_checkpoint: encodeCheckpoint(createCheckpoint(5)),
        event_count: 3,
      },
      {
        function_id: "0xfunction3",
        function_name: "function3",
        from_checkpoint: null,
        hash_version: 2,
        to_checkpoint: encodeCheckpoint(createCheckpoint(12)),
        event_count: 3,
      },
    ]);

    const { rows: tableMetadataRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache.table_metadata`.compile(database.db),
    );
    expect(tableMetadataRowsAfter).toStrictEqual([
      {
        hash_version: 2,
        table_id: "0xPet",
        table_name: "Pet",
        to_checkpoint: encodeCheckpoint(createCheckpoint(5)),
        schema: expect.any(Object),
      },
      {
        hash_version: 2,
        table_id: "0xPerson",
        table_name: "Person",
        to_checkpoint: encodeCheckpoint(createCheckpoint(12)),
        schema: expect.any(Object),
      },
    ]);

    await database.kill();
  });

  test("flush with truncated tables", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
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
        hash_version: 2,
        to_checkpoint: encodeCheckpoint(createCheckpoint(2)),
        event_count: 4,
      },
    ]);

    const { rows: petRowsAfter } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_cache."0xPet"`.compile(database.db),
    );

    expect(petRowsAfter).length(5);

    await database.kill();
  });

  test("kill before publish", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup({
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

    await database.setup({
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
      "_raw_Pet",
      "_raw_Person",
    ]);

    await tempDb.db.destroy();
  });

  test("kill after publish with another instance live", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup({
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

    await otherDatabase.setup({
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
      "_raw_Dog",
      "_raw_Apple",
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
