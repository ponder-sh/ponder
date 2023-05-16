import SqliteDatabase from "better-sqlite3";
import type { RpcBlock, RpcLog, RpcTransaction } from "viem";
import { expect, test } from "vitest";

import { SqliteBlockchainStore } from "./store";

const buildStore = () => {
  const database = SqliteDatabase(":memory:");
  return new SqliteBlockchainStore({ sqliteDb: database });
};

test("setup creates tables", async () => {
  const store = buildStore();

  await store.setup();

  const tables = await store.db.introspection.getTables();
  expect(tables.map((t) => t.name)).toMatchObject([
    "blocks",
    "contractCalls",
    "logFilterCachedRanges",
    "logs",
    "transactions",
  ]);
});

const rpcBlock: RpcBlock = {
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
  totalDifficulty: "0x1",
  transactions: [],
  transactionsRoot:
    "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
  uncles: [],
};

test("insertUnfinalizedBlock inserts block", async () => {
  const store = buildStore();
  await store.setup();

  await store.insertUnfinalizedBlock({
    chainId: 1,
    block: rpcBlock,
    transactions: [],
    logs: [],
  });

  const blocks = await store.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(1);
});

const legacyTransaction: RpcTransaction = {
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
};

const eip2930Transaction: RpcTransaction = {
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
};

test("insertUnfinalizedBlock inserts transactions", async () => {
  const store = buildStore();
  await store.setup();

  await store.insertUnfinalizedBlock({
    chainId: 1,
    block: rpcBlock,
    transactions: [legacyTransaction, eip2930Transaction],
    logs: [],
  });

  const transactions = await store.db
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(2);
});

const log: RpcLog = {
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
};

const logNoTopics: RpcLog = {
  address: "0x15d4c048f83bd7e37d49ea4c83a07267ec4203da",
  blockHash:
    "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
  blockNumber: "0xe6e55f",
  data: "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
  logIndex: "0x6d",
  removed: false,
  topics: [],
  transactionHash:
    "0xc3f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
  transactionIndex: "0x45",
};

test("insertUnfinalizedBlock inserts logs", async () => {
  const store = buildStore();
  await store.setup();

  await store.insertUnfinalizedBlock({
    chainId: 1,
    block: rpcBlock,
    transactions: [],
    logs: [log, logNoTopics],
  });

  const logs = await store.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
});

test("getLogEvents returns log events", async () => {
  const store = buildStore();
  await store.setup();

  await store.insertUnfinalizedBlock({
    chainId: 1,
    block: rpcBlock,
    transactions: [legacyTransaction, eip2930Transaction],
    logs: [log, logNoTopics],
  });

  const logEvents = await store.getLogEvents({
    chainId: 1,
    fromTimestamp: 0,
    toTimestamp: 0,
  });

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
      "totalDifficulty": 1n,
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
      "maxFeePerGas": null,
      "maxPriorityFeePerGas": null,
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
});
