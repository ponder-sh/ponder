import "@/utils/globals";

import SqliteDatabase from "better-sqlite3";
import moduleAlias from "module-alias";
import path from "node:path";
import { Pool } from "pg";
import { beforeEach } from "vitest";

import { patchSqliteDatabase } from "@/config/database";
import { PostgresEventStore } from "@/event-store/postgres/store";
import { SqliteEventStore } from "@/event-store/sqlite/store";
import type { EventStore } from "@/event-store/store";
import { SqliteUserStore } from "@/user-store/sqlite/store";
import { UserStore } from "@/user-store/store";

import { FORK_BLOCK_NUMBER, FORK_URL, vitalik } from "./constants";
import { poolId, testClient } from "./utils";

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
    store: EventStore;
    userStore: UserStore;
  }
}

beforeEach(async (context) => {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const schema = `vitest_pool_${poolId}`;
    context.store = new PostgresEventStore({ pool, schema });

    // TODO: add PostgresUserStore
  } else {
    const rawSqliteDb = new SqliteDatabase(":memory:");
    const sqliteDb = patchSqliteDatabase({ db: rawSqliteDb });
    context.store = new SqliteEventStore({ sqliteDb });
    context.userStore = new SqliteUserStore({ db: rawSqliteDb });
  }

  await context.store.migrateUp();

  return async () => {
    await context.store.migrateDown();
  };
});

/**
 * Reset the Anvil instance and set defaults shared by all tests.
 */
beforeEach(async () => {
  await testClient.impersonateAccount({ address: vitalik.address });
  await testClient.setAutomine(false);

  return async () => {
    await testClient.reset({
      jsonRpcUrl: FORK_URL,
      blockNumber: FORK_BLOCK_NUMBER,
    });
  };
});
