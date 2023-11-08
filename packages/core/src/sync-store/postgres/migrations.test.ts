import type { Kysely } from "kysely";
import { beforeEach, expect, test } from "vitest";

import {
  blockOne,
  blockOneLogs,
  blockOneTransactions,
  contractReadResultOne,
} from "@/_test/constants";
import { setupSyncStore } from "@/_test/setup";

import {
  rpcToPostgresBlock,
  rpcToPostgresLog,
  rpcToPostgresTransaction,
} from "./format";

beforeEach((context) => setupSyncStore(context, { migrateUp: false }));

const seed_2023_09_19_0_new_sync_design = async (db: Kysely<any>) => {
  await db
    .insertInto("blocks")
    .values({ ...rpcToPostgresBlock(blockOne), chainId: 1 })
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
};

test("2023_09_19_0_new_sync_design -> 2023_11_06_0_new_rpc_cache_design succeeds", async (context) => {
  const { syncStore } = context;

  if (syncStore.kind !== "postgres") return;

  const { error } = await syncStore.migrator.migrateTo(
    "2023_09_19_0_new_sync_design"
  );
  expect(error).toBeFalsy();

  await seed_2023_09_19_0_new_sync_design(syncStore.db);

  const { error: latestError } = await syncStore.migrator.migrateTo(
    "2023_11_06_0_new_rpc_cache_design"
  );
  expect(latestError).toBeFalsy();
}, 15_000);
