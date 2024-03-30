import { setupIsolatedDatabase } from "@/_test/setup.js";
import { createSchema } from "@/schema/schema.js";
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

    await database.setup({
      schema: schema,
    });

    expect(await getTableNames(database.db)).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "logs",
      "Pet",
      "Person",
    ]);

    await database.kill();
  });

  test("setup with existing tables", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup({
      schema,
    });
    await database.kill();

    const databaseTwo = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await databaseTwo.setup({
      schema: schemaTwo,
    });

    expect(await getTableNames(databaseTwo.db)).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "logs",
      "Dog",
      "Apple",
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
      schema,
    });

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
