import { buildSchema } from "@/build/schema.js";
import type { Common } from "@/common/common.js";
import { createLogger } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { createTelemetry } from "@/common/telemetry.js";
import type { DatabaseConfig } from "@/config/database.js";
import { type Database, createDatabase } from "@/database/index.js";
import type { Schema } from "@/drizzle/index.js";
import type { IndexingStore } from "@/indexing-store/index.js";
import {
  type MetadataStore,
  getMetadataStore,
} from "@/indexing-store/metadata.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { type SyncStore, createSyncStore } from "@/sync-store/index.js";
import { createPglite } from "@/utils/pglite.js";
import type { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { type TestContext, afterAll } from "vitest";
import { poolId, testClient } from "./utils.js";

declare module "vitest" {
  export interface TestContext {
    common: Common;
    databaseConfig: DatabaseConfig;
  }
}

export function setupCommon(context: TestContext) {
  const cliOptions = {
    command: "start",
    config: "",
    root: "",
    logLevel: "silent",
    logFormat: "pretty",
  } as const;
  const options = { ...buildOptions({ cliOptions }), telemetryDisabled: true };
  const logger = createLogger({ level: cliOptions.logLevel });
  const metrics = new MetricsService();
  const telemetry = createTelemetry({ options, logger });
  context.common = { options, logger, metrics, telemetry };

  return async () => {
    await telemetry.kill();
    await logger.kill();
  };
}

const pgliteInstances = new Map<number, PGlite>();
afterAll(async () => {
  await Promise.all(
    Array.from(pgliteInstances.values()).map(async (instance) => {
      await instance.close();
    }),
  );
});

/**
 * Sets up an isolated database on the test context.
 *
 * ```ts
 * // Add this to any test suite that uses the database.
 * beforeEach(setupIsolatedDatabase)
 * ```
 */
export async function setupIsolatedDatabase(context: TestContext) {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    const databaseName = `vitest_${poolId}`;

    const client = new pg.Client({ connectionString });
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await client.query(`CREATE DATABASE "${databaseName}"`);
    await client.end();

    const databaseUrl = new URL(connectionString);
    databaseUrl.pathname = `/${databaseName}`;
    const poolConfig = { max: 30, connectionString: databaseUrl.toString() };

    context.databaseConfig = { kind: "postgres", poolConfig };
  } else {
    let instance = pgliteInstances.get(poolId);
    if (instance === undefined) {
      instance = createPglite({ dataDir: "memory://" });
      pgliteInstances.set(poolId, instance);
    }

    // Because PGlite takes ~500ms to open a new connection, and it's not possible to drop the
    // current database from within a connection, we run this query to mimic the effect of
    // "DROP DATABASE" without closing the connection. This speeds up the tests quite a lot.
    await instance.exec(`
      DO $$
      DECLARE
          obj TEXT;
          schema TEXT;
      BEGIN
          -- Loop over all user-defined schemas
          FOR schema IN SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema'
          LOOP
              -- Drop all tables
              FOR obj IN SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema = schema
              LOOP
                  EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(schema) || '.' || quote_ident(obj) || ' CASCADE;';
              END LOOP;

              -- Drop all sequences
              FOR obj IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = schema
              LOOP
                  EXECUTE 'DROP SEQUENCE IF EXISTS ' || quote_ident(schema) || '.' || quote_ident(obj) || ' CASCADE;';
              END LOOP;

              -- Drop all views
              FOR obj IN SELECT table_name FROM information_schema.views WHERE table_schema = schema
              LOOP
                  EXECUTE 'DROP VIEW IF EXISTS ' || quote_ident(schema) || '.' || quote_ident(obj) || ' CASCADE;';
              END LOOP;

              -- Drop all functions
              FOR obj IN SELECT routine_name FROM information_schema.routines WHERE routine_type = 'FUNCTION' AND routine_schema = schema
              LOOP
                  EXECUTE 'DROP FUNCTION IF EXISTS ' || quote_ident(schema) || '.' || quote_ident(obj) || ' CASCADE;';
              END LOOP;

              -- Drop all custom types
              FOR obj IN SELECT typname FROM pg_type WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = schema)
              LOOP
                  EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(schema) || '.' || quote_ident(obj) || ' CASCADE;';
              END LOOP;

              -- Drop all extensions (extensions are usually in public, but handling if in other schemas)
              FOR obj IN SELECT extname FROM pg_extension WHERE extnamespace = (SELECT oid FROM pg_namespace WHERE nspname = schema)
              LOOP
                  EXECUTE 'DROP EXTENSION IF EXISTS ' || quote_ident(obj) || ' CASCADE;';
              END LOOP;
          END LOOP;
      END $$;
    `);

    context.databaseConfig = { kind: "pglite_test", instance };
  }
}

type DatabaseServiceSetup = {
  buildId: string;
  schema: Schema;
  indexing: "realtime" | "historical";
};
const defaultDatabaseServiceSetup: DatabaseServiceSetup = {
  buildId: "abc",
  schema: {},
  indexing: "historical",
};

export async function setupDatabaseServices(
  context: TestContext,
  overrides: Partial<DatabaseServiceSetup> = {},
): Promise<{
  database: Database;
  syncStore: SyncStore;
  indexingStore: IndexingStore<"realtime">;
  metadataStore: MetadataStore;
  cleanup: () => Promise<void>;
}> {
  const config = { ...defaultDatabaseServiceSetup, ...overrides };

  const { statements } = buildSchema({
    schema: config.schema,
  });

  const database = await createDatabase({
    common: context.common,
    preBuild: {
      databaseConfig: context.databaseConfig,
      namespace: "public",
    },
    schemaBuild: {
      schema: config.schema,
      statements,
    },
  });

  await database.setup({ buildId: config.buildId });

  await database.migrateSync().catch((err) => {
    console.log(err);
    throw err;
  });

  const syncStore = createSyncStore({
    common: context.common,
    db: database.qb.sync,
  });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    database,
    schema: config.schema,
  });

  const metadataStore = getMetadataStore({
    db: database.qb.readonly,
  });

  const cleanup = () => database.kill();

  return {
    database,
    indexingStore,
    syncStore,
    metadataStore,
    cleanup,
  };
}

/**
 * Sets up an isolated Ethereum client.
 *
 * @example
 * ```ts
 * // Add this to any test suite that uses the Ethereum client.
 * beforeEach(setupAnvil)
 * ```
 */
export async function setupAnvil() {
  const emptySnapshotId = await testClient.snapshot();

  return async () => {
    await testClient.revert({ id: emptySnapshotId });
  };
}
