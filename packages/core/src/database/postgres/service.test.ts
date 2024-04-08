import { setupIsolatedDatabase } from "@/_test/setup.js";
import { createSchema } from "@/schema/schema.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { hash } from "@/utils/hash.js";
import { sql } from "kysely";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { HeadlessKysely } from "../kysely.js";
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
  test("setup succeeds with a fresh database", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    const { checkpoint } = await database.setup({ schema, buildId: "abc" });

    expect(checkpoint).toMatchObject(zeroCheckpoint);

    expect(await getTableNames(database.db, "ponder")).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "namespace_lock",
      hash(["public", "abc", "Pet"]),
      hash(["public", "abc", "Person"]),
    ]);

    expect(await getTableNames(database.db, "public")).toStrictEqual([
      "Pet",
      "Person",
    ]);

    await database.kill();
  });

  test("setup succeeds with a prior app in the same namespace", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    const { checkpoint } = await database.setup({ schema, buildId: "abc" });
    expect(checkpoint).toMatchObject(zeroCheckpoint);

    await database.kill();

    const databaseTwo = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    expect(await getTableNames(databaseTwo.db, "ponder")).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "namespace_lock",
      hash(["public", "abc", "Pet"]),
      hash(["public", "abc", "Person"]),
    ]);
    expect(await getTableNames(databaseTwo.db, "public")).toStrictEqual([
      "Pet",
      "Person",
    ]);

    await databaseTwo.setup({ schema: schemaTwo, buildId: "def" });

    expect(await getTableNames(databaseTwo.db, "ponder")).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "namespace_lock",
      hash(["public", "def", "Dog"]),
      hash(["public", "def", "Apple"]),
    ]);
    expect(await getTableNames(databaseTwo.db, "public")).toStrictEqual([
      "Dog",
      "Apple",
    ]);

    await databaseTwo.kill();
  });

  test("setup succeeds with a prior app that used the same publish schema", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const config = {
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
      publishSchema: "publish",
    };

    const database = new PostgresDatabaseService(config);
    await database.setup({ schema, buildId: "abc" });
    await database.publish();
    await database.kill();

    const databaseTwo = new PostgresDatabaseService(config);

    expect(await getTableNames(databaseTwo.db, "ponder")).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "namespace_lock",
      hash(["public", "abc", "Pet"]),
      hash(["public", "abc", "Person"]),
    ]);
    expect(await getTableNames(databaseTwo.db, "public")).toStrictEqual([
      "Pet",
      "Person",
    ]);
    expect(await getViewNames(databaseTwo.db, "publish")).toStrictEqual([
      "Pet",
      "Person",
    ]);

    await databaseTwo.setup({ schema: schemaTwo, buildId: "def" });
    await databaseTwo.publish();

    expect(await getTableNames(databaseTwo.db, "ponder")).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "namespace_lock",
      hash(["public", "def", "Dog"]),
      hash(["public", "def", "Apple"]),
    ]);
    expect(await getTableNames(databaseTwo.db, "public")).toStrictEqual([
      "Dog",
      "Apple",
    ]);
    expect(await getViewNames(databaseTwo.db, "publish")).toStrictEqual([
      "Dog",
      "Apple",
    ]);

    await databaseTwo.kill();
  });

  test("setup does not drop tables that are not managed by ponder", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    await database.setup({ schema, buildId: "abc" });
    await database.kill();

    const databaseTwo = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    await databaseTwo.db.executeQuery(
      sql`CREATE TABLE public.not_a_ponder_table (id TEXT)`.compile(
        databaseTwo.db,
      ),
    );
    await databaseTwo.db.executeQuery(
      sql`CREATE TABLE public."AnotherTable" (id TEXT)`.compile(databaseTwo.db),
    );

    expect(await getTableNames(databaseTwo.db, "public")).toStrictEqual([
      "Pet",
      "Person",
      "not_a_ponder_table",
      "AnotherTable",
    ]);

    await databaseTwo.setup({ schema: schemaTwo, buildId: "def" });

    expect(await getTableNames(databaseTwo.db, "public")).toStrictEqual([
      "not_a_ponder_table",
      "AnotherTable",
      "Dog",
      "Apple",
    ]);

    await databaseTwo.kill();
  });

  test.todo(
    "setup with the same build ID and namespace reverts to and returns the finality checkpoint",
    async (context) => {
      if (context.databaseConfig.kind !== "postgres") return;
      const database = new PostgresDatabaseService({
        common: context.common,
        poolConfig: context.databaseConfig.poolConfig,
        userNamespace: context.databaseConfig.schema,
      });

      await database.setup({ schema, buildId: "abc" });

      // Simulate progress being made by updating the checkpoints.
      // TODO: Actually use the indexing store.
      const newCheckpoint = {
        ...zeroCheckpoint,
        blockNumber: 10,
      };

      await database.db
        .updateTable("namespace_lock")
        .set({ finalized_checkpoint: encodeCheckpoint(newCheckpoint) })
        .where("namespace", "=", "public")
        .execute();

      await database.kill();

      const databaseTwo = new PostgresDatabaseService({
        common: context.common,
        poolConfig: context.databaseConfig.poolConfig,
        userNamespace: context.databaseConfig.schema,
      });

      const { checkpoint } = await databaseTwo.setup({
        schema: schema,
        buildId: "abc",
      });

      expect(checkpoint).toMatchObject(newCheckpoint);

      await databaseTwo.kill();
    },
  );

  test("setup throws if the namespace is locked", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    await database.setup({ schema, buildId: "abc" });

    const databaseTwo = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    await expect(() =>
      databaseTwo.setup({ schema: schemaTwo, buildId: "def" }),
    ).rejects.toThrow(
      "Schema 'public' is in use by a different Ponder app (lock expires in",
    );

    await database.kill();
    await databaseTwo.kill();
  });

  test("setup succeeds if the previous lock has timed out", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    await database.setup({ schema, buildId: "abc" });

    const databaseTwo = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    await expect(() =>
      databaseTwo.setup({ schema: schemaTwo, buildId: "def" }),
    ).rejects.toThrow(
      "Schema 'public' is in use by a different Ponder app (lock expires in",
    );

    expect(await getTableNames(databaseTwo.db, "public")).toStrictEqual([
      "Pet",
      "Person",
    ]);

    // Stubbing Date.now() breaks the Kysely Migrator, so just update the row instead.
    await databaseTwo.db
      .withSchema("ponder")
      .updateTable("namespace_lock")
      .set({ heartbeat_at: Date.now() - 1000 * 120 })
      .where("namespace", "=", "public")
      .execute();

    await databaseTwo.setup({ schema: schemaTwo, buildId: "def" });

    expect(await getTableNames(databaseTwo.db, "public")).toStrictEqual([
      "Dog",
      "Apple",
    ]);

    await database.kill();
    await databaseTwo.kill();
  });

  test("setup throws if there is a table name collision", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    await database.db.executeQuery(
      sql`CREATE TABLE public."Pet" (id TEXT)`.compile(database.db),
    );

    expect(await getTableNames(database.db, "public")).toStrictEqual(["Pet"]);

    await expect(() =>
      database.setup({ schema, buildId: "abc" }),
    ).rejects.toThrow(
      "Unable to create table 'public'.'Pet' because a table with that name already exists. Is there another application using the 'public' database schema?",
    );

    await database.kill();
  });

  test("heartbeat updates the heartbeat_at value", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    vi.useFakeTimers();

    await database.setup({ schema, buildId: "abc" });

    const row = await database.db
      .withSchema("ponder")
      .selectFrom("namespace_lock")
      .select(["heartbeat_at"])
      .executeTakeFirst();

    await vi.advanceTimersToNextTimerAsync();

    const rowAfterHeartbeat = await database.db
      .withSchema("ponder")
      .selectFrom("namespace_lock")
      .select(["heartbeat_at"])
      .executeTakeFirst();

    expect(BigInt(rowAfterHeartbeat!.heartbeat_at)).toBeGreaterThan(
      BigInt(row!.heartbeat_at),
    );

    await database.kill();

    vi.useRealTimers();
  });

  test("kill releases the namespace lock", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    await database.setup({ schema, buildId: "abc" });

    const row = await database.db
      .withSchema("ponder")
      .selectFrom("namespace_lock")
      .select(["namespace", "is_locked"])
      .executeTakeFirst();

    await database.kill();

    // Only creating this database to use the `db` object.
    const databaseTwo = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    const rowAfterKill = await databaseTwo.db
      .withSchema("ponder")
      .selectFrom("namespace_lock")
      .select(["namespace", "is_locked"])
      .executeTakeFirst();

    expect(row?.is_locked).toBe(1);
    expect(rowAfterKill?.is_locked).toBe(0);

    await databaseTwo.kill();
  });

  test("setup succeeds with a live app in a different namespace", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    await database.setup({ schema, buildId: "abc" });

    const databaseTwo = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: "public2",
    });

    expect(await getTableNames(databaseTwo.db, "ponder")).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "namespace_lock",
      hash(["public", "abc", "Pet"]),
      hash(["public", "abc", "Person"]),
    ]);

    await databaseTwo.setup({ schema: schemaTwo, buildId: "def" });

    expect(await getTableNames(databaseTwo.db, "ponder")).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "namespace_lock",
      hash(["public", "abc", "Pet"]),
      hash(["public", "abc", "Person"]),
      hash(["public2", "def", "Dog"]),
      hash(["public2", "def", "Apple"]),
    ]);
    expect(await getTableNames(databaseTwo.db, "public2")).toStrictEqual([
      "Dog",
      "Apple",
    ]);

    await databaseTwo.kill();
    await database.kill();
  });

  test("setup succeeds with a live app in a different namespace using the same build ID", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    await database.setup({ schema, buildId: "abc" });

    const databaseTwo = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: "public2",
    });

    expect(await getTableNames(databaseTwo.db, "ponder")).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "namespace_lock",
      hash(["public", "abc", "Pet"]),
      hash(["public", "abc", "Person"]),
    ]);

    await databaseTwo.setup({ schema: schemaTwo, buildId: "abc" });

    expect(await getTableNames(databaseTwo.db, "ponder")).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "namespace_lock",
      hash(["public", "abc", "Pet"]),
      hash(["public", "abc", "Person"]),
      hash(["public2", "abc", "Dog"]),
      hash(["public2", "abc", "Apple"]),
    ]);
    expect(await getTableNames(databaseTwo.db, "public2")).toStrictEqual([
      "Dog",
      "Apple",
    ]);

    await database.kill();
    await databaseTwo.kill();
  });

  test("publish succeeds if there are no name collisions", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
      publishSchema: "publish",
    });

    await database.setup({ schema, buildId: "abc" });

    expect(await getTableNames(database.db, "public")).toStrictEqual([
      "Pet",
      "Person",
    ]);

    await database.publish();

    expect(await getViewNames(database.db, "publish")).toStrictEqual([
      "Pet",
      "Person",
    ]);

    await database.kill();
  });

  test("publish succeeds and skips creating view if there is a name collision with a table", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
      publishSchema: "publish",
    });

    await database.setup({ schema, buildId: "abc" });

    expect(await getTableNames(database.db, "public")).toStrictEqual([
      "Pet",
      "Person",
    ]);

    await database.db.schema.createSchema("publish").ifNotExists().execute();
    await database.db.executeQuery(
      sql`CREATE TABLE publish."Pet" (id TEXT)`.compile(database.db),
    );

    await database.publish();

    expect(await getTableNames(database.db, "publish")).toStrictEqual(["Pet"]);
    expect(await getViewNames(database.db, "publish")).toStrictEqual([
      "Person",
    ]);

    await database.kill();
  });

  test("publish succeeds and replaces view if there is a name collision with a view", async (context) => {
    if (context.databaseConfig.kind !== "postgres") return;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
      publishSchema: "nice_looks-great",
    });

    await database.setup({ schema, buildId: "abc" });

    expect(await getTableNames(database.db, "public")).toStrictEqual([
      "Pet",
      "Person",
    ]);

    await database.db.schema
      .createSchema("nice_looks-great")
      .ifNotExists()
      .execute();
    await database.db.executeQuery(
      sql`CREATE VIEW "nice_looks-great"."Pet" AS SELECT 1`.compile(
        database.db,
      ),
    );

    await database.publish();

    expect(await getViewNames(database.db, "nice_looks-great")).toStrictEqual([
      "Pet",
      "Person",
    ]);

    await database.kill();
  });
});

async function getTableNames(db: HeadlessKysely<any>, schemaName: string) {
  const { rows } = await db.executeQuery<{
    table_name: string;
  }>(
    sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = '${sql.raw(schemaName)}'
      AND table_type = 'BASE TABLE'
    `.compile(db),
  );
  return rows.map((r) => r.table_name);
}

async function getViewNames(db: HeadlessKysely<any>, schemaName: string) {
  const { rows } = await db.executeQuery<{
    table_name: string;
  }>(
    sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = '${sql.raw(schemaName)}'
      AND table_type = 'VIEW'
    `.compile(db),
  );
  return rows.map((r) => r.table_name);
}
