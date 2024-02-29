import crypto, { randomUUID } from "crypto";
import fs from "fs";
import path from "node:path";
import os from "os";
import type { Common } from "@/Ponder.js";
import type { Config } from "@/config/config.js";
import type { DatabaseConfig } from "@/config/database.js";
import type { Network } from "@/config/networks.js";
import { buildOptions } from "@/config/options.js";
import type { Factory, LogFilter } from "@/config/sources.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { DatabaseService } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import { createSchema } from "@/index.js";
import { PostgresIndexingStore } from "@/indexing-store/postgres/store.js";
import { SqliteIndexingStore } from "@/indexing-store/sqlite/store.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { LoggerService } from "@/logger/service.js";
import { MetricsService } from "@/metrics/service.js";
import { PostgresSyncStore } from "@/sync-store/postgres/store.js";
import { SqliteSyncStore } from "@/sync-store/sqlite/store.js";
import type { SyncStore } from "@/sync-store/store.js";
import { TelemetryService } from "@/telemetry/service.js";
import { createPool } from "@/utils/pg.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import { createSqliteDatabase } from "@/utils/sqlite.js";
import pg from "pg";
import type { Address } from "viem";
import { type TestContext, beforeEach } from "vitest";
import { deploy, simulate } from "./simulate.js";
import { getConfig, getNetworkAndSources, testClient } from "./utils.js";

declare module "vitest" {
  export interface TestContext {
    common: Common;
    database: DatabaseService;
    databaseConfig: DatabaseConfig;
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

beforeEach((context) => setupContext(context));

export const setupContext = (context: TestContext) => {
  const options = {
    ...buildOptions({
      cliOptions: { config: "", root: "" },
    }),
    telemetryDisabled: true,
  };
  context.common = {
    options,
    logger: new LoggerService({ level: "silent" }),
    metrics: new MetricsService(),
    telemetry: new TelemetryService({ options }),
  };
};

/**
 * Sets up an isolated database on the test context.
 *
 * If `process.env.DATABASE_URL` is set, creates a new database and drops
 * it in the cleanup function. If it's not set, creates a temporary directory
 * for SQLite and removes it in the cleanup function.
 *
 * ```ts
 * // Add this to any test suite that uses the database.
 * beforeEach((context) => setupDatabase(context))
 * ```
 */
export async function setupDatabase(context: TestContext) {
  if (process.env.DATABASE_URL) {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });

    await client.connect();

    const randomSuffix = crypto.randomBytes(10).toString("hex");
    const databaseName = `vitest_${randomSuffix}`;
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.pathname = `/${databaseName}`;
    const connectionString = databaseUrl.toString();
    const poolConfig = { connectionString };

    await client.query(`CREATE DATABASE "${databaseName}"`);

    context.databaseConfig = { kind: "postgres", poolConfig };
    context.database = new PostgresDatabaseService({
      common: context.common,
      poolConfig,
    });

    await context.database.setup();

    return async () => {
      await context.database.kill();
      await client.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      await client.end();
    };
  } else {
    const tempDir = path.join(os.tmpdir(), randomUUID());
    fs.mkdirSync(tempDir, { recursive: true });

    context.databaseConfig = { kind: "sqlite", directory: tempDir };
    context.database = new SqliteDatabaseService({
      common: context.common,
      directory: tempDir,
    });

    await context.database.setup();

    return async () => {
      await context.database.kill();
      fs.rmSync(tempDir, { force: true, recursive: true });
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
  if (context.databaseConfig.kind === "postgres") {
    const pool = createPool({ ...context.databaseConfig.poolConfig });

    context.syncStore = new PostgresSyncStore({
      common: context.common,
      pool,
      schemaName: "ponder_sync",
    });

    return async () => {
      await pool.end();
    };
  } else {
    const file = path.join(context.databaseConfig.directory, "ponder_sync.db");
    const database = createSqliteDatabase(file);

    context.syncStore = new SqliteSyncStore({
      common: context.common,
      database,
    });

    return () => database.close();
  }
}

/**
 * Sets up an isolated IndexingStore on the test context. After setting up,
 * be sure to set the schema within each test.
 *
 * ```ts
 * // Add this to any test suite that uses the IndexingStore.
 * beforeEach((context) => setupIndexingStore(context))
 *
 * // Set the schema within each test.
 * test("my test", (context) => {
 *   context.indexingStore.schema = createSchema({ ... })
 *   // ...
 * })
 * ```
 */
export function setupIndexingStore(context: TestContext) {
  const placeholderSchema = createSchema(() => ({}));

  if (context.databaseConfig.kind === "postgres") {
    const pool = createPool({ ...context.databaseConfig.poolConfig });

    context.indexingStore = new PostgresIndexingStore({
      common: context.common,
      pool,
      schemaName: "ponder_instance_1",
      schema: placeholderSchema,
    });

    return async () => {
      await pool.end();
    };
  } else {
    const file = path.join(context.databaseConfig.directory, "ponder.db");
    const database = createSqliteDatabase(file);

    context.indexingStore = new SqliteIndexingStore({
      common: context.common,
      database,
      schema: placeholderSchema,
    });

    return () => database.close();
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
