import { setupIsolatedDatabase } from "@/_test/setup.js";
import { createSchema } from "@/schema/schema.js";
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

const shouldSkip = process.env.DATABASE_URL === undefined;

describe.skipIf(shouldSkip)("postgres database", () => {
  test("setup with fresh database", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup({
      schema,
    });

    expect(await getTableNames(database.db, "ponder")).toStrictEqual([
      "logs",
      "Pet",
      "Person",
    ]);

    await database.kill();
  });

  test("setup with existing tables", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup({
      schema,
    });

    await database.kill();

    const databaseTwo = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await databaseTwo.setup({
      schema: schemaTwo,
    });

    expect(await getTableNames(database.db, "ponder")).toStrictEqual([
      "logs",
      "Dog",
      "Apple",
    ]);

    await databaseTwo.kill();
  });

  test("kill", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup({
      schema,
    });

    await expect(database.kill()).resolves.not.toThrow();
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
