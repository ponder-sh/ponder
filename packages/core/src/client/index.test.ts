import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { onchainTable } from "@/drizzle/onchain.js";
import type { QueryWithTypings } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, expect, test } from "vitest";
import { client } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);

const queryToParams = (query: QueryWithTypings) =>
  new URLSearchParams({ sql: JSON.stringify(query) });

test("client.db", async (context) => {
  const account = onchainTable("account", (p) => ({
    address: p.hex().primaryKey(),
    balance: p.bigint(),
  }));

  const { database, cleanup } = await setupDatabaseServices(context, {
    schema: { account },
  });
  global.PONDER_LISTEN_CONNECTION =
    // @ts-ignore
    database.driver.listen ?? database.driver.instance;

  const app = new Hono().use(client({ db: database.qb.drizzleReadonly }));

  const query = {
    sql: "SELECT * FROM account",
    params: [],
  };

  const response = await app.request(`/client/db?${queryToParams(query)}`);
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.rows).toStrictEqual([]);

  await cleanup();
});

test("client.db error", async (context) => {
  const { database, cleanup } = await setupDatabaseServices(context);
  global.PONDER_LISTEN_CONNECTION =
    // @ts-ignore
    database.driver.listen ?? database.driver.instance;

  const app = new Hono().use(client({ db: database.qb.drizzleReadonly }));

  const query = {
    sql: "SELECT * FROM account",
    params: [],
  };

  const response = await app.request(`/client/db?${queryToParams(query)}`);
  expect(response.status).toBe(500);
  expect(await response.text()).toContain('relation "account" does not exist');

  await cleanup();
});
