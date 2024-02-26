import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { Common } from "@/Ponder.js";
import type { Config } from "@/config/config.js";
import type { Network } from "@/config/networks.js";
import { buildOptions } from "@/config/options.js";
import type { Factory, LogFilter } from "@/config/sources.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { DatabaseService } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import { PostgresIndexingStore } from "@/indexing-store/postgres/store.js";
import { SqliteIndexingStore } from "@/indexing-store/sqlite/store.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { LoggerService } from "@/logger/service.js";
import { MetricsService } from "@/metrics/service.js";
import { PostgresSyncStore } from "@/sync-store/postgres/store.js";
import { SqliteSyncStore } from "@/sync-store/sqlite/store.js";
import type { SyncStore } from "@/sync-store/store.js";
import { TelemetryService } from "@/telemetry/service.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import pg from "pg";
import type { Address } from "viem";
import { type TestContext, beforeEach } from "vitest";
import { deploy, simulate } from "./simulate.js";
import { getConfig, getNetworkAndSources, testClient } from "./utils.js";

/**
 * Inject an isolated sync store into the test context.
 *
 * If `process.env.DATABASE_URL` is set, assume it's a Postgres connection string
 * and run tests against it. If passed a `schema`, PostgresSyncStore will create
 * it if it doesn't exist, then use for all connections. We use the Vitest pool ID as
 * the schema key which enables test isolation (same approach as Anvil.js).
 */
declare module "vitest" {
  export interface TestContext {
    common: Common;
    database: DatabaseService;
    syncStore: SyncStore;
    indexingStore: IndexingStore;
    sources: [LogFilter, Factory];
    networks: Network[];
    requestQueues: RequestQueue[];
    config: Config;
    erc20: { address: Address };
    factory: { address: Address; pair: Address };
  }
}

beforeEach((context) => {
  setupContext(context);
});

export const setupContext = (context: TestContext) => {
  const options = {
    ...buildOptions({
      cliOptions: { config: "", root: "" },
    }),
    telemetryDisabled: true,
  };
  context.common = {
    instanceId: crypto.randomBytes(4).toString("hex"),
    options,
    logger: new LoggerService({ level: "silent" }),
    metrics: new MetricsService(),
    telemetry: new TelemetryService({ options }),
  };
};

/**
 * Sets up an isolated database on the test context.
 *
 * ```ts
 * // Add this to any test suite that uses the SyncStore client.
 * beforeEach((context) => setupDatabase(context))
 * ```
 */
export async function setupDatabase(context: TestContext) {
  if (process.env.DATABASE_URL) {
    const testClient = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });

    await testClient.connect();

    const randomSuffix = crypto.randomBytes(10).toString("hex");
    const databaseName = `vitest_${randomSuffix}`;
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.pathname = `/${databaseName}`;
    const connectionString = databaseUrl.toString();

    await testClient.query(`CREATE DATABASE "${databaseName}"`);

    context.database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: { connectionString: connectionString },
    });

    await context.database.setup();

    return async () => {
      try {
        await context.database.kill();
        await testClient.query(`DROP DATABASE "${databaseName}"`);
        await testClient.end();
      } catch (e) {
        // This fails in end-to-end tests where the pool has
        // already been shut down during the Ponder instance kill() method.
        // It's fine to ignore the error.
      }
    };
  } else {
    const tmpdir = os.tmpdir();
    fs.mkdirSync(tmpdir, { recursive: true });

    context.database = new SqliteDatabaseService({
      common: context.common,
      directory: tmpdir,
    });

    await context.database.setup();

    return async () => {
      await context.database.kill();

      fs.rmSync(path.join(tmpdir, "ponder_core_cache.db"), { force: true });
      fs.rmSync(
        path.join(tmpdir, `ponder_core_${context.common.instanceId}.db`),
        {
          force: true,
        },
      );
      fs.rmSync(path.join(tmpdir, "ponder_sync.db"), { force: true });
    };
  }
}

/**
 * Sets up an isolated SyncStore on the test context.
 *
 * ```ts
 * // Add this to any test suite that uses the SyncStore client.
 * beforeEach((context) => setupSyncStore(context))
 * ```
 */
export async function setupSyncStore(context: TestContext) {
  if (context.database.kind === "postgres") {
    const syncDatabase = await context.database.getSyncDatabase();

    context.syncStore = new PostgresSyncStore({
      common: context.common,
      schemaName: syncDatabase.schemaName,
      pool: syncDatabase.pool,
    });
  } else {
    const syncDatabase = await context.database.getSyncDatabase();

    context.syncStore = new SqliteSyncStore({
      common: context.common,
      database: syncDatabase.database,
    });
  }

  await context.syncStore.migrateUp();
}

/**
 * Sets up an isolated IndexingStore on the test context.
 *
 * ```ts
 * // Add this to any test suite that uses the IndexingStore client.
 * beforeEach((context) => setupIndexingStore(context))
 * ```
 */
export async function setupIndexingStore(context: TestContext) {
  const database = context.database;
  if (database.kind === "postgres") {
    const indexingDatabase = await database.getIndexingDatabase();

    context.indexingStore = new PostgresIndexingStore({
      common: context.common,
      getCurrentIndexingSchemaName: () => database.currentIndexingSchemaName,
      pool: indexingDatabase.pool,
    });
  } else {
    const indexingDatabase = await database.getIndexingDatabase();

    context.indexingStore = new SqliteIndexingStore({
      common: context.common,
      database: indexingDatabase.database,
    });
  }
}

/**
 * Sets up an isolated Ethereum client on the test context, with the appropriate Erc20 + Factory state.
 *
 * ```ts
 * // Add this to any test suite that uses the Ethereum client.
 * beforeEach((context) => setupAnvil(context))
 * ```
 */
export async function setupAnvil(context: TestContext) {
  const emptySnapshotId = await testClient.snapshot();

  // Chain state setup shared across all tests.
  const addresses = await deploy();
  const pair = await simulate(addresses);

  context.config = getConfig(addresses);

  const { networks, sources, requestQueues } = await getNetworkAndSources(
    addresses,
    context.common,
  );
  context.networks = networks;
  context.requestQueues = requestQueues;
  context.sources = sources as [LogFilter, Factory];
  context.erc20 = { address: addresses.erc20Address };
  context.factory = { address: addresses.factoryAddress, pair };

  return async () => {
    await testClient.revert({ id: emptySnapshotId });
  };
}
