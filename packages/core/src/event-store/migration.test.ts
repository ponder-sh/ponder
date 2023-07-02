import "@/utils/globals";

import { hexToNumber, RpcBlock, RpcTransaction } from "viem";
import { beforeEach, expect, test } from "vitest";

import { setupEventStore } from "@/_test/setup";

beforeEach(
  async (context) => await setupEventStore(context, { skipMigrateUp: true })
);
test("setup creates tables", async (context) => {
  const { eventStore } = context;

  const tables = await eventStore.db.introspection.getTables();
  const tableNames = tables.map((t) => t.name);
  expect(tableNames).toContain("blocks");
  expect(tableNames).toContain("contractReadResults");
  expect(tableNames).toContain("logFilterCachedRanges");
  expect(tableNames).toContain("logs");
  expect(tableNames).toContain("transactions");
});

const blockOne: RpcBlock = {
  baseFeePerGas: "0x0",
  difficulty: "0x2d3a678cddba9b",
  extraData: "0x",
  gasLimit: "0x1c9c347",
  gasUsed: "0x0",
  hash: "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
  logsBloom:
    "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  miner: "0x0000000000000000000000000000000000000000",
  mixHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  nonce: "0x0000000000000000",
  number: "0xec6fc6",
  parentHash:
    "0xe55516ad8029e53cd32087f14653d851401b05245abb1b2d6ed4ddcc597ac5a6",
  receiptsRoot:
    "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
  sealFields: [
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    "0x0000000000000000",
  ],
  sha3Uncles:
    "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
  size: "0x208",
  stateRoot:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  timestamp: "0x63198f6f",
  totalDifficulty: "0xc70d815d562d3cfa955",
  transactions: [],
  transactionsRoot:
    "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
  uncles: [],
};

const blockOneTransactions: RpcTransaction[] = [
  // Legacy transaction.
  {
    accessList: undefined,
    blockHash:
      "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0x10f2c",
    chainId: "0x1",
    from: "0x1",
    gas: "0x4234584",
    gasPrice: "0x45",
    hash: "0xa4b1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    input: "0x1",
    nonce: "0x1",
    r: "0x1",
    s: "0x1",
    to: "0x1",
    transactionIndex: "0x1",
    type: "0x0",
    v: "0x1",
    value: "0x1",
  },
  // EIP-2930 transaction.
  {
    accessList: [
      {
        address: "0x1",
        storageKeys: ["0x1"],
      },
    ],
    blockHash:
      "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0x10f2c",
    chainId: "0x1",
    from: "0x1",
    gas: "0x4234584",
    gasPrice: "0x45",
    hash: "0xc3f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    input: "0x1",
    maxFeePerGas: undefined,
    maxPriorityFeePerGas: undefined,
    nonce: "0x1",
    r: "0x1",
    s: "0x1",
    to: "0x1",
    transactionIndex: "0x1",
    type: "0x1",
    v: "0x1",
    value: "0x1",
  },
];

const blockTwo: RpcBlock = {
  ...blockOne,
  number: "0xec6fc7",
  hash: "0xf123644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
  timestamp: "0x63198f70",
  transactions: [],
};

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
