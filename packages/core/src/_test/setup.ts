import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import path from "node:path";
import os from "os";
import type { Common } from "@/common/common.js";
import { LoggerService } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { createTelemetry } from "@/common/telemetry.js";
import type { Config } from "@/config/config.js";
import type { DatabaseConfig } from "@/config/database.js";
import type { Network } from "@/config/networks.js";
import type { FactorySource, LogSource } from "@/config/sources.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { DatabaseService, NamespaceInfo } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import { createSchema } from "@/index.js";
import { getHistoricalIndexingStore } from "@/indexing-store/historicalStore.js";
import { getReadIndexingStore } from "@/indexing-store/readStore.js";
import { getRealtimeIndexingStore } from "@/indexing-store/realtimeStore.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { PostgresSyncStore } from "@/sync-store/postgres/store.js";
import { SqliteSyncStore } from "@/sync-store/sqlite/store.js";
import type { SyncStore } from "@/sync-store/store.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import pg from "pg";
import { rimrafSync } from "rimraf";
import type { Address } from "viem";
import { type TestContext } from "vitest";
import { deploy, simulate } from "./simulate.js";
import { getConfig, getNetworkAndSources, testClient } from "./utils.js";

declare module "vitest" {
  export interface TestContext {
    common: Common;
    databaseConfig: DatabaseConfig;
    sources: [LogSource, FactorySource];
    networks: Network[];
    requestQueues: RequestQueue[];
    config: Config;
    erc20: { address: Address };
    factory: { address: Address; pair: Address };
  }
}

export function setupCommon(context: TestContext) {
  const options = {
    ...buildOptions({ cliOptions: { config: "", root: "" } }),
    telemetryDisabled: true,
  };
  const logger = new LoggerService({ level: "silent" });
  const metrics = new MetricsService();
  const telemetry = createTelemetry({ options, logger });
  context.common = { options, logger, metrics, telemetry };

  return async () => {
    await telemetry.kill();
    logger.kill();
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

    context.databaseConfig = {
      kind: "postgres",
      poolConfig,
      schema: "public",
    };

    return () => {};
  } else {
    const tempDir = path.join(os.tmpdir(), randomUUID());
    mkdirSync(tempDir, { recursive: true });

    context.databaseConfig = { kind: "sqlite", directory: tempDir };

    return () => {
      rimrafSync(tempDir);
    };
  }
}

type DatabaseServiceSetup = Parameters<DatabaseService["setup"]>[0] & {
  indexing: "realtime" | "historical";
};
const defaultSchema = createSchema(() => ({}));
const defaultDatabaseServiceSetup: DatabaseServiceSetup = {
  buildId: "test",
  schema: defaultSchema,
  indexing: "historical",
};

export async function setupDatabaseServices(
  context: TestContext,
  overrides: Partial<DatabaseServiceSetup> = {},
): Promise<{
  database: DatabaseService;
  namespaceInfo: NamespaceInfo;
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

    await database.migrateSyncStore();

    const indexingStore = {
      ...getReadIndexingStore({
        kind: "sqlite",
        schema: config.schema,
        namespaceInfo: result.namespaceInfo,
        db: database.indexingDb,
      }),
      ...(config.indexing === "historical"
        ? getHistoricalIndexingStore({
            kind: "sqlite",
            schema: config.schema,
            namespaceInfo: result.namespaceInfo,
            db: database.indexingDb,
          })
        : getRealtimeIndexingStore({
            kind: "sqlite",
            schema: config.schema,
            namespaceInfo: result.namespaceInfo,
            db: database.indexingDb,
          })),
    };

    const syncStore = new SqliteSyncStore({ db: database.syncDb });

    const cleanup = () => database.kill();

    return {
      database,
      namespaceInfo: result.namespaceInfo,
      indexingStore,
      syncStore,
      cleanup,
    };
  } else {
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });

    const result = await database.setup(config);

    await database.migrateSyncStore();

    const indexingStore = {
      ...getReadIndexingStore({
        kind: "postgres",
        schema: config.schema,
        namespaceInfo: result.namespaceInfo,
        db: database.indexingDb,
      }),
      ...(config.indexing === "historical"
        ? getHistoricalIndexingStore({
            kind: "postgres",
            schema: config.schema,
            namespaceInfo: result.namespaceInfo,
            db: database.indexingDb,
          })
        : getRealtimeIndexingStore({
            kind: "postgres",
            schema: config.schema,
            namespaceInfo: result.namespaceInfo,
            db: database.indexingDb,
          })),
    };

    const syncStore = new PostgresSyncStore({ db: database.syncDb });

    const cleanup = () => database.kill();

    return {
      database,
      namespaceInfo: result.namespaceInfo,
      indexingStore,
      syncStore,
      cleanup,
    };
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
  context.sources = sources as [LogSource, FactorySource];
  context.erc20 = { address: addresses.erc20Address };
  context.factory = {
    address: addresses.factoryAddress,
    pair: pair.toLowerCase() as Address,
  };

  return async () => {
    await testClient.revert({ id: emptySnapshotId });
  };
}
