import { setupCommon, setupIsolatedDatabase } from "@/_test/setup.js";
import { getReadonlyStore } from "@/indexing-store/readonly.js";
import { getRealtimeStore } from "@/indexing-store/realtime.js";
import { createSchema } from "@/schema/schema.js";
import {
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { hash } from "@/utils/hash.js";
import { wait } from "@/utils/wait.js";
import { sql } from "kysely";
import { beforeEach, describe, expect, test } from "vitest";
import type { HeadlessKysely } from "../kysely.js";
import { SqliteDatabaseService } from "./service.js";

beforeEach(setupCommon);
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
  test("setup succeeds with a fresh database", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    const { checkpoint } = await database.setup({ schema, buildId: "abc" });

    expect(checkpoint).toMatchObject(zeroCheckpoint);

    expect(await getTableNames(database.db)).toStrictEqual([
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
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    const { checkpoint } = await database.setup({ schema, buildId: "abc" });
    expect(checkpoint).toMatchObject(zeroCheckpoint);

    await database.kill();

    const databaseTwo = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    expect(await getTableNames(databaseTwo.db)).toStrictEqual([
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

    expect(await getTableNames(databaseTwo.db)).toStrictEqual([
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

  test("setup does not drop tables that are not managed by ponder", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup({ schema, buildId: "abc" });
    await database.kill();

    const databaseTwo = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
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

  test("setup with the same build ID and namespace reverts to and returns the finality checkpoint", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    const { namespaceInfo } = await database.setup({ schema, buildId: "abc" });

    const realtimeIndexingStore = getRealtimeStore({
      kind: context.databaseConfig.kind,
      schema,
      db: database.indexingDb,
      namespaceInfo,
    });

    // Simulate progress being made by updating the checkpoints.
    // TODO: Actually use the indexing store.
    const newCheckpoint = {
      ...zeroCheckpoint,
      blockNumber: 10n,
    };

    await database.db
      .withSchema(namespaceInfo.internalNamespace)
      .updateTable("namespace_lock")
      .set({ finalized_checkpoint: encodeCheckpoint(newCheckpoint) })
      .where("namespace", "=", "public")
      .execute();

    await realtimeIndexingStore.create({
      tableName: "Pet",
      encodedCheckpoint: encodeCheckpoint({
        ...zeroCheckpoint,
        blockNumber: 9n,
      }),
      id: "id1",
      data: { name: "Skip" },
    });
    await realtimeIndexingStore.create({
      tableName: "Pet",
      encodedCheckpoint: encodeCheckpoint({
        ...zeroCheckpoint,
        blockNumber: 11n,
      }),
      id: "id2",
      data: { name: "Kevin" },
    });
    await realtimeIndexingStore.create({
      tableName: "Pet",
      encodedCheckpoint: encodeCheckpoint({
        ...zeroCheckpoint,
        blockNumber: 12n,
      }),
      id: "id3",
      data: { name: "Foo" },
    });

    await database.kill();

    const databaseTwo = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    const { checkpoint, namespaceInfo: namespaceInfoTwo } =
      await databaseTwo.setup({
        schema: schema,
        buildId: "abc",
      });

    const readonlyIndexingStore = getReadonlyStore({
      kind: context.databaseConfig.kind,
      schema,
      db: databaseTwo.indexingDb,
      namespaceInfo: namespaceInfoTwo,
    });

    expect(checkpoint).toMatchObject(newCheckpoint);

    const { items: pets } = await readonlyIndexingStore.findMany({
      tableName: "Pet",
    });

    expect(pets.length).toBe(1);
    expect(pets[0].name).toBe("Skip");

    await databaseTwo.kill();
  });

  test("setup succeeds if the lock expires after waiting to expire", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const options = {
      ...context.common.options,
      databaseHeartbeatInterval: 250,
      databaseHeartbeatTimeout: 625,
    };

    const database = new SqliteDatabaseService({
      common: { ...context.common, options },
      directory: context.databaseConfig.directory,
    });

    const { namespaceInfo } = await database.setup({ schema, buildId: "abc" });
    await database.kill();

    const databaseTwo = new SqliteDatabaseService({
      common: { ...context.common, options },
      directory: context.databaseConfig.directory,
    });

    // Update the prior app lock row to simulate a abrupt shutdown.
    await databaseTwo.db
      .withSchema(namespaceInfo.internalNamespace)
      .updateTable("namespace_lock")
      .where("namespace", "=", "public")
      .set({ is_locked: 1 })
      .execute();

    const result = await databaseTwo.setup({
      schema: schemaTwo,
      buildId: "def",
    });

    expect(result).toMatchObject({ checkpoint: zeroCheckpoint });

    await databaseTwo.kill();
  });

  test("setup throws if the namespace is still locked after waiting to expire", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const options = {
      ...context.common.options,
      databaseHeartbeatInterval: 250,
      databaseHeartbeatTimeout: 625,
    };

    const database = new SqliteDatabaseService({
      common: { ...context.common, options },
      directory: context.databaseConfig.directory,
    });

    await database.setup({ schema, buildId: "abc" });

    const databaseTwo = new SqliteDatabaseService({
      common: { ...context.common, options },
      directory: context.databaseConfig.directory,
    });

    await expect(() =>
      databaseTwo.setup({
        schema: schemaTwo,
        buildId: "def",
      }),
    ).rejects.toThrow(
      "Failed to acquire lock on database file 'public.db'. A different Ponder app is actively using this database.",
    );

    await database.kill();
    await databaseTwo.kill();
  });

  test("setup throws if there is a table name collision", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.db.executeQuery(
      sql`CREATE TABLE public.'Pet' (id TEXT)`.compile(database.db),
    );

    expect(await getTableNames(database.db, "public")).toStrictEqual(["Pet"]);

    await expect(() =>
      database.setup({ schema, buildId: "abc" }),
    ).rejects.toThrow(
      "Unable to create table 'Pet' in 'public.db' because a table with that name already exists. Is there another application using the 'public.db' database file?",
    );

    await database.kill();
  });

  test("heartbeat updates the heartbeat_at value", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const options = {
      ...context.common.options,
      databaseHeartbeatInterval: 250,
      databaseHeartbeatTimeout: 625,
    };

    const database = new SqliteDatabaseService({
      common: { ...context.common, options },
      directory: context.databaseConfig.directory,
    });

    await database.setup({ schema, buildId: "abc" });

    const row = await database.db
      .selectFrom("namespace_lock")
      .select(["heartbeat_at"])
      .executeTakeFirst();

    await wait(500);

    const rowAfterHeartbeat = await database.db
      .selectFrom("namespace_lock")
      .select(["heartbeat_at"])
      .executeTakeFirst();

    expect(BigInt(rowAfterHeartbeat!.heartbeat_at)).toBeGreaterThan(
      BigInt(row!.heartbeat_at),
    );

    await database.kill();
  });

  test("updateFinalizedCheckpoint updates lock table", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    const { namespaceInfo } = await database.setup({ schema, buildId: "abc" });

    await database.updateFinalizedCheckpoint({
      checkpoint: maxCheckpoint,
    });

    const rows = await database.db
      .withSchema(namespaceInfo.internalNamespace)
      .selectFrom("namespace_lock")
      .selectAll()
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0].finalized_checkpoint).toStrictEqual(
      encodeCheckpoint(maxCheckpoint),
    );

    await database.kill();
  });

  test("kill releases the namespace lock", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup({ schema, buildId: "abc" });

    const row = await database.db
      .selectFrom("namespace_lock")
      .select(["namespace", "is_locked"])
      .executeTakeFirst();

    await database.kill();

    // Only creating this database to use the `db` object.
    const databaseTwo = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    const rowAfterKill = await databaseTwo.db
      .selectFrom("namespace_lock")
      .select(["namespace", "is_locked"])
      .executeTakeFirst();

    expect(row?.is_locked).toBe(1);
    expect(rowAfterKill?.is_locked).toBe(0);

    await databaseTwo.kill();
  });

  test("setup succeeds with a live app in a different namespace", async (context) => {
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup({ schema, buildId: "abc" });

    const databaseTwo = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
      userNamespace: "public2",
    });

    expect(await getTableNames(databaseTwo.db)).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "namespace_lock",
      hash(["public", "abc", "Pet"]),
      hash(["public", "abc", "Person"]),
    ]);

    await databaseTwo.setup({ schema: schemaTwo, buildId: "def" });

    expect(await getTableNames(databaseTwo.db)).toStrictEqual([
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
    if (context.databaseConfig.kind !== "sqlite") return;
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup({ schema, buildId: "abc" });

    const databaseTwo = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
      userNamespace: "public2",
    });

    expect(await getTableNames(databaseTwo.db)).toStrictEqual([
      "kysely_migration",
      "kysely_migration_lock",
      "namespace_lock",
      hash(["public", "abc", "Pet"]),
      hash(["public", "abc", "Person"]),
    ]);

    await databaseTwo.setup({ schema: schemaTwo, buildId: "abc" });

    expect(await getTableNames(databaseTwo.db)).toStrictEqual([
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
});

async function getTableNames(db: HeadlessKysely<any>, schemaName?: string) {
  const { rows } = await db.executeQuery<{ name: string }>(
    sql`SELECT name FROM ${sql.raw(
      schemaName ? `${schemaName}.` : "",
    )}sqlite_master WHERE type='table'`.compile(db),
  );
  return rows.map((r) => r.name);
}
