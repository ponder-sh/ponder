import {
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { bigint, hex, onchainTable } from "@/drizzle/onchain.js";
import type { QueryWithTypings } from "drizzle-orm";
import { pgSchema } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import superjson from "superjson";
import { beforeEach, expect, test, vi } from "vitest";
import { client } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

const queryToParams = (query: QueryWithTypings) =>
  new URLSearchParams({ sql: superjson.stringify(query) });

test("client.db", async (context) => {
  globalThis.PONDER_COMMON = context.common;
  globalThis.PONDER_NAMESPACE_BUILD = {
    schema: "public",
    viewsSchema: undefined,
  };

  const account = onchainTable("account", (p) => ({
    address: p.hex().primaryKey(),
    balance: p.bigint(),
  }));

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  globalThis.PONDER_DATABASE = database;

  const app = new Hono().use(
    client({
      db: database.readonlyQB.raw,
      schema: { account },
    }),
  );

  let query = {
    sql: "SELECT * FROM account",
    params: [],
  };

  let response = await app.request(`/sql/db?${queryToParams(query)}`);
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.rows).toStrictEqual([]);

  query = {
    sql: "SELECT 1;",
    params: [],
  };

  response = await app.request(`/sql/db?${queryToParams(query)}`);
  expect(response.status).toBe(200);
});

test("client.db error", async (context) => {
  globalThis.PONDER_COMMON = context.common;
  const { database } = await setupDatabaseServices(context);
  globalThis.PONDER_DATABASE = database;

  const app = new Hono().use(
    client({
      db: database.readonlyQB.raw,
      schema: {},
    }),
  );

  globalThis.PONDER_NAMESPACE_BUILD = {
    schema: "public",
    viewsSchema: undefined,
  };
  globalThis.PONDER_DATABASE = database;

  const query = {
    sql: "SELECT * FROM account",
    params: [],
  };

  const response = await app.request(`/sql/db?${queryToParams(query)}`);
  expect(response.status).toBe(500);
  expect(await response.text()).toContain('relation "account" does not exist');
});

test("client.db search_path", async (context) => {
  globalThis.PONDER_COMMON = context.common;
  globalThis.PONDER_NAMESPACE_BUILD = {
    schema: "Ponder",
    viewsSchema: undefined,
  };

  const schemaAccount = pgSchema("Ponder").table("account", {
    address: hex().primaryKey(),
    balance: bigint(),
  });

  const { database } = await setupDatabaseServices(context, {
    namespaceBuild: {
      schema: "Ponder",
      viewsSchema: undefined,
    },
    schemaBuild: { schema: { account: schemaAccount } },
  });

  globalThis.PONDER_DATABASE = database;

  const app = new Hono().use(
    client({
      db: database.readonlyQB.raw,
      schema: { account: schemaAccount },
    }),
  );

  const query = {
    sql: "SELECT * FROM account",
    params: [],
  };

  const response = await app.request(`/sql/db?${queryToParams(query)}`);
  expect(response.status).toBe(200);
});

test("client.db readonly", async (context) => {
  globalThis.PONDER_COMMON = context.common;
  globalThis.PONDER_NAMESPACE_BUILD = {
    schema: "public",
    viewsSchema: undefined,
  };

  const account = onchainTable("account", (p) => ({
    address: p.hex().primaryKey(),
    balance: p.bigint(),
  }));

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  globalThis.PONDER_DATABASE = database;

  const app = new Hono().use(
    client({ db: database.readonlyQB.raw, schema: { account } }),
  );

  const query = {
    sql: "INSERT INTO account (address, balance) VALUES ('0x123', 100)",
    params: [],
  };

  const response = await app.request(`/sql/db?${queryToParams(query)}`);
  expect(response.status).toBe(500);
  expect(await response.text()).toContain("InsertStmt not supported");
});

test("client.db recursive", async (context) => {
  globalThis.PONDER_COMMON = context.common;
  globalThis.PONDER_NAMESPACE_BUILD = {
    schema: "public",
    viewsSchema: undefined,
  };

  const account = onchainTable("account", (p) => ({
    address: p.hex().primaryKey(),
    balance: p.bigint(),
  }));

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  globalThis.PONDER_DATABASE = database;

  const app = new Hono().use(
    client({ db: database.readonlyQB.raw, schema: { account } }),
  );

  const query = {
    sql: `
WITH RECURSIVE infinite_cte AS (
  SELECT 1 AS num
  UNION ALL
  SELECT num + 1
  FROM infinite_cte
)
SELECT *
FROM infinite_cte;`,
    params: [],
  };

  const response = await app.request(`/sql/db?${queryToParams(query)}`);
  expect(response.status).toBe(500);
  expect(await response.text()).toContain("Recursive CTEs not supported");
});

test("client.db load", async (context) => {
  globalThis.PONDER_COMMON = context.common;
  globalThis.PONDER_NAMESPACE_BUILD = {
    schema: "public",
    viewsSchema: undefined,
  };

  const account = onchainTable("account", (p) => ({
    address: p.hex().primaryKey(),
    balance: p.bigint(),
  }));

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  globalThis.PONDER_DATABASE = database;

  const app = new Hono().use(
    client({
      db: database.readonlyQB.raw,
      schema: { account },
    }),
  );

  const promises = new Array(250).map(async (_, i) => {
    const response = await app.request(
      `/sql/db?${queryToParams({
        sql: `SELECT ${i}`,
        params: [],
      })}`,
    );
    const result = await response.json();
    return result;
  });

  await Promise.all(promises);
});

test("client.db cache", async (context) => {
  // "spy" not possible with pglite
  if (context.databaseConfig.kind !== "postgres") return;

  globalThis.PONDER_COMMON = context.common;
  globalThis.PONDER_NAMESPACE_BUILD = {
    schema: "public",
    viewsSchema: undefined,
  };

  const account = onchainTable("account", (p) => ({
    address: p.hex().primaryKey(),
    balance: p.bigint(),
  }));

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema: { account } },
  });

  globalThis.PONDER_DATABASE = database;

  const app = new Hono().use(
    client({
      db: database.readonlyQB.raw,
      schema: { account },
    }),
  );

  const transactionSpy = vi.spyOn(database.readonlyQB.raw, "transaction");

  const query = {
    sql: "SELECT 1",
    params: [],
  };

  const promise1 = app.request(`/sql/db?${queryToParams(query)}`);
  const promise2 = app.request(`/sql/db?${queryToParams(query)}`);
  const promise3 = app.request(`/sql/db?${queryToParams(query)}`);

  const [response1, response2, response3] = await Promise.all([
    promise1,
    promise2,
    promise3,
  ]);

  expect(response1.status).toBe(200);
  expect(response2.status).toBe(200);
  expect(response3.status).toBe(200);

  expect(transactionSpy).toHaveBeenCalledTimes(1);
});
