import {
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { onchainTable } from "@/drizzle/onchain.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import { createIndexingCache } from "./cache.js";
import { createHistoricalIndexingStore } from "./historical.js";

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("flush", async (context) => {
  const schema = {
    account: onchainTable("account", (p) => ({
      address: p.hex().primaryKey(),
      balance: p.bigint().notNull(),
    })),
  };

  const { database } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingCache = createIndexingCache({
    common: context.common,
    database,
    schemaBuild: { schema },
    checkpoint: ZERO_CHECKPOINT_STRING,
  });

  const indexingStore = createHistoricalIndexingStore({
    common: context.common,
    database,
    schemaBuild: { schema },
    indexingCache,
    db: database.qb.drizzle,
  });

  // insert

  // mutate the cache to skip hot loops

  indexingCache.invalidate();

  await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  await indexingStore.insert(schema.account).values({
    address: zeroAddress,
    balance: 10n,
  });

  await indexingCache.flush({ db: database.qb.drizzle });

  let result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    balance: 10n,
  });

  // update

  await indexingStore.update(schema.account, { address: zeroAddress }).set({
    balance: 12n,
  });

  await indexingCache.flush({ db: database.qb.drizzle });

  result = await indexingStore.find(schema.account, {
    address: zeroAddress,
  });

  expect(result).toStrictEqual({
    address: zeroAddress,
    balance: 12n,
  });
});
