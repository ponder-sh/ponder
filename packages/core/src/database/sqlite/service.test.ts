import { setupIsolatedDatabase } from "@/_test/setup.js";
import { getTableIds } from "@/_test/utils.js";
import { createSchema } from "@/schema/schema.js";
import {
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
      tableAccess: [],
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
      tableAccess: [],
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
      tableAccess: [],
    });

    // New tables were created
    expect(await getTableNames(databaseTwo.db)).toStrictEqual(["Dog", "Apple"]);

    await databaseTwo.kill();
  });

  test.todo("setup with cache hit", async (context) => {});

  test.todo("setup with cache hit, truncate required", async (context) => {});

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
      tableAccess: [],
    });

    await database.publish();

    await expect(database.publish()).resolves.not.toThrow();

    await database.kill();
  });

  test.todo("flush with fresh database", async (context) => {
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
      tableAccess: [],
    });

    // TODO insert data into instance schema tables

    await database.flush([
      {
        functionId: "function",
        fromCheckpoint: null,
        toCheckpoint: zeroCheckpoint,
        eventCount: 0,
      },
    ]);

    // TODO assert that tables in cache schema now contain rows
    // TODO assert that cache function_metadata table has been updated

    await database.kill();
  });

  test.todo("flush with existing cache tables", async (context) => {});

  test.todo("flush with some partial cache tables", async (context) => {});

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
      tableAccess: [],
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
