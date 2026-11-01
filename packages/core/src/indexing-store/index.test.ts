import { Effect, Scope } from "effect";
import { zeroAddress } from "viem";
import { expect, test } from "vitest";
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
const createStore = (schema: Schema) =>
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
    // Note: Only the dialect is read. Any query would fail.
    const client = { dialect: "postgres" } as DbClient;
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

  expect(
    await db.find(account, { address: zeroAddress }),
  ).toMatchInlineSnapshot(`
    {
      "address": "0x0000000000000000000000000000000000000000",
      "balance": 1n,
      "name": "a",
    }
  `);
});

// BUG: Updates only apply the `set` keys, so `$onUpdateFn` never runs.
test.fails("update applies $onUpdateFn", async () => {
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
