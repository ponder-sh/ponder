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

beforeEach((context) => setupEventStore(context, { skipMigrateUp: true }));

const seed_2023_09_19_0_new_sync_design = async (db: Kysely<any>) => {
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
};

test(
  "2023_09_19_0_new_sync_design -> 2023_11_06_0_new_rpc_cache_design succeeds",
  async (context) => {
    const { eventStore } = context;

    if (eventStore.kind !== "sqlite") return;

    const { error } = await eventStore.migrator.migrateTo(
      "2023_09_19_0_new_sync_design"
    );
    expect(error).toBeFalsy();

    await seed_2023_09_19_0_new_sync_design(eventStore.db);

    const { error: latestError } = await eventStore.migrator.migrateTo(
      "2023_11_06_0_new_rpc_cache_design"
    );
    expect(latestError).toBeFalsy();
  },
  {}
);
