import { setupIsolatedDatabase } from "@/_test/setup.js";
import { getTableIds } from "@/_test/utils.js";
import { HistoricalIndexingStore } from "@/indexing-store/historicalStore.js";
import { createSchema } from "@/schema/schema.js";
import { type Checkpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
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
    });

    // Cache database, metadata tables, and cache tables were created
    expect(await getTableNames(database.db, "ponder_cache")).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "function_metadata",
      "table_metadata",
      "instance_metadata",
      "0xPet",
      "0xPerson",
    ]);

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
    });

    const indexingStoreConfig = database.getIndexingStoreConfig();
    const indexingStore = new HistoricalIndexingStore({
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

  test("kill before publish", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup({
      schema: schema,
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
    });
    await database.publish();

    const otherDatabase = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await otherDatabase.setup({
      schema: schemaTwo,
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
