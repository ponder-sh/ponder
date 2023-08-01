import "@/utils/globals";

import SqliteDatabase from "better-sqlite3";
import moduleAlias from "module-alias";
import * as path from "node:path";
import { Pool } from "pg";
import { type TestContext, beforeEach } from "vitest";

import { patchSqliteDatabase } from "@/config/database.js";
import { buildOptions } from "@/config/options.js";
import { UserErrorService } from "@/errors/service.js";
import { PostgresEventStore } from "@/event-store/postgres/store.js";
import { SqliteEventStore } from "@/event-store/sqlite/store.js";
import type { EventStore } from "@/event-store/store.js";
import { LoggerService } from "@/logs/service.js";
import { MetricsService } from "@/metrics/service.js";
import type { Common } from "@/Ponder.js";
import { TelemetryService } from "@/telemetry/service.js";
import { PostgresUserStore } from "@/user-store/postgres/store.js";
import { SqliteUserStore } from "@/user-store/sqlite/store.js";
import type { UserStore } from "@/user-store/store.js";

import { FORK_BLOCK_NUMBER, FORK_URL, vitalik } from "./constants.js";
import { poolId, testClient } from "./utils.js";

/**
 * Set up a package alias so we can reference `@ponder/core` by name in test files.
 */
const ponderCoreDir = path.resolve(__dirname, "../../");
moduleAlias.addAlias("@ponder/core", ponderCoreDir);

/**
 * Inject an isolated event store into the test context.
 *
 * If `process.env.DATABASE_URL` is set, assume it's a Postgres connection string
 * and run tests against it. If passed a `schema`, PostgresEventStore will create
 * it if it doesn't exist, then use for all connections. We use the Vitest pool ID as
 * the schema key which enables test isolation (same approach as Anvil.js).
 */
declare module "vitest" {
  export interface TestContext {
    common: Common;
    eventStore: EventStore;
    userStore: UserStore;
  }
}

beforeEach((context) => {
  const options = buildOptions({ cliOptions: { configFile: "", rootDir: "" } });
  context.common = {
    options,
    logger: new LoggerService({ level: "silent" }),
    errors: new UserErrorService(),
    metrics: new MetricsService(),
    telemetry: new TelemetryService({ options }),
  };
});

/**
 * Sets up an isolated EventStore on the test context.
 *
 * ```ts
 * // Add this to any test suite that uses the test client.
 * beforeEach(async (context) => {
 *   return await setupEventStore(context);
 * })
 * ```
 */
export async function setupEventStore(
  context: TestContext,
  options = { skipMigrateUp: false }
) {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const databaseSchema = `vitest_pool_${process.pid}_${poolId}`;
    context.eventStore = new PostgresEventStore({ pool, databaseSchema });

    if (!options.skipMigrateUp) await context.eventStore.migrateUp();

    return async () => {
      await pool.query(`DROP SCHEMA IF EXISTS "${databaseSchema}" CASCADE`);
    };
  } else {
    const rawSqliteDb = new SqliteDatabase(":memory:");
    const db = patchSqliteDatabase({ db: rawSqliteDb });
    context.eventStore = new SqliteEventStore({ db });

    if (!options.skipMigrateUp) await context.eventStore.migrateUp();

    return;
  }
}

/**
 * Sets up an isolated UserStore on the test context.
 *
 * ```ts
 * // Add this to any test suite that uses the test client.
 * beforeEach(async (context) => {
 *   return await setupUserStore(context);
 * })
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
    await context.userStore.teardown();
  };
}

/**
 * Resets the Anvil instance to the defaults.
 *
 * ```ts
 * // Add this to any test suite that uses the test client.
 * beforeEach(async () => {
 *   return await resetTestClient();
 * })
 * ```
 */
export async function resetTestClient() {
  await testClient.impersonateAccount({ address: vitalik.address });
  await testClient.setAutomine(false);

  return async () => {
    await testClient.reset({
      jsonRpcUrl: FORK_URL,
      blockNumber: FORK_BLOCK_NUMBER,
    });
  };
}
