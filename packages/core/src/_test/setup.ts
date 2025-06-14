import { buildSchema } from "@/build/schema.js";
import { type Database, createDatabase } from "@/database/index.js";
import type { IndexingStore } from "@/indexing-store/index.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import type { Common } from "@/internal/common.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { createTelemetry } from "@/internal/telemetry.js";
import type {
  DatabaseConfig,
  IndexingBuild,
  NamespaceBuild,
  SchemaBuild,
} from "@/internal/types.js";
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
    version: "0.0.0",
  } as const;
  const options = { ...buildOptions({ cliOptions }), telemetryDisabled: true };
  const logger = createLogger({ level: cliOptions.logLevel });
  const metrics = new MetricsService();
  const shutdown = createShutdown();
  const telemetry = createTelemetry({ options, logger, shutdown });
  context.common = { options, logger, metrics, telemetry, shutdown };
}

export function setupCleanup(context: TestContext) {
  return context.common.shutdown.kill;
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
    await client.query(
      `
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1 AND pid <> pg_backend_pid()
      `,
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await client.query(`DROP ROLE IF EXISTS "ponder_${databaseName}_public"`);
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

          -- Drop all enum types first (this will cascade and drop their associated array types)
          FOR obj IN
            SELECT typname
            FROM pg_type
            JOIN pg_namespace ns ON pg_type.typnamespace = ns.oid
            WHERE ns.nspname = schema
              AND typtype = 'e'  -- 'e' stands for enum type
          LOOP
            EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(schema) || '.' || quote_ident(obj) || ' CASCADE;';
          END LOOP;

          -- Drop all remaining custom types (non-enum)
          FOR obj IN
            SELECT typname
            FROM pg_type
            JOIN pg_namespace ns ON pg_type.typnamespace = ns.oid
            WHERE ns.nspname = schema
              AND typtype <> 'e'
          LOOP
            EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(schema) || '.' || quote_ident(obj) || ' CASCADE;';
          END LOOP;

          -- Drop all extensions
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

export async function setupDatabaseServices(
  context: TestContext,
  overrides: Partial<{
    namespaceBuild: NamespaceBuild;
    schemaBuild: Partial<SchemaBuild>;
    indexingBuild: Partial<IndexingBuild>;
  }> = {},
): Promise<{
  database: Database;
  syncStore: SyncStore;
  indexingStore: IndexingStore;
}> {
  const { statements } = buildSchema({
    schema: overrides.schemaBuild?.schema ?? {},
  });

  const database = await createDatabase({
    common: context.common,
    namespace: overrides.namespaceBuild ?? {
      schema: "public",
      viewsSchema: undefined,
    },
    preBuild: {
      databaseConfig: context.databaseConfig,
    },
    schemaBuild: {
      schema: overrides.schemaBuild?.schema ?? {},
      statements,
    },
  });

  await database.migrate({
    buildId: overrides.indexingBuild?.buildId ?? "abc",
  });

  await database.migrateSync().catch((err) => {
    console.log(err);
    throw err;
  });

  const syncStore = createSyncStore({ common: context.common, database });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: overrides.schemaBuild?.schema ?? {} },
  });
  indexingStore.qb = database.userQB;

  return {
    database,
    indexingStore,
    syncStore,
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
