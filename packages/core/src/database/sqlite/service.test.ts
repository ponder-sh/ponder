import { setupIsolatedDatabase } from "@/_test/setup.js";
import { getTableIds } from "@/_test/utils.js";
import { SqliteIndexingStore } from "@/indexing-store/sqlite/store.js";
import { createSchema } from "@/schema/schema.js";
import { type Checkpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
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

    // Instance tables and views were created in the public schema
    expect(await getTableNames(database.db)).toStrictEqual([
      "_raw_Pet",
      "_raw_Person",
    ]);
    expect(await getViewNames(database.db)).toStrictEqual(["Pet", "Person"]);

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

    // Old tables and views still exist
    expect(await getTableNames(databaseTwo.db)).toStrictEqual([
      "_raw_Pet",
      "_raw_Person",
    ]);
    expect(await getViewNames(databaseTwo.db)).toStrictEqual(["Pet", "Person"]);

    await databaseTwo.setup({
      schema: schemaTwo,
      tableIds: getTableIds(schemaTwo),
      functionIds: {},
      tableAccess: {},
    });

    // New tables and views were created
    expect(await getTableNames(databaseTwo.db)).toStrictEqual([
      "_raw_Dog",
      "_raw_Apple",
    ]);
    expect(await getViewNames(databaseTwo.db)).toStrictEqual(["Dog", "Apple"]);

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

  test("kill", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup({
      schema: schema,
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

async function getViewNames(db: Kysely<any>, schemaName?: string) {
  const { rows } = await db.executeQuery<{ name: string }>(
    sql`SELECT name FROM ${sql.raw(
      schemaName ? `${schemaName}.` : "",
    )}sqlite_master WHERE type='view'`.compile(db),
  );
  return rows.map((r) => r.name);
}
