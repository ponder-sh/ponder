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
import type { RequestQueue } from "@/utils/requestQueue.js";
import pg from "pg";
import type { Address } from "viem";
import { type TestContext, beforeEach } from "vitest";
import { deploy, simulate } from "./simulate.js";
import {
  getConfig,
  getNetworkAndSources,
  getTableIds,
  testClient,
} from "./utils.js";

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

    // // These are available on a per-file basis.
    // database: DatabaseService;
    // indexingStore: IndexingStore;
    // syncStore: SyncStore;
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
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });

    await client.connect();

    const randomSuffix = crypto.randomBytes(10).toString("hex");
    const databaseName = `vitest_${randomSuffix}`;
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.pathname = `/${databaseName}`;
    const poolConfig = { connectionString: databaseUrl.toString() };

    await client.query(`CREATE DATABASE "${databaseName}"`);

    context.databaseConfig = { kind: "postgres", poolConfig };

    return async () => {
      await client.query(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await client.end();
    };
  } else {
    const tempDir = path.join(os.tmpdir(), randomUUID());
    fs.mkdirSync(tempDir, { recursive: true });

    context.databaseConfig = { kind: "sqlite", directory: tempDir };

    return async () => {
      fs.rmSync(tempDir, { force: true, recursive: true });
    };
  }
}

type DatabaseServiceReset = Parameters<DatabaseService["reset"]>[0];
const defaultSchema = createSchema(() => ({}));
const defaultDatabaseServiceReset: DatabaseServiceReset = {
  schema: defaultSchema,
  tableIds: getTableIds(defaultSchema),
  functionIds: {},
  tableAccess: [],
};

export async function setupDatabaseServices(
  context: TestContext,
  overrides: Partial<DatabaseServiceReset> = {},
): Promise<{
  database: DatabaseService;
  syncStore: SyncStore;
  indexingStore: IndexingStore;
  cleanup: () => Promise<void>;
}> {
  const config = {
    ...defaultDatabaseServiceReset,
    ...overrides,
  };

  if (context.databaseConfig.kind === "sqlite") {
    const database = new SqliteDatabaseService({
      common: context.common,
      directory: context.databaseConfig.directory,
    });

    await database.setup();
    await database.reset(config);

    const indexingStoreConfig = database.getIndexingStoreConfig();
    const indexingStore = new SqliteIndexingStore({
      common: context.common,
      schema: config.schema,
      ...indexingStoreConfig,
    });

    const syncStoreConfig = database.getSyncStoreConfig();
    const syncStore = new SqliteSyncStore({
      common: context.common,
      ...syncStoreConfig,
    });

    await syncStore.migrateUp();

    const cleanup = () => database.kill();

    return { database, indexingStore, syncStore, cleanup };
  } else {
    const database = new PostgresDatabaseService({
      common: context.common,
      poolConfig: context.databaseConfig.poolConfig,
    });

    await database.setup();
    await database.reset({
      ...defaultDatabaseServiceReset,
      ...overrides,
    });

    const indexingStoreConfig = database.getIndexingStoreConfig();
    const indexingStore = new PostgresIndexingStore({
      common: context.common,
      schema: config.schema,
      ...indexingStoreConfig,
    });

    const syncStoreConfig = await database.getSyncStoreConfig();
    const syncStore = new PostgresSyncStore({
      common: context.common,
      ...syncStoreConfig,
    });

    await syncStore.migrateUp();

    const cleanup = () => database.kill();

    return { database, indexingStore, syncStore, cleanup };
  }
}

// /**
//  * Sets up a DatabaseService on the test context.
//  *
//  * ```ts
//  * // Add this to any test suite that uses the database.
//  * beforeEach((context) => setupDatabase(context))
//  * ```
//  */
// export async function setupDatabase(context: TestContext) {
//   if (context.databaseConfig.kind === "postgres") {
//     context.database = new PostgresDatabaseService({
//       common: context.common,
//       poolConfig: context.databaseConfig.poolConfig,
//     });

//     return async () => {
//       await context.database.kill();
//     };
//   } else {
//     context.database = new SqliteDatabaseService({
//       common: context.common,
//       directory: context.databaseConfig.directory,
//     });

//     return async () => {
//       await context.database.kill();
//     };
//   }
// }

// /**
//  * Sets up an isolated SyncStore on the test context.
//  *
//  * ```ts
//  * // Add this to any test suite that uses the SyncStore client.
//  * beforeEach((context) => setupSyncStore(context))
//  * ```
//  */
// export async function setupSyncStore(context: TestContext) {
//   if (context.database.kind === "postgres") {
//     const syncStoreConfig = await context.database.getSyncStoreConfig();

//     context.syncStore = new PostgresSyncStore({
//       common: context.common,
//       ...syncStoreConfig,
//     });

//     await context.syncStore.migrateUp();
//   } else {
//     const syncStoreConfig = context.database.getSyncStoreConfig();

//     context.syncStore = new SqliteSyncStore({
//       common: context.common,
//       ...syncStoreConfig,
//     });

//     await context.syncStore.migrateUp();
//   }
// }

// /**
//  * Sets up an isolated IndexingStore on the test context. After setting up,
//  * be sure to set the schema within each test.
//  *
//  * ```ts
//  * // Add this to any test suite that uses the IndexingStore.
//  * beforeEach((context) => setupIndexingStore(context))
//  *
//  * // Set the schema within each test.
//  * test("my test", (context) => {
//  *   context.indexingStore.schema = createSchema({ ... })
//  *   // ...
//  * })
//  * ```
//  */
// export function setupIndexingStore(context: TestContext) {
//   const placeholderSchema = createSchema(() => ({}));

//   if (context.database.kind === "postgres") {
//     const indexingStoreConfig = context.database.getIndexingStoreConfig();

//     context.indexingStore = new PostgresIndexingStore({
//       common: context.common,
//       schema: placeholderSchema,
//       ...indexingStoreConfig,
//     });
//   } else {
//     const indexingStoreConfig = context.database.getIndexingStoreConfig();

//     context.indexingStore = new SqliteIndexingStore({
//       common: context.common,
//       schema: placeholderSchema,
//       ...indexingStoreConfig,
//     });
//   }
// }

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
