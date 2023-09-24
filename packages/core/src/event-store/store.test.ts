import { hexToNumber } from "viem";
import { beforeEach, expect, test } from "vitest";

import {
  blockOne,
  blockOneLogs,
  blockOneTransactions,
  blockTwo,
  blockTwoLogs,
  blockTwoTransactions,
  usdcContractConfig,
} from "@/_test/constants";
import { setupEventStore } from "@/_test/setup";

beforeEach((context) => setupEventStore(context));

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

test("insertRealtimeBlock inserts block", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: [],
    logs: [],
  });

  const blocks = await eventStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(1);
});

test("insertRealtimeBlock inserts transactions", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
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

test("insertRealtimeBlock inserts logs", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  const logs = await eventStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
});

test("insertHistoricalBlock inserts a log filter cached interval", async (context) => {
  const { eventStore } = context;

  await eventStore.insertHistoricalBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logFilterRange: {
      logFilterKey: "test-filter-key",
      blockNumberToCacheFrom: 15131900,
    },
  });

  const logFilterCachedRanges = await eventStore.getLogFilterCachedRanges({
    logFilterKey: "test-filter-key",
  });

  expect(logFilterCachedRanges[0]).toMatchObject({
    endBlock: 15495110,
    endBlockTimestamp: 1662619503,
    filterKey: "test-filter-key",
    startBlock: 15131900,
  });
  expect(logFilterCachedRanges).toHaveLength(1);
});

test("insertLogFilterCachedRanges inserts many cached intervals", async (context) => {
  const { eventStore } = context;

  await eventStore.insertLogFilterCachedRanges({
    logFilterKeys: ["test-filter-key-1", "test-filter-key-2"],
    startBlock: 15131900,
    endBlock: 15495111,
    endBlockTimestamp: 1662619504,
  });

  const logFilterCachedRanges1 = await eventStore.getLogFilterCachedRanges({
    logFilterKey: "test-filter-key-1",
  });

  expect(logFilterCachedRanges1).toHaveLength(1);
  expect(logFilterCachedRanges1[0]).toMatchObject({
    endBlock: 15495111,
    endBlockTimestamp: 1662619504,
    filterKey: "test-filter-key-1",
    startBlock: 15131900,
  });

  const logFilterCachedRanges2 = await eventStore.getLogFilterCachedRanges({
    logFilterKey: "test-filter-key-2",
  });

  expect(logFilterCachedRanges2).toHaveLength(1);
  expect(logFilterCachedRanges2[0]).toMatchObject({
    endBlock: 15495111,
    endBlockTimestamp: 1662619504,
    filterKey: "test-filter-key-2",
    startBlock: 15131900,
  });
});

test("insertLogFilterCachedRanges inserts zero cached intervals without error", async (context) => {
  const { eventStore } = context;

  await eventStore.insertLogFilterCachedRanges({
    logFilterKeys: [],
    startBlock: 15131900,
    endBlock: 15495111,
    endBlockTimestamp: 1662619504,
  });

  const logFilterCachedRanges = await eventStore.getLogFilterCachedRanges({
    logFilterKey: "test-filter-key-1",
  });

  expect(logFilterCachedRanges).toHaveLength(0);
});

test("mergeLogFilterCachedRanges merges cached intervals", async (context) => {
  const { eventStore } = context;

  await eventStore.insertHistoricalBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logFilterRange: {
      logFilterKey: "test-filter-key",
      blockNumberToCacheFrom: 15131900,
    },
  });

  await eventStore.insertHistoricalBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logFilterRange: {
      logFilterKey: "test-filter-key",
      blockNumberToCacheFrom: 15495110,
    },
  });

  await eventStore.mergeLogFilterCachedRanges({
    logFilterKey: "test-filter-key",
    logFilterStartBlockNumber: 15131900,
  });

  const logFilterCachedRanges = await eventStore.getLogFilterCachedRanges({
    logFilterKey: "test-filter-key",
  });

  expect(logFilterCachedRanges[0]).toMatchObject({
    endBlock: 15495111,
    endBlockTimestamp: 1662619504,
    filterKey: "test-filter-key",
    startBlock: 15131900,
  });
  expect(logFilterCachedRanges).toHaveLength(1);
});

test("mergeLogFilterCachedRanges returns the startingRangeEndTimestamp", async (context) => {
  const { eventStore } = context;

  await eventStore.insertHistoricalBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logFilterRange: {
      logFilterKey: "test-filter-key",
      blockNumberToCacheFrom: 15131900,
    },
  });

  const { startingRangeEndTimestamp } =
    await eventStore.mergeLogFilterCachedRanges({
      logFilterKey: "test-filter-key",
      logFilterStartBlockNumber: 15131900,
    });

  expect(startingRangeEndTimestamp).toBe(hexToNumber(blockOne.timestamp));

  await eventStore.insertHistoricalBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logFilterRange: {
      logFilterKey: "test-filter-key",
      blockNumberToCacheFrom: 15495110,
    },
  });

  const { startingRangeEndTimestamp: startingRangeEndTimestamp2 } =
    await eventStore.mergeLogFilterCachedRanges({
      logFilterKey: "test-filter-key",
      logFilterStartBlockNumber: 15131900,
    });

  expect(startingRangeEndTimestamp2).toBe(hexToNumber(blockTwo.timestamp));
});

test("insertContractReadResult inserts a contract call", async (context) => {
  const { eventStore } = context;

  await eventStore.insertContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
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

test("getLogEvents returns log events", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [{ name: "noFilter", chainId: 1 }],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0].logFilterName).toEqual("noFilter");

  expect(events[0].log).toMatchInlineSnapshot(`
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

  expect(events[0].block).toMatchInlineSnapshot(`
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

  expect(events[0].transaction).toMatchInlineSnapshot(`
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

  expect(events[1].log).toMatchInlineSnapshot(`
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

  expect(events[1].block).toMatchInlineSnapshot(`
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

  expect(events[1].transaction).toMatchInlineSnapshot(`
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

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [
      { name: "singleAddress", chainId: 1, address: blockOneLogs[0].address },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0].log.address).toBe(blockOneLogs[0].address);
  expect(events).toHaveLength(1);
});

test("getLogEvents filters on multiple addresses", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [
      {
        name: "multipleAddress",
        chainId: 1,
        address: [blockOneLogs[0].address, blockOneLogs[1].address],
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0]).toMatchObject({
    logFilterName: "multipleAddress",
    log: {
      address: blockOneLogs[0].address,
    },
  });
  expect(events[1]).toMatchObject({
    logFilterName: "multipleAddress",
    log: {
      address: blockOneLogs[1].address,
    },
  });
  expect(events).toHaveLength(2);
});

test("getLogEvents filters on single topic", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [
      {
        name: "singleTopic",
        chainId: 1,
        topics: [blockOneLogs[0].topics[0] as `0x${string}`],
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0]).toMatchObject({
    logFilterName: "singleTopic",
    log: {
      topics: blockOneLogs[0].topics,
    },
  });
  expect(events[1]).toMatchObject({
    logFilterName: "singleTopic",
    log: {
      topics: blockTwoLogs[0].topics,
    },
  });
  expect(events).toHaveLength(2);
});

test("getLogEvents filters on multiple topics", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [
      {
        name: "multipleTopics",
        chainId: 1,
        topics: [
          blockOneLogs[0].topics[0] as `0x${string}`,
          blockOneLogs[0].topics[1] as `0x${string}`,
        ],
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0]).toMatchObject({
    logFilterName: "multipleTopics",
    log: {
      topics: blockOneLogs[0].topics,
    },
  });
  expect(events).toHaveLength(1);
});

test("getLogEvents filters on fromBlock", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [
      {
        name: "fromBlock",
        chainId: 1,
        fromBlock: 15495111,
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0]).toMatchObject({
    logFilterName: "fromBlock",
    block: {
      number: 15495111n,
    },
  });
  expect(events).toHaveLength(1);
});

test("getLogEvents filters on multiple filters", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [
      {
        name: "singleAddress", // This should match blockOneLogs[0]
        chainId: 1,
        address: blockOneLogs[0].address,
      },
      {
        name: "singleTopic", // This should match blockOneLogs[0] AND blockTwoLogs[0]
        chainId: 1,
        topics: [blockOneLogs[0].topics[0] as `0x${string}`],
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0]).toMatchObject({
    logFilterName: "singleAddress",
    log: {
      address: blockOneLogs[0].address,
    },
  });
  expect(events[1]).toMatchObject({
    logFilterName: "singleTopic",
    log: {
      address: blockOneLogs[0].address,
    },
  });
  expect(events[2]).toMatchObject({
    logFilterName: "singleTopic",
    log: {
      topics: blockTwoLogs[0].topics,
    },
  });
});

test("getLogEvents filters on fromTimestamp (inclusive)", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: hexToNumber(blockTwo.timestamp!),
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [{ name: "noFilter", chainId: 1 }],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0].block.hash).toBe(blockTwo.hash);
  expect(events).toHaveLength(1);
});

test("getLogEvents filters on toTimestamp (inclusive)", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: hexToNumber(blockOne.timestamp!),
    filters: [{ name: "noFilter", chainId: 1 }],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events.map((e) => e.block.hash)).toMatchObject([
    blockOne.hash,
    blockOne.hash,
  ]);
  expect(events).toHaveLength(2);
});

test("getLogEvents returns no events if includeEventSelectors is an empty array", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [{ name: "noFilter", chainId: 1, includeEventSelectors: [] }],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events).toHaveLength(0);
});

test("insertHistoricalLogFilterResult merges ranges on insertion", async (context) => {
  const { eventStore } = context;

  await eventStore.insertHistoricalLogFilterResult({
    block: blockOne,
    transactions: [],
    logs: [],
    logFilter: {
      chainId: 1,
      startBlock: 0n,
      endBlock: 100n,
      endBlockTimestamp: 1200n,
    },
  });

  await eventStore.insertHistoricalLogFilterResult({
    block: blockOne,
    transactions: [],
    logs: [],
    logFilter: {
      chainId: 1,
      startBlock: 120n,
      endBlock: 200n,
      endBlockTimestamp: 1500n,
    },
  });

  let logFilterRanges = await eventStore.getLogFilterRanges({
    chainId: 1,
  });

  expect(logFilterRanges).toMatchObject([
    [0, 100],
    [120, 200],
  ]);

  await eventStore.insertHistoricalLogFilterResult({
    block: blockOne,
    transactions: [],
    logs: [],
    logFilter: {
      chainId: 1,
      startBlock: 80n,
      endBlock: 140n,
      endBlockTimestamp: 1500n,
    },
  });

  logFilterRanges = await eventStore.getLogFilterRanges({
    chainId: 1,
  });

  expect(logFilterRanges).toMatchObject([[0, 200]]);
});

test("insertHistoricalLogFilterResult sets log filter range", async (context) => {
  const { eventStore } = context;

  await eventStore.insertHistoricalLogFilterResult({
    block: blockOne,
    transactions: [],
    logs: [],
    logFilter: {
      chainId: 1,
      address: ["0xa", "0xb"],
      topics: [["0xc", "0xd"], null, "0xe", null],
      startBlock: 0n,
      endBlock: 100n,
      endBlockTimestamp: 1200n,
    },
  });

  const logFilterRanges = await eventStore.getLogFilterRanges({
    chainId: 1,
    address: ["0xa", "0xb"],
    topics: [["0xc", "0xd"], null, "0xe", null],
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);
});

test("getLogFilterRanges respects log filter inclusivity rules", async (context) => {
  const { eventStore } = context;

  await eventStore.insertHistoricalLogFilterResult({
    block: blockOne,
    transactions: [],
    logs: [],
    logFilter: {
      chainId: 1,
      address: ["0xa", "0xb"],
      topics: [["0xc", "0xd"], null, "0xe", null],
      startBlock: 0n,
      endBlock: 100n,
      endBlockTimestamp: 1200n,
    },
  });

  // This is a narrower inclusion criteria on `address` and `topic0`. Full range available.
  let logFilterRanges = await eventStore.getLogFilterRanges({
    chainId: 1,
    address: ["0xa"],
    topics: [["0xc"], null, "0xe", null],
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);

  // This is a broader inclusion criteria on `address`. No ranges available.
  logFilterRanges = await eventStore.getLogFilterRanges({
    chainId: 1,
    address: undefined,
    topics: [["0xc"], null, "0xe", null],
  });

  expect(logFilterRanges).toMatchObject([]);

  // This is a narrower inclusion criteria on `topic1`. Full range available.
  logFilterRanges = await eventStore.getLogFilterRanges({
    chainId: 1,
    address: ["0xa"],
    topics: [["0xc"], "0xd", "0xe", null],
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);
});

test("getLogFilterRanges handles complex log filter inclusivity rules", async (context) => {
  const { eventStore } = context;

  await eventStore.insertHistoricalLogFilterResult({
    block: blockOne,
    transactions: [],
    logs: [],
    logFilter: {
      chainId: 1,
      startBlock: 0n,
      endBlock: 100n,
      endBlockTimestamp: 1200n,
    },
  });

  await eventStore.insertHistoricalLogFilterResult({
    block: blockOne,
    transactions: [],
    logs: [],
    logFilter: {
      chainId: 1,
      topics: [null, ["0xc", "0xd"]],
      startBlock: 150n,
      endBlock: 250n,
      endBlockTimestamp: 1500n,
    },
  });

  // Broad criteria only includes broad ranges.
  let logFilterRanges = await eventStore.getLogFilterRanges({
    chainId: 1,
  });
  expect(logFilterRanges).toMatchObject([[0, 100]]);

  // Narrower criteria includes both broad and specific ranges.
  logFilterRanges = await eventStore.getLogFilterRanges({
    chainId: 1,
    topics: [null, "0xc"],
  });
  expect(logFilterRanges).toMatchObject([
    [0, 100],
    [150, 250],
  ]);
});
