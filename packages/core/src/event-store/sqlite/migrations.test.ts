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
  rpcToSqliteBlock,
  rpcToSqliteLog,
  rpcToSqliteTransaction,
} from "./format";

beforeEach((context) => setupEventStore(context, { skipMigrateUp: true }));

const seed_2023_07_24_0_drop_finalized = async (db: Kysely<any>) => {
  await db
    .insertInto("blocks")
    .values({ ...rpcToSqliteBlock(blockOne), chainId: 1 })
    .execute();

  for (const transaction of blockOneTransactions) {
    await db
      .insertInto("transactions")
      .values({ ...rpcToSqliteTransaction(transaction), chainId: 1 })
      .execute();
  }

  for (const log of blockOneLogs) {
    await db
      .insertInto("logs")
      .values({ ...rpcToSqliteLog(log), chainId: 1 })
      .execute();
  }

  await db
    .insertInto("contractReadResults")
    .values(contractReadResultOne)
    .execute();

  await db
    .insertInto("logFilterCachedRanges")
    .values({ ...logFilterCachedRangeOne, endBlockTimestamp: 1 })
    .execute();
};

test(
  "2023_07_24_0_drop_finalized succeeds -> 2023_08_05_0_drop_cached_range_end_block_timestamp",
  async (context) => {
    const { eventStore } = context;

    if (eventStore.kind !== "sqlite") return;

    const { error } = await eventStore.migrator.migrateTo(
      "2023_07_24_0_drop_finalized"
    );
    expect(error).toBeFalsy();

    await seed_2023_07_24_0_drop_finalized(eventStore.db);

    const { error: latestError } = await eventStore.migrator.migrateTo(
      "2023_08_05_0_drop_cached_range_end_block_timestamp"
    );
    expect(latestError).toBeFalsy();
  },
  {}
);
