import { randomBytes } from "node:crypto";
import { getTableIds } from "@/_test/utils.js";
import { createSchema } from "@/schema/schema.js";
import {
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { Kysely, sql } from "kysely";
import { Client } from "pg";
import { beforeEach, describe, expect, test } from "vitest";
import { PostgresDatabaseService } from "./service.js";

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
      await testClient.query(`DROP DATABASE "${databaseName}"  WITH (FORCE)`);
      await testClient.end();
    };
  });

  test("setup with fresh database", async (context) => {
    const connectionString = (context as any).connectionString as string;
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: { connectionString },
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

  test.todo("setup with cache hit", async (context) => {});

  test.todo("setup with cache hit, truncate required", async (context) => {});

  test("publish with fresh database", async (context) => {
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

    const databaseTwo = new PostgresDatabaseService({
      common: context.common,
      poolConfig: { connectionString },
    });
    await databaseTwo.setup();
    await databaseTwo.reset({
      schema: schemaTwo,
      tableIds: getTableIds(schemaTwo),
      functionIds: {},
      tableAccess: [],
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

    await expect(() => database.publish()).rejects.toThrowError(
      "Invariant violation: Attempted to publish twice within one process.",
    );

    await database.kill();
  });

  test.todo("flush with fresh database", async (context) => {
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

  test("kill before publish", async (context) => {
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

    await database.kill();

    const tempDb = new PostgresDatabaseService({
      common: context.common,
      poolConfig: { connectionString },
    });

    // Instance schema was dropped
    expect(await getTableNames(tempDb.db, "ponder_instance_1")).toStrictEqual(
      [],
    );

    await tempDb.db.destroy();
  });

  test("kill after publish", async (context) => {
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

    await database.kill();

    const tempDb = new PostgresDatabaseService({
      common: context.common,
      poolConfig: { connectionString },
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

    const otherDatabase = new PostgresDatabaseService({
      common: context.common,
      poolConfig: { connectionString },
    });

    await otherDatabase.setup();
    await otherDatabase.reset({
      schema: schemaTwo,
      tableIds: getTableIds(schemaTwo),
      functionIds: {},
      tableAccess: [],
    });
    await otherDatabase.publish();

    await database.kill();

    const tempDb = new PostgresDatabaseService({
      common: context.common,
      poolConfig: { connectionString },
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

  // test("publish with no prior instance", async (context) => {
  //   const connectionString = (context as any).connectionString as string;

  //   const database = new PostgresDatabaseService({
  //     common: context.common,
  //     poolConfig: { connectionString },
  //   });

  //   await database.setup();
  //   await database.reset({
  //     schema: schema,
  //     tableIds: getTableIds(schema),
  //     functionIds: {},
  //     tableAccess: [],
  //   });

  //   await database.publish();

  //   // Confirm that we're using public, our instance schema is empty, and we hold the lock.

  //   const { rows: publicRows } = await database.db.executeQuery(
  //     sql`
  //       SELECT table_name
  //       FROM information_schema.tables
  //       WHERE table_schema = 'public'
  //     `.compile(database.db),
  //   );
  //   expect(publicRows).toStrictEqual([
  //     { table_name: "Pet_versioned" },
  //     { table_name: "Person_versioned" },
  //   ]);

  //   const { rows: instanceRows } = await database.db.executeQuery(
  //     sql`
  //       SELECT table_name
  //       FROM information_schema.tables
  //       WHERE table_schema = 'ponder_core_${sql.raw(context.common.instanceId)}'
  //     `.compile(database.db),
  //   );
  //   expect(instanceRows).toStrictEqual([]);

  //   const { rows: lockRows } = await database.db.executeQuery(
  //     sql`SELECT * FROM ponder_core_cache.lock`.compile(database.db),
  //   );
  //   expect(lockRows).toMatchObject([
  //     {
  //       id: "instance_lock",
  //       instance_id: context.common.instanceId,
  //       schema: JSON.stringify(schema),
  //     },
  //   ]);

  //   await database.kill();
  // });

  // test("publish with old instance still running", async (context) => {
  //   const connectionString = (context as any).connectionString as string;

  //   const database = new PostgresDatabaseService({
  //     common: context.common,
  //     poolConfig: { connectionString },
  //   });

  //   await database.setup();
  //   await database.reset({
  //     schema: schema,
  //     tableIds: getTableIds(schema),
  //     functionIds: {},
  //     tableAccess: [],
  //   });
  //   await database.publish();

  //   const newInstanceId = randomBytes(4).toString("hex");
  //   const newDatabase = new PostgresDatabaseService({
  //     common: { ...context.common, instanceId: newInstanceId },
  //     poolConfig: { connectionString },
  //   });
  //   await newDatabase.setup();
  //   await newDatabase.reset({
  //     schema: schemaTwo,
  //     tableIds: getTableIds(schemaTwo),
  //     functionIds: {},
  //     tableAccess: [],
  //   });

  //   // Confirm that the old instance tables are still in public.
  //   const { rows: publicRowsBeforePublish } = await database.db.executeQuery(
  //     sql`
  //       SELECT table_name
  //       FROM information_schema.tables
  //       WHERE table_schema = 'public'
  //     `.compile(database.db),
  //   );
  //   expect(publicRowsBeforePublish).toStrictEqual([
  //     { table_name: "Pet_versioned" },
  //     { table_name: "Person_versioned" },
  //   ]);

  //   await newDatabase.publish();

  //   // Confirm that old instance tables have been moved from public to their schema.
  //   const { rows: publicRowsAfterPublish } = await database.db.executeQuery(
  //     sql`
  //       SELECT table_name
  //       FROM information_schema.tables
  //       WHERE table_schema = 'public'
  //     `.compile(database.db),
  //   );
  //   expect(publicRowsAfterPublish).toStrictEqual([
  //     { table_name: "Dog_versioned" },
  //     { table_name: "Apple_versioned" },
  //   ]);

  //   // Confirm that old instance user no longer has privileges for the public schema.
  //   // TODO
  //   // expect(async () => {
  //   //   const { rows: instanceRows } = await database.db.executeQuery(
  //   //     sql`
  //   //       SELECT table_name
  //   //       FROM information_schema.tables
  //   //       WHERE table_schema = 'ponder_core_${sql.raw(
  //   //         context.common.instanceId,
  //   //       )}'
  //   //     `.compile(database.db),
  //   //   );
  //   //   expect(instanceRows).toStrictEqual([]);
  //   // });

  //   await database.kill();

  //   await newDatabase.kill();

  //   // Confirm that old instance has been rugged!
  // });

  // test("publish with old instance not running (graceful shutdown)", async (context) => {
  //   const connectionString = (context as any).connectionString as string;

  //   const instanceId = context.common.instanceId;
  //   const database = new PostgresDatabaseService({
  //     common: context.common,
  //     poolConfig: { connectionString },
  //   });

  //   await database.setup();
  //   await database.reset({
  //     schema: schema,
  //     tableIds: getTableIds(schema),
  //     functionIds: {},
  //     tableAccess: [],
  //   });
  //   await database.publish();
  //   await database.kill();

  //   const newInstanceId = randomBytes(4).toString("hex");
  //   const newDatabase = new PostgresDatabaseService({
  //     common: { ...context.common, instanceId: newInstanceId },
  //     poolConfig: { connectionString },
  //   });
  //   await newDatabase.setup();
  //   await newDatabase.reset({
  //     schema: schemaTwo,
  //     tableIds: getTableIds(schemaTwo),
  //     functionIds: {},
  //     tableAccess: [],
  //   });

  //   // Confirm that the old instance tables are still in public.
  //   const { rows: publicRowsBeforePublish } = await newDatabase.db.executeQuery(
  //     sql`
  //       SELECT table_name
  //       FROM information_schema.tables
  //       WHERE table_schema = 'public'
  //     `.compile(newDatabase.db),
  //   );
  //   expect(publicRowsBeforePublish).toStrictEqual([
  //     { table_name: "Pet_versioned" },
  //     { table_name: "Person_versioned" },
  //   ]);

  //   await newDatabase.publish();

  //   // Confirm that old instance tables have been dropped from public.
  //   const { rows: publicRowsAfterPublish } = await newDatabase.db.executeQuery(
  //     sql`
  //       SELECT table_name
  //       FROM information_schema.tables
  //       WHERE table_schema = 'public'
  //     `.compile(newDatabase.db),
  //   );
  //   expect(publicRowsAfterPublish).toStrictEqual([
  //     { table_name: "Dog_versioned" },
  //     { table_name: "Apple_versioned" },
  //   ]);
  //   const { rows: oldInstanceSchemaRows } = await newDatabase.db.executeQuery(
  //     sql`
  //       SELECT table_name
  //       FROM information_schema.tables
  //       WHERE table_schema = 'ponder_core_${sql.raw(instanceId)}'
  //     `.compile(newDatabase.db),
  //   );
  //   expect(oldInstanceSchemaRows).toStrictEqual([]);

  //   // Confirm that old instance user no longer has privileges for the public schema.
  //   // TODO
  //   // expect(async () => {
  //   //   const { rows: instanceRows } = await database.db.executeQuery(
  //   //     sql`
  //   //       SELECT table_name
  //   //       FROM information_schema.tables
  //   //       WHERE table_schema = 'ponder_core_${sql.raw(
  //   //         context.common.instanceId,
  //   //       )}'
  //   //     `.compile(database.db),
  //   //   );
  //   //   expect(instanceRows).toStrictEqual([]);
  //   // });

  //   await newDatabase.kill();

  //   // Confirm that old instance has been rugged!
  // });

  // test("reset against a fresh database reads metadata", async (context) => {
  //   const connectionString = (context as any).connectionString as string;
  //   const database = new PostgresDatabaseService({
  //     common: context.common,
  //     poolConfig: { connectionString },
  //   });

  //   await database.setup();
  //   await database.reset({
  //     schema: schema,
  //     tableIds: getTableIds(schema),
  //     functionIds: { function: "function" },
  //     tableAccess: [],
  //   });

  //   expect(database.metadata).toHaveLength(0);

  //   const { rows: metadataRows } = await database.db.executeQuery(
  //     sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
  //   );

  //   expect(metadataRows).toHaveLength(0);

  //   await database.kill();
  // });

  // test("flush with a fresh database", async (context) => {
  //   const connectionString = (context as any).connectionString as string;
  //   const database = new PostgresDatabaseService({
  //     common: context.common,
  //     poolConfig: { connectionString },
  //   });

  //   await database.setup();
  //   await database.reset({
  //     schema: schema,
  //     tableIds: getTableIds(schema),
  //     functionIds: { function: "function" },
  //     tableAccess: [],
  //   });

  //   await database.flush([
  //     {
  //       functionId: "function",
  //       fromCheckpoint: null,
  //       toCheckpoint: zeroCheckpoint,
  //       eventCount: 0,
  //     },
  //   ]);

  //   // Metadata was writted to cache metadata table
  //   const { rows: metadataRows } = await database.db.executeQuery(
  //     sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
  //   );

  //   expect(metadataRows).toStrictEqual([
  //     {
  //       function_id: "function",
  //       from_checkpoint: null,
  //       to_checkpoint: encodeCheckpoint(zeroCheckpoint),
  //       event_count: 0,
  //     },
  //   ]);

  //   // Instance tables were copied to cache
  //   expect(await getTableNames(database.db, "ponder_cache")).toEqual(
  //     expect.arrayContaining(["Pet", "Person"]),
  //   );

  //   // TODO(kyle) check that the rows were copied to the cache

  //   await database.kill();
  // });

  // test("reset against a database with existing metadata", async (context) => {
  //   const connectionString = (context as any).connectionString as string;
  //   const oldDatabase = new PostgresDatabaseService({
  //     common: context.common,
  //     poolConfig: { connectionString },
  //   });

  //   await oldDatabase.setup();
  //   await oldDatabase.reset({
  //     schema: schema,
  //     tableIds: getTableIds(schema),
  //     functionIds: { function: "function" },
  //     tableAccess: [],
  //   });

  //   await oldDatabase.flush([
  //     {
  //       functionId: "function",
  //       fromCheckpoint: null,
  //       toCheckpoint: zeroCheckpoint,
  //       eventCount: 0,
  //     },
  //   ]);

  //   const database = new PostgresDatabaseService({
  //     common: { ...context.common },
  //     poolConfig: { connectionString },
  //   });
  //   await database.setup();
  //   await database.reset({
  //     schema: schema,
  //     tableIds: getTableIds(schema),
  //     functionIds: { function: "function" },
  //     tableAccess: [],
  //   });

  //   // Check that metadata is updated
  //   expect(database.metadata).toStrictEqual([
  //     {
  //       functionId: "function",
  //       fromCheckpoint: null,
  //       toCheckpoint: zeroCheckpoint,
  //       eventCount: 0,
  //     },
  //   ]);

  //   // TODO(kyle) copy cached data
  //   // TODO(kyle) extra data is successfully reverted

  //   await oldDatabase.kill();
  //   await database.kill();
  // });

  // test("flush with old metadata to overwrite", async (context) => {
  //   const connectionString = (context as any).connectionString as string;
  //   const oldDatabase = new PostgresDatabaseService({
  //     common: context.common,
  //     poolConfig: { connectionString },
  //   });

  //   await oldDatabase.setup();
  //   await oldDatabase.reset({
  //     schema: schema,
  //     tableIds: getTableIds(schema),
  //     functionIds: { function: "function" },
  //     tableAccess: [],
  //   });

  //   await oldDatabase.flush([
  //     {
  //       functionId: "function",
  //       fromCheckpoint: null,
  //       toCheckpoint: zeroCheckpoint,
  //       eventCount: 0,
  //     },
  //   ]);

  //   const database = new PostgresDatabaseService({
  //     common: { ...context.common },
  //     poolConfig: { connectionString },
  //   });
  //   await database.setup();
  //   await database.reset({
  //     schema: schema,
  //     tableIds: getTableIds(schema),
  //     functionIds: { function: "function" },
  //     tableAccess: [],
  //   });

  //   await database.flush([
  //     {
  //       functionId: "function",
  //       fromCheckpoint: null,
  //       toCheckpoint: maxCheckpoint,
  //       eventCount: 1,
  //     },
  //   ]);

  //   // Confirm that the metadata was writted to metadata
  //   const { rows: metadataRows } = await database.db.executeQuery(
  //     sql`SELECT * FROM ponder_cache.function_metadata`.compile(database.db),
  //   );

  //   expect(metadataRows).toStrictEqual([
  //     {
  //       function_id: "function",
  //       from_checkpoint: null,
  //       to_checkpoint: encodeCheckpoint(maxCheckpoint),
  //       event_count: 1,
  //     },
  //   ]);

  //   await oldDatabase.kill();
  //   await database.kill();
  // });
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
