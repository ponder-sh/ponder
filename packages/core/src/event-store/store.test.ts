import { hexToNumber, RpcBlock, RpcLog, RpcTransaction } from "viem";
import { expect, test } from "vitest";

import { usdcContractConfig } from "@/_test/constants";
import { blobToBigInt } from "@/utils/decode";

/**
 * This test suite uses the `store` object injected during setup.
 * At the moment, this could be either a PostgresEventStore or a
 * SqliteEventStore; the tests run as expected either way.
 */

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

const blockOneLogs: RpcLog[] = [
  {
    address: "0x15d4c048f83bd7e37d49ea4c83a07267ec4203da",
    blockHash:
      "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0xe6e55f",
    data: "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
    logIndex: "0x6c",
    removed: false,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x000000000000000000000000a00f99bc38b1ecda1fd70eaa1cd31d576a9f46b0",
      "0x000000000000000000000000f16e9b0d03470827a95cdfd0cb8a8a3b46969b91",
    ],
    transactionHash:
      "0xa4b1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    transactionIndex: "0x45",
  },
  {
    address: "0x72d4c048f83bd7e37d49ea4c83a07267ec4203da",
    blockHash:
      "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0xe6e55f",
    data: "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
    logIndex: "0x6d",
    removed: false,
    topics: [],
    transactionHash:
      "0xc3f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    transactionIndex: "0x46",
  },
];

const blockTwo: RpcBlock = {
  ...blockOne,
  number: "0xec6fc7",
  hash: "0xf123644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
  timestamp: "0x63198f70",
  transactions: [],
};

const blockTwoTransactions: RpcTransaction[] = [
  {
    accessList: undefined,
    blockHash:
      "0xf123644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0x10f2c",
    chainId: "0x1",
    from: "0x1",
    gas: "0x4234584",
    gasPrice: "0x45",
    hash: "0xb5f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
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
];

const blockTwoLogs: RpcLog[] = [
  {
    address: "0x93d4c048f83bd7e37d49ea4c83a07267ec4203da",
    blockHash:
      "0xf123644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0xec6fc7",
    data: "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
    logIndex: "0x6e",
    removed: false,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    ],
    transactionHash:
      "0xb5f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    transactionIndex: "0x1",
  },
];

test("insertUnfinalizedBlock inserts block", async (context) => {
  const { eventStore } = context;

  await eventStore.insertUnfinalizedBlock({
    chainId: 1,
    block: blockOne,
    transactions: [],
    logs: [],
  });

  const blocks = await eventStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(1);
});

test("insertUnfinalizedBlock inserts transactions", async (context) => {
  const { eventStore } = context;

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
});

test("insertUnfinalizedBlock inserts logs", async (context) => {
  const { eventStore } = context;

  await eventStore.insertUnfinalizedBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  const logs = await eventStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
});

test("getLogEvents returns log events", async (context) => {
  const { eventStore } = context;

  await eventStore.insertUnfinalizedBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  const logEvents = await eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [{ chainId: 1 }],
  });
  expect(logEvents[0].chainId).toEqual(1);

  expect(logEvents[0].log).toMatchInlineSnapshot(`
    {
      "address": "0x15d4c048f83bd7e37d49ea4c83a07267ec4203da",
      "blockHash": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
      "blockNumber": 15131999n,
      "data": "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
      "id": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd-0x6c",
      "logIndex": 108,
      "removed": false,
      "topics": [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x000000000000000000000000a00f99bc38b1ecda1fd70eaa1cd31d576a9f46b0",
        "0x000000000000000000000000f16e9b0d03470827a95cdfd0cb8a8a3b46969b91",
      ],
      "transactionHash": "0xa4b1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
      "transactionIndex": 69,
    }
  `);

  expect(logEvents[0].block).toMatchInlineSnapshot(`
    {
      "baseFeePerGas": 0n,
      "difficulty": 12730590371363483n,
      "extraData": "0x",
      "gasLimit": 29999943n,
      "gasUsed": 0n,
      "hash": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
      "logsBloom": "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "miner": "0x0000000000000000000000000000000000000000",
      "mixHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "nonce": "0x0000000000000000",
      "number": 15495110n,
      "parentHash": "0xe55516ad8029e53cd32087f14653d851401b05245abb1b2d6ed4ddcc597ac5a6",
      "receiptsRoot": "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
      "sha3Uncles": "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
      "size": 520n,
      "stateRoot": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "timestamp": 1662619503n,
      "totalDifficulty": 58750003716598352816469n,
      "transactionsRoot": "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
    }
  `);

  expect(logEvents[0].transaction).toMatchInlineSnapshot(`
    {
      "blockHash": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
      "blockNumber": 69420n,
      "from": "0x1",
      "gas": 69420420n,
      "gasPrice": 69n,
      "hash": "0xa4b1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
      "input": "0x1",
      "nonce": 1,
      "r": "0x1",
      "s": "0x1",
      "to": "0x1",
      "transactionIndex": 1,
      "type": "legacy",
      "v": 1n,
      "value": 1n,
    }
  `);

  expect(logEvents[1].log).toMatchInlineSnapshot(`
    {
      "address": "0x72d4c048f83bd7e37d49ea4c83a07267ec4203da",
      "blockHash": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
      "blockNumber": 15131999n,
      "data": "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
      "id": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd-0x6d",
      "logIndex": 109,
      "removed": false,
      "topics": [],
      "transactionHash": "0xc3f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
      "transactionIndex": 70,
    }
  `);

  expect(logEvents[1].block).toMatchInlineSnapshot(`
    {
      "baseFeePerGas": 0n,
      "difficulty": 12730590371363483n,
      "extraData": "0x",
      "gasLimit": 29999943n,
      "gasUsed": 0n,
      "hash": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
      "logsBloom": "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "miner": "0x0000000000000000000000000000000000000000",
      "mixHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "nonce": "0x0000000000000000",
      "number": 15495110n,
      "parentHash": "0xe55516ad8029e53cd32087f14653d851401b05245abb1b2d6ed4ddcc597ac5a6",
      "receiptsRoot": "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
      "sha3Uncles": "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
      "size": 520n,
      "stateRoot": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "timestamp": 1662619503n,
      "totalDifficulty": 58750003716598352816469n,
      "transactionsRoot": "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
    }
  `);

  expect(logEvents[1].transaction).toMatchInlineSnapshot(`
    {
      "accessList": [
        {
          "address": "0x1",
          "storageKeys": [
            "0x1",
          ],
        },
      ],
      "blockHash": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
      "blockNumber": 69420n,
      "from": "0x1",
      "gas": 69420420n,
      "gasPrice": 69n,
      "hash": "0xc3f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
      "input": "0x1",
      "nonce": 1,
      "r": "0x1",
      "s": "0x1",
      "to": "0x1",
      "transactionIndex": 1,
      "type": "eip2930",
      "v": 1n,
      "value": 1n,
    }
  `);
});

test("getLogEvents filters on log address", async (context) => {
  const { eventStore } = context;

  await eventStore.insertUnfinalizedBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  const logEvents = await eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [{ chainId: 1, address: blockOneLogs[0].address }],
  });

  expect(logEvents[0].log.address).toBe(blockOneLogs[0].address);
  expect(logEvents).toHaveLength(1);
});

test("getLogEvents filters on multiple log addresses", async (context) => {
  const { eventStore } = context;

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

  const logEvents = await eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [
      {
        chainId: 1,
        address: [blockOneLogs[0].address, blockOneLogs[1].address],
      },
    ],
  });

  expect(logEvents.map((e) => e.log.address)).toMatchObject([
    blockOneLogs[0].address,
    blockOneLogs[1].address,
  ]);
  expect(logEvents).toHaveLength(2);
});

test("getLogEvents filters on single topic", async (context) => {
  const { eventStore } = context;

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

  const logEvents = await eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [
      {
        chainId: 1,
        topics: [blockOneLogs[0].topics[0] as `0x${string}`],
      },
    ],
  });

  expect(logEvents.map((e) => e.log.topics)).toMatchObject([
    blockOneLogs[0].topics,
    blockTwoLogs[0].topics,
  ]);
  expect(logEvents).toHaveLength(2);
});

test("getLogEvents filters on multiple topics", async (context) => {
  const { eventStore } = context;

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

  const logEvents = await eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [
      {
        chainId: 1,
        topics: [
          blockOneLogs[0].topics[0] as `0x${string}`,
          blockOneLogs[0].topics[1] as `0x${string}`,
        ],
      },
    ],
  });

  expect(logEvents[0].log.topics).toMatchObject(blockOneLogs[0].topics);
  expect(logEvents).toHaveLength(1);
});

test("getLogEvents filters on multiple filters", async (context) => {
  const { eventStore } = context;

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

  const logEvents = await eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [
      {
        chainId: 1,
        address: blockOneLogs[0].address,
      },
      {
        chainId: 1,
        topics: [blockTwoLogs[0].topics[0] as `0x${string}`],
      },
    ],
  });

  expect(logEvents[0].log.topics).toMatchObject(blockOneLogs[0].topics);
  expect(logEvents[1].log.topics).toMatchObject(blockTwoLogs[0].topics);
  expect(logEvents).toHaveLength(2);
});

test("getLogEvents filters on fromTimestamp (inclusive)", async (context) => {
  const { eventStore } = context;

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

  const logEvents = await eventStore.getLogEvents({
    fromTimestamp: hexToNumber(blockTwo.timestamp!),
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [{ chainId: 1 }],
  });

  expect(logEvents[0].block.hash).toBe(blockTwo.hash);
  expect(logEvents).toHaveLength(1);
});

test("getLogEvents filters on toTimestamp (inclusive)", async (context) => {
  const { eventStore } = context;

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

  const logEvents = await eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: hexToNumber(blockOne.timestamp!),
    filters: [{ chainId: 1 }],
  });

  expect(logEvents.map((e) => e.block.hash)).toMatchObject([
    blockOne.hash,
    blockOne.hash,
  ]);
  expect(logEvents).toHaveLength(2);
});

test("insertFinalizedLogs inserts logs as finalized", async (context) => {
  const { eventStore } = context;

  await eventStore.insertFinalizedLogs({
    chainId: 1,
    logs: blockOneLogs,
  });

  const logs = await eventStore.db
    .selectFrom("logs")
    .select(["address", "finalized"])
    .execute();

  expect(
    logs.map((l) => ({ ...l, finalized: Number(l.finalized) }))
  ).toMatchObject([
    {
      address: "0x15d4c048f83bd7e37d49ea4c83a07267ec4203da",
      finalized: 1,
    },
    {
      address: "0x72d4c048f83bd7e37d49ea4c83a07267ec4203da",
      finalized: 1,
    },
  ]);
});

test("insertFinalizedBlock inserts block as finalized", async (context) => {
  const { eventStore } = context;

  await eventStore.insertFinalizedBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logFilterRange: {
      blockNumberToCacheFrom: 15131900,
      logFilterKey: "test-filter-key",
      logFilterStartBlockNumber: 15131900,
    },
  });

  const blocks = await eventStore.db
    .selectFrom("blocks")
    .select(["hash", "finalized"])
    .execute();

  expect(
    blocks.map((b) => ({ ...b, finalized: Number(b.finalized) }))
  ).toMatchObject([
    {
      finalized: 1,
      hash: "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    },
  ]);
});

test("insertFinalizedBlock inserts transactions as finalized", async (context) => {
  const { eventStore } = context;

  await eventStore.insertFinalizedBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logFilterRange: {
      blockNumberToCacheFrom: 15131900,
      logFilterKey: "test-filter-key",
      logFilterStartBlockNumber: 15131900,
    },
  });

  const transactions = await eventStore.db
    .selectFrom("transactions")
    .select(["hash", "finalized"])
    .execute();

  expect(
    transactions.map((t) => ({ ...t, finalized: Number(t.finalized) }))
  ).toMatchObject([
    {
      finalized: 1,
      hash: "0xa4b1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    },
    {
      finalized: 1,
      hash: "0xc3f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    },
  ]);
});

test("insertFinalizedBlock inserts a log filter cached interval", async (context) => {
  const { eventStore } = context;

  await eventStore.insertFinalizedBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logFilterRange: {
      blockNumberToCacheFrom: 15131900,
      logFilterKey: "test-filter-key",
      logFilterStartBlockNumber: 15131900,
    },
  });

  const logFilterCachedRanges = await eventStore.getLogFilterCachedRanges({
    filterKey: "test-filter-key",
  });

  expect(logFilterCachedRanges[0]).toMatchObject({
    endBlock: 15495110n,
    endBlockTimestamp: 1662619503n,
    filterKey: "test-filter-key",
    startBlock: 15131900n,
  });
  expect(logFilterCachedRanges).toHaveLength(1);
});

test("insertFinalizedBlock merges cached intervals", async (context) => {
  const { eventStore } = context;

  await eventStore.insertFinalizedBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logFilterRange: {
      blockNumberToCacheFrom: 15131900,
      logFilterKey: "test-filter-key",
      logFilterStartBlockNumber: 15131900,
    },
  });

  await eventStore.insertFinalizedBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logFilterRange: {
      blockNumberToCacheFrom: 15495110,
      logFilterKey: "test-filter-key",
      logFilterStartBlockNumber: 15131900,
    },
  });

  const logFilterCachedRanges = await eventStore.getLogFilterCachedRanges({
    filterKey: "test-filter-key",
  });

  expect(logFilterCachedRanges[0]).toMatchObject({
    endBlock: 15495111n,
    endBlockTimestamp: 1662619504n,
    filterKey: "test-filter-key",
    startBlock: 15131900n,
  });
  expect(logFilterCachedRanges).toHaveLength(1);
});

test("insertFinalizedBlock returns the startingRangeEndTimestamp", async (context) => {
  const { eventStore } = context;

  const { startingRangeEndTimestamp } = await eventStore.insertFinalizedBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logFilterRange: {
      blockNumberToCacheFrom: 15131900,
      logFilterKey: "test-filter-key",
      logFilterStartBlockNumber: 15131900,
    },
  });

  expect(startingRangeEndTimestamp).toBe(hexToNumber(blockOne.timestamp));

  const { startingRangeEndTimestamp: startingRangeEndTimestamp2 } =
    await eventStore.insertFinalizedBlock({
      chainId: 1,
      block: blockTwo,
      transactions: blockTwoTransactions,
      logFilterRange: {
        blockNumberToCacheFrom: 15495110,
        logFilterKey: "test-filter-key",
        logFilterStartBlockNumber: 15131900,
      },
    });

  expect(startingRangeEndTimestamp2).toBe(hexToNumber(blockTwo.timestamp));
});

test("finalizeData updates unfinalized blocks", async (context) => {
  const { eventStore } = context;

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

  await eventStore.finalizeData({
    chainId: 1,
    toBlockNumber: hexToNumber(blockOne.number!),
  });

  const blocks = await eventStore.db
    .selectFrom("blocks")
    .select(["hash", "finalized"])
    .execute();

  expect(blocks.find((b) => b.hash === blockOne.hash)?.finalized).toBe(1);
  expect(blocks.find((b) => b.hash === blockTwo.hash)?.finalized).toBe(0);
});

test("finalizeData updates unfinalized logs", async (context) => {
  const { eventStore } = context;

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

  await eventStore.finalizeData({
    chainId: 1,
    toBlockNumber: hexToNumber(blockOne.number!),
  });

  const logs = await eventStore.db
    .selectFrom("logs")
    .select(["blockNumber", "finalized"])
    .execute();

  logs.forEach((log) => {
    if (
      Number(blobToBigInt(log.blockNumber)) <= hexToNumber(blockOne.number!)
    ) {
      expect(log.finalized).toEqual(1);
    } else {
      expect(log.finalized).toEqual(0);
    }
  });
});

test("insertContractReadResult inserts a contract call", async (context) => {
  const { eventStore } = context;

  await eventStore.insertContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
    finalized: false,
    result: "0x789",
  });

  const contractReadResults = await eventStore.db
    .selectFrom("contractReadResults")
    .selectAll()
    .execute();

  expect(contractReadResults).toHaveLength(1);
  expect(contractReadResults[0]).toMatchObject({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    finalized: 0,
    result: "0x789",
  });
});

test("insertContractReadResult upserts on conflict", async (context) => {
  const { eventStore } = context;

  await eventStore.insertContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
    finalized: false,
    result: "0x789",
  });

  const contractReadResults = await eventStore.db
    .selectFrom("contractReadResults")
    .select(["address", "result"])
    .execute();

  expect(contractReadResults).toHaveLength(1);
  expect(contractReadResults[0]).toMatchObject({
    address: usdcContractConfig.address,
    result: "0x789",
  });

  await eventStore.insertContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
    finalized: false,
    result: "0x789123",
  });

  const contractReadResultsUpdated = await eventStore.db
    .selectFrom("contractReadResults")
    .select(["address", "result"])
    .execute();

  expect(contractReadResultsUpdated).toHaveLength(1);
  expect(contractReadResultsUpdated[0]).toMatchObject({
    address: usdcContractConfig.address,
    result: "0x789123",
  });
});

test("getContractReadResult returns data", async (context) => {
  const { eventStore } = context;

  await eventStore.insertContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
    finalized: false,
    result: "0x789",
  });

  const contractReadResult = await eventStore.getContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
  });

  expect(contractReadResult).toMatchObject({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
    finalized: false,
    result: "0x789",
  });
});

test("getContractReadResult returns null if not found", async (context) => {
  const { eventStore } = context;

  await eventStore.insertContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
    finalized: false,
    result: "0x789",
  });

  const contractReadResult = await eventStore.getContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x125",
    blockNumber: 100n,
  });

  expect(contractReadResult).toBe(null);
});
