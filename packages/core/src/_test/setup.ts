import { createBuild } from "@/build/index.js";
import type { Config } from "@/config/index.js";
import { createDatabase } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import { createTelemetry } from "@/internal/telemetry.js";
import type {
  Chain,
  DatabaseConfig,
  IndexingBuild,
  IndexingFunctions,
  NamespaceBuild,
  PerChainPonderApp,
  PonderApp,
  PreBuild,
  Schema,
} from "@/internal/types.js";
import { createRpc } from "@/rpc/index.js";
import { isAddressFactory } from "@/runtime/filter.js";
import { getFragments } from "@/runtime/fragments.js";
import type {
  CachedIntervals,
  ChildAddresses,
  SyncProgress,
} from "@/runtime/index.js";
import { createPglite } from "@/utils/pglite.js";
import type { Result } from "@/utils/result.js";
import type { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import pg from "pg";
import { type TestContext, afterAll } from "vitest";
import { anvil, poolId, testClient } from "./utils.js";

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
 * beforeEach(setupDatabase)
 * ```
 */
export async function setupDatabase(context: TestContext) {
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

export async function setupPonder<isPerChain extends boolean = false>(
  context: TestContext,
  overrides: Partial<{
    buildId: string;
    namespace: string;
    schema: Schema;
    config: Config;
    indexingFunctions: IndexingFunctions;
    app: Hono;
  }> = {},
  isPerChain: isPerChain = false as isPerChain,
): Promise<isPerChain extends true ? PerChainPonderApp : PonderApp> {
  const build = await createBuild(context.common, {
    cliOptions: {
      command: "start",
      version: "0.0.0",
      logFormat: "pretty",
      config: "ponder.config.ts",
    },
  });

  const config =
    overrides.config ??
    ({
      ordering: "multichain",
      chains: {
        mainnet: {
          id: 1,
          rpc: `http://127.0.0.1:8545/${poolId}`,
        },
      },
      contracts: {},
      accounts: {},
      blocks: {},
    } satisfies Config);

  const namespaceBuild = {
    schema: overrides.namespace ?? "public",
    viewsSchema: undefined,
  } satisfies NamespaceBuild;
  const preBuild = {
    ordering: overrides.config?.ordering ?? "multichain",
    databaseConfig: context.databaseConfig,
  } satisfies PreBuild;

  const schemaBuildResult = build.compileSchema({
    schema: overrides.schema ?? {},
  });

  if (schemaBuildResult.status === "error") {
    throw schemaBuildResult.error;
  }

  const database = await createDatabase(context.common, {
    namespaceBuild,
    preBuild,
    schemaBuild: schemaBuildResult.result,
  });

  // base app
  if (Object.keys(overrides).length === 0) {
    const app = {
      common: context.common,
      buildId: build.compileBuildId({
        configResult: { config, contentHash: "" },
        schemaResult: { schema: {}, contentHash: "" },
        indexingResult: {
          indexingFunctions: [],
          contentHash: "",
        },
      }),
      preBuild,
      namespaceBuild,
      schemaBuild: schemaBuildResult.result,
      indexingBuild: [
        {
          chain: setupChain(),
          rpc: createRpc(context.common, { chain: setupChain() }),
          finalizedBlock: 0,
          eventCallbacks: [],
        },
      ],
      apiBuild: {
        app: new Hono(),
        port: 0,
      },
      database,
    } satisfies PonderApp;

    globalThis.PONDER_COMMON = context.common;
    globalThis.PONDER_NAMESPACE_BUILD = namespaceBuild;

    globalThis.PONDER_DATABASE = database;

    await database.migrate({ buildId: app.buildId, ordering: "multichain" });
    await database.migrateSync().catch((err) => {
      console.log(err);
      throw err;
    });

    if (isPerChain) {
      // @ts-ignore
      return getPerChainPonderApp(app)[0]!;
    }

    // @ts-ignore
    return app;
  }

  // TODO(kyle) handle no indexing functions registered
  let indexingBuildResult: Result<IndexingBuild[]>;

  if (overrides.indexingFunctions === undefined) {
    indexingBuildResult = {
      status: "success",
      result: [
        {
          chain: setupChain(),
          rpc: createRpc(context.common, { chain: setupChain() }),
          finalizedBlock: 0,
          eventCallbacks: [],
        },
      ],
    };
  } else {
    indexingBuildResult = await build.compileIndexing({
      configResult: { config, contentHash: "" },
      indexingResult: {
        indexingFunctions: overrides.indexingFunctions ?? [],
        contentHash: "",
      },
    });
  }

  const apiBuildResult = await build.compileApi({
    apiResult: { app: overrides.app ?? new Hono() },
  });

  if (indexingBuildResult.status === "error") {
    throw indexingBuildResult.error;
  }

  if (apiBuildResult.status === "error") {
    throw apiBuildResult.error;
  }

  const app = {
    common: context.common,
    buildId:
      overrides.buildId ??
      build.compileBuildId({
        configResult: { config, contentHash: "" },
        schemaResult: { schema: overrides.schema ?? {}, contentHash: "" },
        indexingResult: {
          indexingFunctions: overrides.indexingFunctions ?? [],
          contentHash: "",
        },
      }),
    preBuild,
    namespaceBuild,
    schemaBuild: schemaBuildResult.result,
    indexingBuild: indexingBuildResult.result,
    apiBuild: apiBuildResult.result,
    database,
  } satisfies PonderApp;

  globalThis.PONDER_COMMON = context.common;
  globalThis.PONDER_NAMESPACE_BUILD = namespaceBuild;
  globalThis.PONDER_INDEXING_BUILD = indexingBuildResult.result;
  globalThis.PONDER_DATABASE = database;

  await database.migrate({ buildId: app.buildId, ordering: "multichain" });

  await database.migrateSync().catch((err) => {
    console.log(err);
    throw err;
  });

  if (isPerChain) {
    if (indexingBuildResult.result.length !== 1) {
      throw new Error("Expected exactly one chain");
    }

    // @ts-ignore
    return getPerChainPonderApp(app)[0]!;
  }

  // @ts-ignore
  return app;
}

export function setupChain() {
  return {
    viemChain: anvil,
    name: "mainnet`",
    id: 1,
    rpc: `http://127.0.0.1:8545/${poolId}`,
    pollingInterval: 1_000,
    finalityBlockCount: 1,
    disableCache: false,
  } satisfies Chain;
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

export const setupChildAddresses = (app: PerChainPonderApp): ChildAddresses => {
  const childAddresses = new Map();
  for (const eventCallback of app.indexingBuild.eventCallbacks) {
    switch (eventCallback.filter.type) {
      case "log":
        if (isAddressFactory(eventCallback.filter.address)) {
          childAddresses.set(eventCallback.filter.address.id, new Map());
        }
        break;
      case "transaction":
      case "transfer":
      case "trace":
        if (isAddressFactory(eventCallback.filter.fromAddress)) {
          childAddresses.set(eventCallback.filter.fromAddress.id, new Map());
        }
        if (isAddressFactory(eventCallback.filter.toAddress)) {
          childAddresses.set(eventCallback.filter.toAddress.id, new Map());
        }
    }
  }

  return childAddresses as ChildAddresses;
};

export const setupCachedIntervals = (
  app: PerChainPonderApp,
): CachedIntervals => {
  const cachedIntervals: CachedIntervals = new Map();
  for (const eventCallback of app.indexingBuild.eventCallbacks) {
    cachedIntervals.set(eventCallback.filter, []);
    for (const { fragment } of getFragments(eventCallback.filter)) {
      cachedIntervals
        .get(eventCallback.filter)!
        .push({ fragment, intervals: [] });
    }
  }
  return cachedIntervals;
};
