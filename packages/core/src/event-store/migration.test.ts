import { hexToNumber } from "viem";
import { beforeEach, expect, test } from "vitest";

import { blockOne, blockOneTransactions, blockTwo } from "@/_test/constants";
import { setupEventStore } from "@/_test/setup";

beforeEach(
  async (context) => await setupEventStore(context, { skipMigrateUp: true })
);

test("indices migrations works correctly", async (context) => {
  const { eventStore } = context;
  let migrations;

  // Fetch migrations and run initial migration
  migrations = await eventStore.migrator.getMigrations();
  await eventStore.migrator.migrateTo(migrations[0].name);

  migrations = await eventStore.migrator.getMigrations();
  expect(migrations[0].executedAt).toBeDefined();
  expect(migrations[1].executedAt).toBeUndefined();

  // Insert a block
  await eventStore.insertUnfinalizedBlock({
    chainId: 1,
    block: blockOne,
    transactions: [],
    logs: [],
  });

  const blocksAfterFirstMigration = await eventStore.db
    .selectFrom("blocks")
    .selectAll()
    .execute();
  expect(blocksAfterFirstMigration).toHaveLength(1);

  // Run the second migration
  await eventStore.migrator.migrateTo(migrations[1].name);
  migrations = await eventStore.migrator.getMigrations();
  expect(migrations[1].executedAt).toBeDefined();

  await eventStore.insertUnfinalizedBlock({
    chainId: 1,
    block: blockTwo,
    transactions: [],
    logs: [],
  });

  const blockAfterSecondMigration = await eventStore.db
    .selectFrom("blocks")
    .selectAll()
    .execute();

  expect(blockAfterSecondMigration).toHaveLength(2);

  await eventStore.insertUnfinalizedBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: [],
  });

  const transactions = await eventStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(2);

  await eventStore.finalizeData({
    chainId: 1,
    toBlockNumber: hexToNumber(blockOne.number!),
  });

  const blocks = await eventStore.db
    .selectFrom("blocks")
    .select(["hash", "finalized"])
    .execute();

  expect(blocks.find((b) => b.hash === blockOne.hash)?.finalized).toBe(1);
});
