import { buildSchema } from "@/build/schema.js";
import {
  type Database,
  type ListenConnection,
  createDatabase,
} from "@/database/index.js";
import type { IndexingStore } from "@/indexing-store/index.js";
import {
  type MetadataStore,
  getMetadataStore,
} from "@/indexing-store/metadata.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import type { Common } from "@/internal/common.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createTelemetry } from "@/internal/telemetry.js";
import type { DatabaseConfig, Schema } from "@/internal/types.js";
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
    await client.query(
      `
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1 AND pid <> pg_backend_pid()
      `,
      [databaseName],
    );
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
  listenConnection: ListenConnection;
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

  await database.migrate({ buildId: config.buildId });
  const listenConnection = await database.getListenConnection();

  await database.migrateSync().catch((err) => {
    console.log(err);
    throw err;
  });

  const syncStore = createSyncStore({ common: context.common, database });

  const indexingStore = createRealtimeIndexingStore({
    common: context.common,
    schemaBuild: { schema: config.schema },
    database,
  });

  const metadataStore = getMetadataStore({ database });

  const cleanup = async () => {
    if (listenConnection.dialect === "postgres") {
      listenConnection.connection.release();
    }
    await database.kill();
  };

  return {
    database,
    listenConnection,
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
