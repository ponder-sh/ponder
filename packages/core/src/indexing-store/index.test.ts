import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Effect, Scope } from "effect";
import { zeroAddress } from "viem";
import { createTestServices } from "@/_test/utils.js";
import type { DbClient } from "@/database/db.js";
import { onchainTable } from "@/drizzle/onchain.js";
import type { IndexingErrorHandler, Schema } from "@/internal/types.js";
import { createIndexingCache } from "./cache.js";
import { createIndexingStore } from "./index.js";

/**
 * Indexing store backed only by the in-memory cache. Without a crash recovery
 * checkpoint the cache is complete, so reads never query the database.
 */
const createStore = (
  schema: Schema,
  // Note: Only the dialect is read. Any query would fail.
  client = { dialect: "postgres" } as DbClient,
) =>
  Effect.gen(function* () {
    const indexingErrorHandler: IndexingErrorHandler = {
      getRetryableError: () => indexingErrorHandler.error,
      setRetryableError: (error) => {
        indexingErrorHandler.error = error;
      },
      clearRetryableError: () => {
        indexingErrorHandler.error = undefined;
      },
      error: undefined,
    };
    const indexingCache = yield* createIndexingCache({
      schemaBuild: { schema },
      crashRecoveryCheckpoint: undefined,
      eventCount: {},
    });
    const indexingStore = yield* createIndexingStore({
      schemaBuild: { schema },
      indexingCache,
      indexingErrorHandler,
    });
    indexingCache.client = client;
    indexingStore.client = client;
    return indexingStore;
  }).pipe(
    Effect.provide(createTestServices()),
    Scope.provide(Scope.makeUnsafe()),
    Effect.runSync,
  );

test("update", async () => {
  const account = onchainTable("account", (p) => ({
    address: p.hex().primaryKey(),
    name: p.text(),
    balance: p.bigint().notNull(),
  }));
  const { db } = createStore({ account });

  await db.insert(account).values({ address: zeroAddress, balance: 1n });
  await db.update(account, { address: zeroAddress }).set({ name: "a" });

  // Spread the copy-on-write proxy: `bun test` snapshots a Proxy with
  // `JSON.stringify`, which throws on bigints.
  expect({
    ...(await db.find(account, { address: zeroAddress })),
  }).toMatchInlineSnapshot(`
    {
      "address": "0x0000000000000000000000000000000000000000",
      "balance": 1n,
      "name": "a",
    }
  `);
});

test("update applies $onUpdateFn", async () => {
  const account = onchainTable("account", (p) => ({
    address: p.hex().primaryKey(),
    name: p.text(),
    balance: p
      .bigint()
      .notNull()
      .$onUpdateFn(() => 10n),
  }));
  const { db } = createStore({ account });

  await db.insert(account).values({ address: zeroAddress, balance: 1n });
  await db.update(account, { address: zeroAddress }).set({ name: "a" });

  const row = await db.find(account, { address: zeroAddress });
  expect(row?.balance).toBe(10n);
});

test("sql select with columns of the same name", async () => {
  const person = onchainTable("person", (p) => ({
    id: p.text().primaryKey(),
    name: p.text(),
  }));
  const pet = onchainTable("pet", (p) => ({
    id: p.text().primaryKey(),
    ownerId: p.text(),
    name: p.text(),
  }));
  // Note: Like node-postgres and PGlite, the driver returns rows as arrays
  // only in array row mode, and as objects keyed by column name otherwise.
  const columns = ["id", "name", "id", "owner_id", "name"];
  const values = ["p1", "alice", "d1", "p1", "rex"];
  const raw = drizzle(async (_sql, _params, method) => ({
    rows:
      method === "all"
        ? [values]
        : ({
            rows: [Object.fromEntries(columns.map((c, i) => [c, values[i]]))],
          } as unknown as unknown[]),
  }));
  const client = {
    dialect: "postgres",
    query: (build: (db: typeof raw) => unknown) =>
      Effect.promise(async () => await build(raw)),
    transaction: (fn: (tx: DbClient) => unknown) => fn(client),
  } as unknown as DbClient;
  const indexingStore = createStore({ person, pet }, client);

  const rows = await indexingStore.db.sql
    .select()
    .from(person)
    .innerJoin(pet, eq(person.id, pet.ownerId));

  expect(rows).toMatchInlineSnapshot(`
    [
      {
        "person": {
          "id": "p1",
          "name": "alice",
        },
        "pet": {
          "id": "d1",
          "name": "rex",
          "ownerId": "p1",
        },
      },
    ]
  `);
});
