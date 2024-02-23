import { randomBytes } from "node:crypto";
import { getTableIds } from "@/_test/utils.js";
import { createSchema } from "@/schema/schema.js";
import { sql } from "kysely";
import { Client } from "pg";
import { beforeEach, describe, expect, test } from "vitest";
import { PostgresDatabaseService } from "./service.js";

const shouldSkip = process.env.DATABASE_URL === undefined;

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

describe.skipIf(shouldSkip)("postgres database", () => {
  beforeEach<{ connectionString: string }>(async (context) => {
    const testClient = new Client({
      connectionString: process.env.DATABASE_URL,
    });

    await testClient.connect();

    const randomSuffix = randomBytes(10).toString("hex");
    const databaseName = `vitest_${randomSuffix}`;
    const databaseUrl = new URL(process.env.DATABASE_URL!);
    databaseUrl.pathname = `/${databaseName}`;
    const connectionString = databaseUrl.toString();

    await testClient.query(`CREATE DATABASE "${databaseName}"`);

    context.connectionString = connectionString;

    return async () => {
      await testClient.query(`DROP DATABASE "${databaseName}"`);
      await testClient.end();
    };
  });

  test("setup against fresh database", async (context) => {
    const connectionString = (context as any).connectionString as string;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: { connectionString },
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: [],
    });

    // Confirm that we're using public for indexing
    const { rows: publicRows } = await database.db.executeQuery(
      sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `.compile(database.db),
    );
    expect(publicRows).toStrictEqual([
      { table_name: "Pet_versioned" },
      { table_name: "Person_versioned" },
    ]);

    // Confirm that no tables were written to the instance schema
    const { rows: instanceRows } = await database.db.executeQuery(
      sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'ponder_core_${sql.raw(context.common.instanceId)}'
      `.compile(database.db),
    );
    expect(instanceRows).toStrictEqual([]);

    const { rows: lockRows } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_core_cache.lock`.compile(database.db),
    );
    expect(lockRows).toMatchObject([
      {
        id: "instance_lock",
        instance_id: context.common.instanceId,
        schema: JSON.stringify(schema),
      },
    ]);

    await database.kill();
  });

  test("setup against database with existing lock, old instance killed", async (context) => {
    const connectionString = (context as any).connectionString as string;

    const instanceId = context.common.instanceId;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: { connectionString },
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: [],
    });

    await database.kill();

    const newInstanceId = randomBytes(4).toString("hex");
    const newDatabase = new PostgresDatabaseService({
      common: { ...context.common, instanceId: newInstanceId },
      poolConfig: { connectionString },
    });
    await newDatabase.setup();
    await newDatabase.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: [],
    });

    // Public should still contain the previous instance tables.
    const { rows: publicRows } = await newDatabase.db.executeQuery(
      sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `.compile(newDatabase.db),
    );
    expect(publicRows).toStrictEqual([
      { table_name: "Pet_versioned" },
      { table_name: "Person_versioned" },
    ]);

    // Instance schema should contain current instance tables.
    const { rows: instanceRows } = await newDatabase.db.executeQuery(
      sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'ponder_core_${sql.raw(newInstanceId)}'
      `.compile(newDatabase.db),
    );
    expect(instanceRows).toStrictEqual([
      { table_name: "Pet_versioned" },
      { table_name: "Person_versioned" },
    ]);

    // New instance should not have written a lock row yet.
    const { rows: lockRows } = await newDatabase.db.executeQuery(
      sql`SELECT * FROM ponder_core_cache.lock`.compile(newDatabase.db),
    );
    expect(lockRows).toMatchObject([
      {
        id: "instance_lock",
        instance_id: instanceId,
        schema: JSON.stringify(schema),
      },
    ]);

    await newDatabase.kill();
  });

  test("publish with no prior instance", async (context) => {
    const connectionString = (context as any).connectionString as string;

    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: { connectionString },
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: [],
    });

    await database.publish();

    // Confirm that we're using public, our instance schema is empty, and we hold the lock.

    const { rows: publicRows } = await database.db.executeQuery(
      sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `.compile(database.db),
    );
    expect(publicRows).toStrictEqual([
      { table_name: "Pet_versioned" },
      { table_name: "Person_versioned" },
    ]);

    const { rows: instanceRows } = await database.db.executeQuery(
      sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'ponder_core_${sql.raw(context.common.instanceId)}'
      `.compile(database.db),
    );
    expect(instanceRows).toStrictEqual([]);

    const { rows: lockRows } = await database.db.executeQuery(
      sql`SELECT * FROM ponder_core_cache.lock`.compile(database.db),
    );
    expect(lockRows).toMatchObject([
      {
        id: "instance_lock",
        instance_id: context.common.instanceId,
        schema: JSON.stringify(schema),
      },
    ]);

    await database.kill();
  });

  test("publish with old instance still running", async (context) => {
    const connectionString = (context as any).connectionString as string;

    const instanceId = context.common.instanceId;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: { connectionString },
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: [],
    });
    await database.publish();

    const newInstanceId = randomBytes(4).toString("hex");
    const newDatabase = new PostgresDatabaseService({
      common: { ...context.common, instanceId: newInstanceId },
      poolConfig: { connectionString },
    });
    await newDatabase.setup();
    await newDatabase.reset({
      schema: schemaTwo,
      tableIds: getTableIds(schemaTwo),
      functionIds: {},
      tableAccess: [],
    });

    // Confirm that the old instance tables are still in public.
    const { rows: publicRowsBeforePublish } = await database.db.executeQuery(
      sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `.compile(database.db),
    );
    expect(publicRowsBeforePublish).toStrictEqual([
      { table_name: "Pet_versioned" },
      { table_name: "Person_versioned" },
    ]);

    await newDatabase.publish();

    // Confirm that old instance tables have been moved from public to their schema.
    const { rows: publicRowsAfterPublish } = await database.db.executeQuery(
      sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `.compile(database.db),
    );
    expect(publicRowsAfterPublish).toStrictEqual([
      { table_name: "Dog_versioned" },
      { table_name: "Apple_versioned" },
    ]);

    // Confirm that old instance user no longer has privileges for the public schema.
    // TODO
    // expect(async () => {
    //   const { rows: instanceRows } = await database.db.executeQuery(
    //     sql`
    //       SELECT table_name
    //       FROM information_schema.tables
    //       WHERE table_schema = 'ponder_core_${sql.raw(
    //         context.common.instanceId,
    //       )}'
    //     `.compile(database.db),
    //   );
    //   expect(instanceRows).toStrictEqual([]);
    // });

    await database.kill();

    await newDatabase.kill();

    // Confirm that old instance has been rugged!
  });

  test("publish with old instance not running (graceful shutdown)", async (context) => {
    const connectionString = (context as any).connectionString as string;

    const instanceId = context.common.instanceId;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: { connectionString },
    });

    await database.setup();
    await database.reset({
      schema: schema,
      tableIds: getTableIds(schema),
      functionIds: {},
      tableAccess: [],
    });
    await database.publish();
    await database.kill();

    const newInstanceId = randomBytes(4).toString("hex");
    const newDatabase = new PostgresDatabaseService({
      common: { ...context.common, instanceId: newInstanceId },
      poolConfig: { connectionString },
    });
    await newDatabase.setup();
    await newDatabase.reset({
      schema: schemaTwo,
      tableIds: getTableIds(schemaTwo),
      functionIds: {},
      tableAccess: [],
    });

    // Confirm that the old instance tables are still in public.
    const { rows: publicRowsBeforePublish } = await newDatabase.db.executeQuery(
      sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `.compile(newDatabase.db),
    );
    expect(publicRowsBeforePublish).toStrictEqual([
      { table_name: "Pet_versioned" },
      { table_name: "Person_versioned" },
    ]);

    await newDatabase.publish();

    // Confirm that old instance tables have been dropped from public.
    const { rows: publicRowsAfterPublish } = await newDatabase.db.executeQuery(
      sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `.compile(newDatabase.db),
    );
    expect(publicRowsAfterPublish).toStrictEqual([
      { table_name: "Dog_versioned" },
      { table_name: "Apple_versioned" },
    ]);
    const { rows: oldInstanceSchemaRows } = await newDatabase.db.executeQuery(
      sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'ponder_core_${sql.raw(instanceId)}'
      `.compile(newDatabase.db),
    );
    expect(oldInstanceSchemaRows).toStrictEqual([]);

    // Confirm that old instance user no longer has privileges for the public schema.
    // TODO
    // expect(async () => {
    //   const { rows: instanceRows } = await database.db.executeQuery(
    //     sql`
    //       SELECT table_name
    //       FROM information_schema.tables
    //       WHERE table_schema = 'ponder_core_${sql.raw(
    //         context.common.instanceId,
    //       )}'
    //     `.compile(database.db),
    //   );
    //   expect(instanceRows).toStrictEqual([]);
    // });

    await newDatabase.kill();

    // Confirm that old instance has been rugged!
  });
});
