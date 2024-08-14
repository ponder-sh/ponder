import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Common } from "@/common/common.js";
import { createLogger } from "@/common/logger.js";
import { MetricsService } from "@/common/metrics.js";
import { buildOptions } from "@/common/options.js";
import { createTelemetry } from "@/common/telemetry.js";
import type { Config } from "@/config/config.js";
import type { DatabaseConfig } from "@/config/database.js";
import type { Network } from "@/config/networks.js";
import { PostgresDatabaseService } from "@/database/postgres/service.js";
import type { DatabaseService, NamespaceInfo } from "@/database/service.js";
import { SqliteDatabaseService } from "@/database/sqlite/service.js";
import { createSchema } from "@/index.js";
import { getHistoricalStore } from "@/indexing-store/historical.js";
import { getReadonlyStore } from "@/indexing-store/readonly.js";
import { getRealtimeStore } from "@/indexing-store/realtime.js";
import type { IndexingStore, ReadonlyStore } from "@/indexing-store/store.js";
import { type SyncStore, createSyncStore } from "@/sync-store/index.js";
import type { BlockSource, ContractSource, LogFactory } from "@/sync/source.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import pg from "pg";
import { rimrafSync } from "rimraf";
import type { Address } from "viem";
import type { TestContext } from "vitest";
import { deploy, simulate } from "./simulate.js";
import { getConfig, getNetworkAndSources, testClient } from "./utils.js";

declare module "vitest" {
  export interface TestContext {
    common: Common;
    databaseConfig: DatabaseConfig;
    sources: [
      ContractSource<"log", undefined>,
      ContractSource<"log", LogFactory>,
      ContractSource<"trace", LogFactory>,
      ContractSource<"trace", undefined>,
      BlockSource,
    ];
    networks: [Network];
    requestQueues: [RequestQueue];
    config: Config;
    erc20: { address: Address };
    factory: { address: Address; pair: Address };
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

    const poolConfig = { max: 30, connectionString: databaseUrl.toString() };

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
  readonlyStore: ReadonlyStore;
  cleanup: () => Promise<void>;
}> {
  const config = { ...defaultDatabaseServiceSetup, ...overrides };
  let database: SqliteDatabaseService | PostgresDatabaseService;

  if (context.databaseConfig.kind === "sqlite") {
    database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });
  } else {
    database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
      userNamespace: context.databaseConfig.schema,
    });
  }

  const result = await database.setup(config);

  await database.migrateSyncStore();

  const syncStore = createSyncStore({
    common: context.common,
    sql: database.kind,
    db: database.syncDb,
  });

  const readonlyStore = getReadonlyStore({
    encoding: database.kind,
    schema: config.schema,
    namespaceInfo: result.namespaceInfo,
    db: database.indexingDb,
    common: context.common,
  });

  const indexingStore =
    config.indexing === "historical"
      ? getHistoricalStore({
          encoding: database.kind,
          schema: config.schema,
          readonlyStore,
          namespaceInfo: result.namespaceInfo,
          db: database.indexingDb,
          common: context.common,
          isCacheExhaustive: true,
        })
      : {
          ...readonlyStore,
          ...getRealtimeStore({
            encoding: database.kind,
            schema: config.schema,
            namespaceInfo: result.namespaceInfo,
            db: database.indexingDb,
            common: context.common,
          }),
        };

  const cleanup = () => database.kill();

  return {
    database,
    namespaceInfo: result.namespaceInfo,
    readonlyStore,
    indexingStore,
    syncStore,
    cleanup,
  };
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
  await testClient.mine({ blocks: 1 });

  context.config = getConfig(addresses);

  const { networks, sources, requestQueues } = await getNetworkAndSources(
    addresses,
    context.common,
  );
  context.networks = networks as [Network];
  context.requestQueues = requestQueues as [RequestQueue];
  context.sources = sources as [
    ContractSource<"log", undefined>,
    ContractSource<"log", LogFactory>,
    ContractSource<"trace", LogFactory>,
    ContractSource<"trace", undefined>,
    BlockSource,
  ];
  context.erc20 = { address: addresses.erc20Address };
  context.factory = {
    address: addresses.factoryAddress,
    pair: pair.toLowerCase() as Address,
  };

  return async () => {
    await testClient.revert({ id: emptySnapshotId });
  };
}
