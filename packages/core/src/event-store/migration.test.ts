import { hexToNumber } from "viem";
import { beforeEach, expect, test } from "vitest";

import {
  blockOne,
  blockOneLogs,
  blockOneTransactions,
  blockTwo,
  blockTwoLogs,
  blockTwoTransactions,
} from "@/_test/constants";
import { setupEventStore } from "@/_test/setup";

beforeEach((context) => setupEventStore(context, { skipMigrateUp: true }));

test("initial migration succeeds", async (context) => {
  const { eventStore } = context;

  const migrations = await eventStore.migrator.getMigrations();
  const { error } = await eventStore.migrator.migrateTo(migrations[0].name);
  expect(error).toBeFalsy();

  await eventStore.insertUnfinalizedBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertUnfinalizedBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  expect(
    await eventStore.db.selectFrom("blocks").selectAll().execute()
  ).toHaveLength(2);

  expect(
    await eventStore.db.selectFrom("transactions").selectAll().execute()
  ).toHaveLength(3);

  await eventStore.finalizeData({
    chainId: 1,
    toBlockNumber: hexToNumber(blockOne.number!),
  });

  expect(
    (
      await eventStore.db
        .selectFrom("blocks")
        .select(["hash", "finalized"])
        .execute()
    ).find((b) => b.hash === blockOne.hash)?.finalized
  ).toBe(1);
}, 15_000);

test("latest migration succeeds", async (context) => {
  const { eventStore } = context;

  const migrations = await eventStore.migrator.getMigrations();

  // Migrate to migration N - 1, then add some data.
  const { error } = await eventStore.migrator.migrateTo(
    migrations[migrations.length - 2].name
  );
  expect(error).toBeFalsy();

  await eventStore.insertUnfinalizedBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertUnfinalizedBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  // Migrate to the target step.
  const { error: latestError } = await eventStore.migrator.migrateTo(
    migrations[migrations.length - 1].name
  );
  expect(latestError).toBeFalsy();

  expect(
    await eventStore.db.selectFrom("blocks").selectAll().execute()
  ).toHaveLength(2);

  expect(
    await eventStore.db.selectFrom("transactions").selectAll().execute()
  ).toHaveLength(3);

  await eventStore.finalizeData({
    chainId: 1,
    toBlockNumber: hexToNumber(blockOne.number!),
  });

  expect(
    (
      await eventStore.db
        .selectFrom("blocks")
        .select(["hash", "finalized"])
        .execute()
    ).find((b) => b.hash === blockOne.hash)?.finalized
  ).toBe(1);
}, 15_000);
