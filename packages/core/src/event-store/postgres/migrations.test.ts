import type { Kysely } from "kysely";
import { beforeEach, expect, test } from "vitest";

import {
  blockOne,
  blockOneLogs,
  blockOneTransactions,
  contractReadResultOne,
  logFilterCachedRangeOne,
} from "@/_test/constants";
import { setupEventStore } from "@/_test/setup";

import {
  rpcToPostgresBlock,
  rpcToPostgresLog,
  rpcToPostgresTransaction,
} from "./format";

beforeEach((context) => setupEventStore(context, { skipMigrateUp: true }));

const seed_2023_07_18_0_better_indices = async (db: Kysely<any>) => {
  await db
    .insertInto("blocks")
    .values({ ...rpcToPostgresBlock(blockOne), chainId: 1, finalized: 0 })
    .execute();

  for (const transaction of blockOneTransactions) {
    await db
      .insertInto("transactions")
      .values({
        ...rpcToPostgresTransaction(transaction),
        chainId: 1,
        finalized: 0,
      })
      .execute();
  }

  for (const log of blockOneLogs) {
    await db
      .insertInto("logs")
      .values({
        ...rpcToPostgresLog(log),
        chainId: 1,
        finalized: 0,
      })
      .execute();
  }

  await db
    .insertInto("contractReadResults")
    .values({ ...contractReadResultOne, finalized: 1 })
    .execute();

  await db
    .insertInto("logFilterCachedRanges")
    .values(logFilterCachedRangeOne)
    .execute();
};

test("2023_07_18_0_better_indices -> 2023_07_24_0_drop_finalized succeeds", async (context) => {
  const { eventStore } = context;

  if (eventStore.kind !== "postgres") return;

  const { error } = await eventStore.migrator.migrateTo(
    "2023_07_18_0_better_indices"
  );
  expect(error).toBeFalsy();

  await seed_2023_07_18_0_better_indices(eventStore.db);

  const { error: latestError } = await eventStore.migrator.migrateTo(
    "2023_07_24_0_drop_finalized"
  );
  expect(latestError).toBeFalsy();
}, 15_000);
