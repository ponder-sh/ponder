import SqliteDatabase from "better-sqlite3";
import moduleAlias from "module-alias";
import path from "node:path";
import { Pool } from "pg";
import { type TestContext, beforeEach } from "vitest";

import { patchSqliteDatabase } from "@/config/database";
import { buildOptions } from "@/config/options";
import { UserErrorService } from "@/errors/service";
import { LoggerService } from "@/logs/service";
import { MetricsService } from "@/metrics/service";
import type { Common } from "@/Ponder";
import { PostgresSyncStore } from "@/sync-store/postgres/store";
import { SqliteSyncStore } from "@/sync-store/sqlite/store";
import type { SyncStore } from "@/sync-store/store";
import { TelemetryService } from "@/telemetry/service";
import { PostgresUserStore } from "@/user-store/postgres/store";
import { SqliteUserStore } from "@/user-store/sqlite/store";
import type { UserStore } from "@/user-store/store";

import { FORK_BLOCK_NUMBER, vitalik } from "./constants";
import { poolId, testClient } from "./utils";

/**
 * Set up a package alias so we can reference `@ponder/core` by name in test files.
 */
const ponderCoreDir = path.resolve(__dirname, "../../");
moduleAlias.addAlias("@ponder/core", ponderCoreDir);

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
    userStore: UserStore;
  }
}

beforeEach((context) => {
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
});

/**
 * Sets up an isolated SyncStore on the test context.
 *
 * ```ts
 * // Add this to any test suite that uses the test client.
 * beforeEach((context) => setupSyncStore(context))
 * ```
 */
export async function setupSyncStore(
  context: TestContext,
  options = { migrateUp: true }
) {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const databaseSchema = `vitest_pool_${process.pid}_${poolId}`;
    context.syncStore = new PostgresSyncStore({ pool, databaseSchema });

    if (options.migrateUp) await context.syncStore.migrateUp();

    return async () => {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS "${databaseSchema}" CASCADE`);
        await context.syncStore.kill();
      } catch (e) {
        // This fails in end-to-end tests where the pool has
        // already been shut down during the Ponder instance kill() method.
        // It's fine to ignore the error.
      }
    };
  } else {
    const rawSqliteDb = new SqliteDatabase(":memory:");
    const db = patchSqliteDatabase({ db: rawSqliteDb });
    context.syncStore = new SqliteSyncStore({ db });

    if (options.migrateUp) await context.syncStore.migrateUp();

    return async () => {
      await context.syncStore.kill();
    };
  }
}

/**
 * Sets up an isolated UserStore on the test context.
 *
 * ```ts
 * // Add this to any test suite that uses the test client.
 * beforeEach((context) => setupUserStore(context))
 * ```
 */
export async function setupUserStore(context: TestContext) {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const databaseSchema = `vitest_pool_${process.pid}_${poolId}`;
    context.userStore = new PostgresUserStore({ pool, databaseSchema });
  } else {
    const rawSqliteDb = new SqliteDatabase(":memory:");
    const db = patchSqliteDatabase({ db: rawSqliteDb });
    context.userStore = new SqliteUserStore({ db });
  }

  return async () => {
    try {
      await context.userStore.kill();
    } catch (e) {
      // This fails in end-to-end tests where the pool has
      // already been shut down during the Ponder instance kill() method.
      // It's fine to ignore the error.
    }
  };
}

/**
 * Resets the Anvil instance to the defaults.
 *
 * ```ts
 * // Add this to any test suite that uses the test client.
 * beforeEach(resetTestClient)
 * ```
 */
export async function resetTestClient() {
  await testClient.impersonateAccount({ address: vitalik.address });
  await testClient.setAutomine(false);

  return async () => {
    await testClient.reset({ blockNumber: FORK_BLOCK_NUMBER });
  };
}
