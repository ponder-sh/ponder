import { randomBytes } from "crypto";
import type { Address } from "viem";
import { type TestContext, beforeEach } from "vitest";

import type { Config } from "@/config/config.js";
import type { Network } from "@/config/networks.js";

import type { Common } from "@/Ponder.js";
import { buildOptions } from "@/config/options.js";
import type { Factory, LogFilter } from "@/config/sources.js";
import { UserErrorService } from "@/errors/service.js";
import { PostgresIndexingStore } from "@/indexing-store/postgres/store.js";
import { SqliteIndexingStore } from "@/indexing-store/sqlite/store.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import { LoggerService } from "@/logger/service.js";
import { MetricsService } from "@/metrics/service.js";
import { PostgresSyncStore } from "@/sync-store/postgres/store.js";
import { SqliteSyncStore } from "@/sync-store/sqlite/store.js";
import type { SyncStore } from "@/sync-store/store.js";
import { TelemetryService } from "@/telemetry/service.js";
import pg from "@/utils/pg.js";

import { deploy, simulate } from "./simulate.js";
import { getConfig, getNetworks, getSources, testClient } from "./utils.js";

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
    syncStore: SyncStore;
    indexingStore: IndexingStore;
    sources: [LogFilter, Factory];
    networks: Network[];
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
      cliOptions: { configFile: "", rootDir: "" },
    }),
    telemetryDisabled: true,
  };
  context.common = {
    options,
    logger: new LoggerService({ level: "silent" }),
    errors: new UserErrorService(),
    metrics: new MetricsService(),
    telemetry: new TelemetryService({ options }),
  };
};

/**
 * Sets up an isolated SyncStore on the test context.
 *
 * ```ts
 * // Add this to any test suite that uses the SyncStore client.
 * beforeEach((context) => setupSyncStore(context))
 * ```
 */
export async function setupSyncStore(
  context: TestContext,
  options = { migrateUp: true },
) {
  if (process.env.DATABASE_URL) {
    const testClient = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await testClient.connect();

    const randomSuffix = randomBytes(10).toString("hex");
    const databaseName = `vitest_sync_${randomSuffix}`;
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.pathname = `/${databaseName}`;
    const connectionString = databaseUrl.toString();

    const pool = new pg.Pool({ connectionString });
    await testClient.query(`CREATE DATABASE "${databaseName}"`);

    context.syncStore = new PostgresSyncStore({ common: context.common, pool });

    if (options.migrateUp) await context.syncStore.migrateUp();

    return async () => {
      try {
        await context.syncStore.kill();
        await testClient.query(`DROP DATABASE "${databaseName}"`);
        await testClient.end();
      } catch (e) {
        // This fails in end-to-end tests where the pool has
        // already been shut down during the Ponder instance kill() method.
        // It's fine to ignore the error.
      }
    };
  } else {
    context.syncStore = new SqliteSyncStore({
      common: context.common,
      file: ":memory:",
    });

    if (options.migrateUp) await context.syncStore.migrateUp();

    return async () => {
      await context.syncStore.kill();
    };
  }
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
  if (process.env.DATABASE_URL) {
    const testClient = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await testClient.connect();
    // Create a random database to isolate the tests.
    const randomSuffix = randomBytes(10).toString("hex");
    const databaseName = `vitest_indexing_${randomSuffix}`;
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.pathname = `/${databaseName}`;
    const connectionString = databaseUrl.toString();

    const pool = new pg.Pool({ connectionString });
    await testClient.query(`CREATE DATABASE "${databaseName}"`);

    context.indexingStore = new PostgresIndexingStore({
      common: context.common,
      pool,
    });

    return async () => {
      try {
        await context.indexingStore.kill();
        await testClient.query(`DROP DATABASE "${databaseName}"`);
        await testClient.end();
      } catch (e) {
        // This fails in end-to-end tests where the pool has
        // already been shut down during the Ponder instance kill() method.
        // It's fine to ignore the error.
      }
    };
  } else {
    context.indexingStore = new SqliteIndexingStore({
      common: context.common,
      file: ":memory:",
    });
    return async () => {
      try {
        await context.indexingStore.kill();
      } catch (e) {
        // This fails in end-to-end tests where the pool has
        // already been shut down during the Ponder instance kill() method.
        // It's fine to ignore the error.
      }
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

  context.networks = await getNetworks(context.common);
  context.sources = getSources(addresses) as [LogFilter, Factory];
  context.config = getConfig(addresses);
  context.erc20 = { address: addresses.erc20Address };
  context.factory = { address: addresses.factoryAddress, pair };

  return async () => {
    await testClient.revert({ id: emptySnapshotId });
  };
}
