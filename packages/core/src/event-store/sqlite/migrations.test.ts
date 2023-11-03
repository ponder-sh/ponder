import type { Kysely } from "kysely";
import { beforeEach, expect, test } from "vitest";

import {
  blockOne,
  blockOneLogs,
  blockOneTransactions,
  contractReadResultOne,
} from "@/_test/constants";
import { setupEventStore } from "@/_test/setup";

import {
  rpcToSqliteBlock,
  rpcToSqliteLog,
  rpcToSqliteTransaction,
} from "./format";

beforeEach((context) => setupEventStore(context, { migrateUp: false }));

const seed_2023_07_24_0_drop_finalized = async (db: Kysely<any>) => {
  await db
    .insertInto("blocks")
    .values({ ...rpcToSqliteBlock(blockOne), chainId: 1 })
    .execute();

  for (const transaction of blockOneTransactions) {
    await db
      .insertInto("transactions")
      .values({
        ...rpcToSqliteTransaction(transaction),
        chainId: 1,
      })
      .execute();
  }

  for (const log of blockOneLogs) {
    await db
      .insertInto("logs")
      .values({
        ...rpcToSqliteLog(log),
        chainId: 1,
      })
      .execute();
  }

  await db
    .insertInto("contractReadResults")
    .values(contractReadResultOne)
    .execute();

  await db
    .insertInto("logFilterCachedRanges")
    .values({
      filterKey:
        '1-0x93d4c048f83bd7e37d49ea4c83a07267ec4203da-["0x1",null,"0x3"]',
      startBlock: 16000010,
      endBlock: 16000090,
      endBlockTimestamp: 16000010,
    })
    .execute();
};

test("2023_07_24_0_drop_finalized -> 2023_09_19_0_new_sync_design succeeds", async (context) => {
  const { eventStore } = context;

  if (eventStore.kind !== "sqlite") return;

  const { error } = await eventStore.migrator.migrateTo(
    "2023_07_24_0_drop_finalized"
  );
  expect(error).toBeFalsy();

  await seed_2023_07_24_0_drop_finalized(eventStore.db);

  const { error: latestError } = await eventStore.migrator.migrateTo(
    "2023_09_19_0_new_sync_design"
  );
  expect(latestError).toBeFalsy();
});
