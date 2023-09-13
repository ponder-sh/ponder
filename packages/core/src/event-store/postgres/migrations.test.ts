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
import { intToBlob } from "@/utils/encode";

import {
  rpcToPostgresBlock,
  rpcToPostgresLog,
  rpcToPostgresTransaction,
} from "./format";

beforeEach((context) => setupEventStore(context, { skipMigrateUp: true }));

const seed_2023_07_24_0_drop_finalized = async (db: Kysely<any>) => {
  await db
    .insertInto("blocks")
    .values({
      ...rpcToPostgresBlock(blockOne),
      chainId: 1,
      difficulty: intToBlob(-6674801433877863799524082037340374307n),
    })
    .execute();

  for (const transaction of blockOneTransactions) {
    await db
      .insertInto("transactions")
      .values({
        ...rpcToPostgresTransaction(transaction),
        chainId: 1,
      })
      .execute();
  }

  for (const log of blockOneLogs) {
    await db
      .insertInto("logs")
      .values({
        ...rpcToPostgresLog(log),
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
    .values(logFilterCachedRangeOne)
    .execute();
};

test("2023_07_24_0_drop_finalized -> 2023_09_12_0_use_numeric_for_bigint succeeds", async (context) => {
  const { eventStore } = context;

  if (eventStore.kind !== "postgres") return;

  const { error } = await eventStore.migrator.migrateTo(
    "2023_07_24_0_drop_finalized"
  );
  if (error) console.log(error);
  expect(error).toBeFalsy();

  await seed_2023_07_24_0_drop_finalized(eventStore.db);

  const { error: latestError } = await eventStore.migrator.migrateTo(
    "2023_09_12_0_use_numeric_for_bigint"
  );
  if (latestError) console.log(latestError);
  expect(latestError).toBeFalsy();
}, 15_000);
