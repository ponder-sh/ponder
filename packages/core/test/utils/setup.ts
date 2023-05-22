/* eslint-disable @typescript-eslint/ban-ts-comment */
import SqliteDatabase from "better-sqlite3";
import moduleAlias from "module-alias";
import path from "node:path";
import fetch, { Headers, Request, Response } from "node-fetch";
import { Pool } from "pg";
import { afterAll, beforeEach } from "vitest";

import { PostgresEventStore } from "@/event-store/postgres/store";
import { SqliteEventStore } from "@/event-store/sqlite/store";
import { EventStore } from "@/event-store/store";

import { FORK_BLOCK_NUMBER, FORK_URL } from "./constants";
import { poolId, testClient } from "./utils";

/**
 * Set up a fetch polyfill for test runs using Node <16.
 */
if (!globalThis.fetch) {
  //@ts-ignore
  globalThis.fetch = fetch;
  //@ts-ignore
  globalThis.Headers = Headers;
  //@ts-ignore
  globalThis.Request = Request;
  //@ts-ignore
  globalThis.Response = Response;
}

/**
 * Set up a package alias so we can reference `@ponder/core` by name in test files.
 */
const ponderCoreDir = path.resolve(__dirname, "../../");
moduleAlias.addAlias("@ponder/core", ponderCoreDir);

/**
 * Inject a blockchain store into the test context.
 *
 * If `process.env.DATABASE_URL` is set, assume it's a Postgres connection string
 * and run tests against it. If passed a `schema`, PostgresEventStore will create
 * it if it doesn't exist, then use for all connections. We use the Vitest pool ID as
 * the schema key which enables test isolation (same approach as Anvil.js).
 */
declare module "vitest" {
  export interface TestContext {
    store: EventStore;
  }
}

beforeEach(async (context) => {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const schema = `vitest_pool_${poolId}`;
    context.store = new PostgresEventStore({ pool, schema });
  } else {
    const sqliteDb = SqliteDatabase(":memory:");
    context.store = new SqliteEventStore({ sqliteDb });
  }

  await context.store.migrateUp();

  return async () => await context.store.migrateDown();
});

/**
 * Reset the test client after each test suite (this is basically Anvil.js boilerplate).
 */
afterAll(async () => {
  // This resets the anvil instance to the initial fork block.
  await testClient.reset({
    jsonRpcUrl: FORK_URL,
    blockNumber: FORK_BLOCK_NUMBER,
  });
});

/**
 * Print logs from the Anvil instance whenever a test fails.
 *
 * Also recommended by Anvil.js, but I've not yet found it useful.
 */
// afterEach(async (context) => {
//   context.onTestFailed(async () => {
//     try {
//       const logs = await fetchLogs("http://localhost:8545", poolId);
//       console.log("Anvil instance logs:");
//       console.log(...logs.slice(-5));
//       // eslint-disable-next-line no-empty
//     } catch (e) {}
//   });
// });
