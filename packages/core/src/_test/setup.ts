import { randomUUID } from "crypto";
import fs from "fs";
import path from "node:path";
import os from "os";
import type { Common } from "@/common/common.js";
import { LoggerService } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { TelemetryService } from "@/common/telemetry.js";
import type { Config } from "@/config/config.js";
import type { DatabaseConfig } from "@/config/database.js";
import type { Network } from "@/config/networks.js";
import type { Factory, LogFilter } from "@/config/sources.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { DatabaseService } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import { createSchema } from "@/index.js";
import { RealtimeIndexingStore } from "@/indexing-store/realtimeStore.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { PostgresSyncStore } from "@/sync-store/postgres/store.js";
import { SqliteSyncStore } from "@/sync-store/sqlite/store.js";
import type { SyncStore } from "@/sync-store/store.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import pg from "pg";
import type { Address } from "viem";
import { type TestContext, beforeEach } from "vitest";
import { deploy, simulate } from "./simulate.js";
import { getConfig, getNetworkAndSources, testClient } from "./utils.js";

declare module "vitest" {
  export interface TestContext {
    common: Common;
    databaseConfig: DatabaseConfig;
    sources: [LogFilter, Factory];
    networks: Network[];
    requestQueues: RequestQueue[];
    config: Config;
    erc20: { address: Address };
    factory: { address: Address; pair: Address };
  }
}

beforeEach(setupContext);

export function setupContext(context: TestContext) {
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
}

/**
 * Sets up an isolated database on the test context.
 *
 * If `process.env.DATABASE_URL` is set, creates a new database and drops
 * it in the cleanup function. If it's not set, creates a temporary directory
 * for SQLite and removes it in the cleanup function.
 *
 * ```ts
 * // Add this to any test suite that uses the database.
 * beforeEach((context) => setupIsolatedDatabase(context))
 * ```
 */
export async function setupIsolatedDatabase(context: TestContext) {
  if (process.env.DATABASE_URL) {
    const databaseName = `vitest_${process.env.VITEST_POOL_ID ?? 1}`;
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.pathname = `/${databaseName}`;

    const poolConfig = { connectionString: databaseUrl.toString() };

    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await client.query(`CREATE DATABASE "${databaseName}"`);
    await client.end();

    context.databaseConfig = { kind: "postgres", poolConfig };

    return async () => {};
  } else {
    const tempDir = path.join(os.tmpdir(), randomUUID());
    fs.mkdirSync(tempDir, { recursive: true });

    context.databaseConfig = { kind: "sqlite", directory: tempDir };

    return async () => {
      fs.rmSync(tempDir, { force: true, recursive: true });
    };
  }
}

type DatabaseServiceSetup = Parameters<DatabaseService["setup"]>[0] & {
  indexing: "realtime" | "historical";
};
const defaultSchema = createSchema(() => ({}));
const defaultDatabaseServiceSetup: DatabaseServiceSetup = {
  appId: "test",
  schema: defaultSchema,
  indexing: "historical",
};

export async function setupDatabaseServices(
  context: TestContext,
  overrides: Partial<DatabaseServiceSetup> = {},
): Promise<{
  database: DatabaseService;
  syncStore: SyncStore;
  indexingStore: IndexingStore;
  cleanup: () => Promise<void>;
}> {
  const config = { ...defaultDatabaseServiceSetup, ...overrides };

  if (context.databaseConfig.kind === "sqlite") {
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    const result = await database.setup(config);

    const indexingStore = new RealtimeIndexingStore({
      kind: "sqlite",
      schema: config.schema,
      namespaceInfo: result.namespaceInfo,
      db: database.indexingDb,
    });

    const syncStore = new SqliteSyncStore({
      common: context.common,
      db: database.syncDb,
    });

    await syncStore.migrateUp();

    const cleanup = () => database.kill();

    return { database, indexingStore, syncStore, cleanup };
  } else {
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    const result = await database.setup(config);

    const indexingStore = new RealtimeIndexingStore({
      kind: "postgres",
      schema: config.schema,
      namespaceInfo: result.namespaceInfo,
      db: database.indexingDb,
    });

    const syncStore = new PostgresSyncStore({
      common: context.common,
      db: database.syncDb,
    });

    await syncStore.migrateUp();

    const cleanup = () => database.kill();

    return { database, indexingStore, syncStore, cleanup };
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
