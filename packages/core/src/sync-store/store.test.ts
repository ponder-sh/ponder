import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getRawRPCData, publicClient } from "@/_test/utils.js";
import {
  type BlockFilterCriteria,
  type FactoryCriteria,
  type LogFilterCriteria,
  sourceIsFactory,
  sourceIsLog,
} from "@/config/sources.js";
import {
  EVENT_TYPES,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { drainAsyncGenerator } from "@/utils/drainAsyncGenerator.js";
import {
  type Address,
  type Hex,
  checksumAddress,
  getAbiItem,
  getEventSelector,
  hexToBigInt,
  hexToNumber,
  padHex,
  toHex,
} from "viem";
import { beforeEach, expect, test } from "vitest";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("setup creates tables", async (context) => {
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const tables = await syncStore.db.introspection.getTables();
  const tableNames = tables.map((t) => t.name);
  expect(tableNames).toContain("blocks");
  expect(tableNames).toContain("logs");
  expect(tableNames).toContain("transactions");

  expect(tableNames).toContain("logFilters");
  expect(tableNames).toContain("logFilterIntervals");
  expect(tableNames).toContain("factories");
  expect(tableNames).toContain("factoryLogFilterIntervals");

  expect(tableNames).toContain("rpcRequestResults");
  await cleanup();
});

test("insertLogFilterInterval inserts block, transactions, receipts, and logs", async (context) => {
  const { erc20, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);
  const blockNumber = await publicClient.getBlockNumber();

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: erc20.address,
      topics: [],
      includeTransactionReceipts: false,
    },
    ...rpcData.block1,
    interval: {
      startBlock: blockNumber - 3n,
      endBlock: blockNumber,
    },
  });

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(1);

  const transactions = await syncStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(2);

  const transactionReceipts = await syncStore.db
    .selectFrom("transactionReceipts")
    .selectAll()
    .execute();
  expect(transactionReceipts).toHaveLength(2);

  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
  await cleanup();
});

test("insertLogFilterInterval updates sync db metrics", async (context) => {
  const { common, erc20, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);
  const blockNumber = await publicClient.getBlockNumber();

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: erc20.address,
      topics: [],
      includeTransactionReceipts: false,
    },
    ...rpcData.block1,
    interval: {
      startBlock: blockNumber - 3n,
      endBlock: blockNumber,
    },
  });

  const metrics = (await common.metrics.ponder_database_method_duration.get())
    .values;
  const countMetric = metrics
    .filter((m) => m.labels.method === "insertLogFilterInterval")
    .find((m) => m.metricName === "ponder_database_method_duration_count");

  expect(countMetric).toBeTruthy();
  expect(countMetric?.value).toBe(1);
  await cleanup();
});

test("insertLogFilterInterval inserts log filter intervals", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const rpcData = await getRawRPCData(sources);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: ["0xa", "0xb"],
      topics: [["0xc", "0xd"], null, "0xe", null],
      includeTransactionReceipts: false,
    },
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 100n },
  });

  const logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      address: ["0xa", "0xb"],
      topics: [["0xc", "0xd"], null, "0xe", null],
      includeTransactionReceipts: false,
    },
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);
  await cleanup();
});

test("insertLogFilterInterval merges ranges on insertion", async (context) => {
  const { erc20, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: erc20.address,
      topics: [],
      includeTransactionReceipts: false,
    },
    ...rpcData.block1,
    interval: {
      startBlock: 2n,
      endBlock: 2n,
    },
  });

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: erc20.address,
      topics: [],
      includeTransactionReceipts: false,
    },
    ...rpcData.block3,
    interval: {
      startBlock: 4n,
      endBlock: 4n,
    },
  });

  let logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      address: erc20.address,
      topics: [],
      includeTransactionReceipts: false,
    },
  });

  expect(logFilterRanges).toMatchObject([
    [2, 2],
    [4, 4],
  ]);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: erc20.address,
      topics: [],
      includeTransactionReceipts: false,
    },
    ...rpcData.block2,
    interval: {
      startBlock: 3n,
      endBlock: 3n,
    },
  });

  logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      address: erc20.address,
      topics: [],
      includeTransactionReceipts: false,
    },
  });

  expect(logFilterRanges).toMatchObject([[2, 4]]);
  await cleanup();
});

test("insertLogFilterInterval merges log intervals inserted concurrently", async (context) => {
  const { erc20, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await Promise.all([
    syncStore.insertLogFilterInterval({
      chainId: 1,
      logFilter: {
        address: erc20.address,
        topics: [],
        includeTransactionReceipts: false,
      },
      ...rpcData.block1,
      interval: {
        startBlock: 2n,
        endBlock: 2n,
      },
    }),
    syncStore.insertLogFilterInterval({
      chainId: 1,
      logFilter: {
        address: erc20.address,
        topics: [],
        includeTransactionReceipts: false,
      },
      ...rpcData.block2,
      interval: {
        startBlock: 3n,
        endBlock: 3n,
      },
    }),
    syncStore.insertLogFilterInterval({
      chainId: 1,
      logFilter: {
        address: erc20.address,
        topics: [],
        includeTransactionReceipts: false,
      },
      ...rpcData.block3,
      interval: {
        startBlock: 4n,
        endBlock: 4n,
      },
    }),
  ]);

  const logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      address: erc20.address,
      topics: [],
      includeTransactionReceipts: false,
    },
  });

  expect(logFilterRanges).toMatchObject([[2, 4]]);
  await cleanup();
});

test("insertLogFilterInterval updates log checkpoints on conflict", async (context) => {
  const { erc20, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: rpcData.block2.logs,
  });

  let logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(1);
  expect(logs[0].checkpoint).toBe(null);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: erc20.address,
      topics: [],
      includeTransactionReceipts: false,
    },
    ...rpcData.block2,
    interval: {
      startBlock: 3n,
      endBlock: 3n,
    },
  });

  logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(1);
  expect(logs[0].checkpoint).toBeTruthy();

  await cleanup();
});

test("getLogFilterIntervals respects log filter inclusivity rules", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: ["0xa", "0xb"],
      topics: [["0xc", "0xd"], null, "0xe", null],
      includeTransactionReceipts: false,
    },
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 100n },
  });

  // This is a narrower inclusion criteria on `address` and `topic0`. Full range is available.
  let logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      address: ["0xa"],
      topics: [["0xc"], null, "0xe", null],
      includeTransactionReceipts: false,
    },
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);

  // This is a broader inclusion criteria on `address`. No ranges available.
  logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      address: undefined,
      topics: [["0xc"], null, "0xe", null],
      includeTransactionReceipts: false,
    },
  });

  expect(logFilterRanges).toMatchObject([]);

  // This is a narrower inclusion criteria on `topic1`. Full range available.
  logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      address: ["0xa"],
      topics: [["0xc"], "0xd", "0xe", null],
      includeTransactionReceipts: false,
    },
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);
  await cleanup();
});

test("getLogFilterRanges handles complex log filter inclusivity rules", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: { topics: [], includeTransactionReceipts: false },
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 100n },
  });

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      topics: [null, ["0xc", "0xd"], null, null],
      includeTransactionReceipts: false,
    },
    ...rpcData.block1,
    interval: { startBlock: 150n, endBlock: 250n },
  });

  // Broad criteria only includes broad intervals.
  let logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { topics: [], includeTransactionReceipts: false },
  });
  expect(logFilterIntervals).toMatchObject([[0, 100]]);

  // Narrower criteria includes both broad and specific intervals.
  logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      topics: [null, "0xc", null, null],
      includeTransactionReceipts: false,
    },
  });
  expect(logFilterIntervals).toMatchObject([
    [0, 100],
    [150, 250],
  ]);
  await cleanup();
});

test("getLogFilterIntervals merges overlapping intervals that both match a filter", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      topics: [["0xc", "0xd"], null, null, null],
      includeTransactionReceipts: false,
    },
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 50n },
  });

  // Broad criteria only includes broad intervals.
  let logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      address: "0xaddress",
      topics: [["0xc"], null, null, null],
      includeTransactionReceipts: false,
    },
  });
  expect(logFilterIntervals).toMatchObject([[0, 50]]);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: "0xaddress",
      topics: [["0xc"], null, null, null],
      includeTransactionReceipts: false,
    },
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 100n },
  });

  logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      address: "0xaddress",
      topics: [["0xc"], null, null, null],
      includeTransactionReceipts: false,
    },
  });

  expect(logFilterIntervals).toMatchObject([[0, 100]]);

  await cleanup();
});

test("getLogFilterIntervals handles includeTransactionReceipts", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      topics: ["0x0"],
      includeTransactionReceipts: false,
    },
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 100n },
  });

  // This is an exact match on `includeTransactionReceipts`. Full range is available.
  let logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      topics: ["0x0"],
      includeTransactionReceipts: false,
    },
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);

  // This is a broader inclusion criteria on `includeTransactionReceipts`. No ranges available.
  logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      topics: ["0x0"],
      includeTransactionReceipts: true,
    },
  });

  expect(logFilterRanges).toMatchObject([]);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      topics: ["0x1"],
      includeTransactionReceipts: true,
    },
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 100n },
  });

  // This is an exact match on `includeTransactionReceipts`. Full range is available.
  logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      topics: ["0x1"],
      includeTransactionReceipts: true,
    },
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);

  // This is a broader inclusion criteria on `includeTransactionReceipts`. Full range is available.
  logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      topics: ["0x1"],
      includeTransactionReceipts: false,
    },
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);

  await cleanup();
});

test("insertFactoryChildAddressLogs inserts logs", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: rpcData.block2.logs,
  });

  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(1);
  await cleanup();
});

test("getFactoryChildAddresses gets child addresses for topic location", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
    topics: [],
    includeTransactionReceipts: false,
  } satisfies FactoryCriteria;

  await syncStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: [
      {
        ...rpcData.block1.logs[0],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child10000000000000000000000000000000000",
          "0x000000000000000000000000child20000000000000000000000000000000000",
        ],
        blockNumber: toHex(100),
      },
      {
        ...rpcData.block1.logs[1],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child30000000000000000000000000000000000",
          "0x000000000000000000000000child40000000000000000000000000000000000",
        ],
        blockNumber: toHex(100),
      },
    ],
  });

  let iterator = syncStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    fromBlock: 0n,
    toBlock: 150n,
  });

  let results = [];
  for await (const page of iterator) results.push(...page);

  expect(results).toMatchObject([
    "0xchild10000000000000000000000000000000000",
    "0xchild30000000000000000000000000000000000",
  ]);

  iterator = syncStore.getFactoryChildAddresses({
    chainId: 1,
    factory: { ...factoryCriteria, childAddressLocation: "topic2" },
    fromBlock: 0n,
    toBlock: 150n,
  });

  results = [];
  for await (const page of iterator) results.push(...page);

  expect(results).toMatchObject([
    "0xchild20000000000000000000000000000000000",
    "0xchild40000000000000000000000000000000000",
  ]);
  await cleanup();
});

test("getFactoryChildAddresses gets child addresses for offset location", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "offset32",
    topics: [],
    includeTransactionReceipts: false,
  } satisfies FactoryCriteria;

  await syncStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: [
      {
        ...rpcData.block1.logs[0],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
        ],
        data: "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000child10000000000000000000000000000000000000000000000000000000000child30000000000000000000000000000000000",
        blockNumber: toHex(100),
      },
      {
        ...rpcData.block1.logs[1],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
        ],
        data: "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000child20000000000000000000000000000000000000000000000000000000000child30000000000000000000000000000000000",
        blockNumber: toHex(100),
      },
    ],
  });

  const iterator = syncStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    fromBlock: 0n,
    toBlock: 150n,
  });

  const results = [];
  for await (const page of iterator) results.push(...page);

  expect(results).toMatchObject([
    "0xchild10000000000000000000000000000000000",
    "0xchild20000000000000000000000000000000000",
  ]);
  await cleanup();
});

test("getFactoryChildAddresses respects toBlock argument", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
    topics: [],
    includeTransactionReceipts: false,
  } satisfies FactoryCriteria;

  await syncStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: [
      {
        ...rpcData.block1.logs[0],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child10000000000000000000000000000000000",
        ],
        blockNumber: toHex(100),
      },
      {
        ...rpcData.block1.logs[1],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child20000000000000000000000000000000000",
        ],
        blockNumber: toHex(200),
      },
    ],
  });

  let iterator = syncStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    fromBlock: 0n,
    toBlock: 150n,
  });

  let results = [];
  for await (const page of iterator) results.push(...page);

  expect(results).toMatchObject(["0xchild10000000000000000000000000000000000"]);

  iterator = syncStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    fromBlock: 0n,
    toBlock: 250n,
  });

  results = [];
  for await (const page of iterator) results.push(...page);

  expect(results).toMatchObject([
    "0xchild10000000000000000000000000000000000",
    "0xchild20000000000000000000000000000000000",
  ]);
  await cleanup();
});

test("getFactoryChildAddresses paginates correctly", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
    topics: [],
    includeTransactionReceipts: false,
  } satisfies FactoryCriteria;

  await syncStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: [
      // Include one log that doesn't match the factory criteria.
      {
        ...rpcData.block1.logs[0],
        blockNumber: toHex(150),
        blockHash:
          "0x000000000000000000000000child80000000000000000000000000000000000",
        logIndex: "0x8",
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignaturf",
          "0x000000000000000000000000child80000000000000000000000000000000000",
        ],
      },
      {
        ...rpcData.block1.logs[1],
        blockNumber: toHex(200),
        blockHash:
          "0x000000000000000000000000child20000000000000000000000000000000000",
        logIndex: "0x2",
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child20000000000000000000000000000000000",
        ],
      },
      // Include two logs in the same block.
      {
        ...rpcData.block1.logs[1],
        blockNumber: toHex(201),
        blockHash:
          "0x000000000000000000000000child30000000000000000000000000000000000",
        logIndex: "0x3",
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child30000000000000000000000000000000000",
        ],
      },
      {
        ...rpcData.block1.logs[1],
        blockNumber: toHex(201),
        blockHash:
          "0x000000000000000000000000child30000000000000000000000000000000000",
        logIndex: "0x4",
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child40000000000000000000000000000000000",
        ],
      },
      {
        ...rpcData.block1.logs[0],
        blockNumber: toHex(100),
        blockHash:
          "0x000000000000000000000000child10000000000000000000000000000000000",
        logIndex: "0x1",
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child10000000000000000000000000000000000",
        ],
      },
      {
        ...rpcData.block1.logs[1],
        blockNumber: toHex(203),
        blockHash:
          "0x000000000000000000000000child50000000000000000000000000000000000",
        logIndex: "0x5",
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child50000000000000000000000000000000000",
        ],
      },
    ],
  });

  const iterator = syncStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    fromBlock: 0n,
    toBlock: 1000n,
    pageSize: 2,
  });

  const results = [];
  for await (const page of iterator) results.push(...page);
  expect(results.sort()).toMatchObject(
    [
      "0xchild10000000000000000000000000000000000",
      "0xchild20000000000000000000000000000000000",
      "0xchild30000000000000000000000000000000000",
      "0xchild40000000000000000000000000000000000",
      "0xchild50000000000000000000000000000000000",
    ].sort(),
  );

  await cleanup();
});

test("getFactoryChildAddresses does not yield empty list", async (context) => {
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
    topics: [],
    includeTransactionReceipts: false,
  } satisfies FactoryCriteria;

  const iterator = syncStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    fromBlock: 0n,
    toBlock: 1000n,
  });

  let didYield = false;
  for await (const _page of iterator) {
    didYield = true;
  }

  expect(didYield).toBe(false);
  await cleanup();
});

test("insertFactoryLogFilterInterval inserts block, transactions, receipts and logs", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
    topics: [],
    includeTransactionReceipts: false,
  } satisfies FactoryCriteria;

  await syncStore.insertFactoryLogFilterInterval({
    chainId: 1,
    factory: factoryCriteria,
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 500n },
  });

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(1);

  const transactions = await syncStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(2);

  const transactionReceipts = await syncStore.db
    .selectFrom("transactionReceipts")
    .selectAll()
    .execute();
  expect(transactionReceipts).toHaveLength(2);

  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
  await cleanup();
});

test("insertFactoryLogFilterInterval inserts and merges child contract intervals", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
    topics: [],
    includeTransactionReceipts: false,
  } satisfies FactoryCriteria;

  await syncStore.insertFactoryLogFilterInterval({
    chainId: 1,
    factory: factoryCriteria,
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 500n },
  });

  await syncStore.insertFactoryLogFilterInterval({
    chainId: 1,
    factory: factoryCriteria,
    ...rpcData.block3,
    interval: { startBlock: 750n, endBlock: 1000n },
  });

  let intervals = await syncStore.getFactoryLogFilterIntervals({
    chainId: 1,
    factory: factoryCriteria,
  });

  expect(intervals).toMatchObject([
    [0, 500],
    [750, 1000],
  ]);

  await syncStore.insertFactoryLogFilterInterval({
    chainId: 1,
    factory: factoryCriteria,
    ...rpcData.block2,
    interval: { startBlock: 501n, endBlock: 800n },
  });

  intervals = await syncStore.getFactoryLogFilterIntervals({
    chainId: 1,
    factory: factoryCriteria,
  });

  expect(intervals).toMatchObject([[0, 1000]]);
  await cleanup();
});

test("getFactoryLogFilterIntervals handles topic filtering rules", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
    topics: [],
    includeTransactionReceipts: false,
  } satisfies FactoryCriteria;

  await syncStore.insertFactoryLogFilterInterval({
    chainId: 1,
    factory: factoryCriteria,
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 500n },
  });

  let intervals = await syncStore.getFactoryLogFilterIntervals({
    chainId: 1,
    factory: factoryCriteria,
  });

  expect(intervals).toMatchObject([[0, 500]]);

  intervals = await syncStore.getFactoryLogFilterIntervals({
    chainId: 1,
    factory: {
      ...factoryCriteria,
      topics: [
        "0x0000000000000000000000000000000000000000000factoryeventsignature",
        null,
        null,
        null,
      ],
    } as FactoryCriteria,
  });

  expect(intervals).toMatchObject([[0, 500]]);
  await cleanup();
});

test("getFactoryLogFilterIntervals handles includeTransactionReceipts", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria: FactoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
    topics: ["0x0"],
    includeTransactionReceipts: false,
  };

  await syncStore.insertFactoryLogFilterInterval({
    chainId: 1,
    factory: factoryCriteria,
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 500n },
  });

  let intervals = await syncStore.getFactoryLogFilterIntervals({
    chainId: 1,
    factory: factoryCriteria,
  });

  expect(intervals).toMatchObject([[0, 500]]);

  intervals = await syncStore.getFactoryLogFilterIntervals({
    chainId: 1,
    factory: {
      ...factoryCriteria,
      includeTransactionReceipts: true,
    } as FactoryCriteria,
  });

  expect(intervals).toMatchObject([]);

  factoryCriteria.includeTransactionReceipts = true;
  factoryCriteria.topics = ["0x1"];

  await syncStore.insertFactoryLogFilterInterval({
    chainId: 1,
    factory: factoryCriteria,
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 500n },
  });

  intervals = await syncStore.getFactoryLogFilterIntervals({
    chainId: 1,
    factory: factoryCriteria,
  });

  expect(intervals).toMatchObject([[0, 500]]);

  intervals = await syncStore.getFactoryLogFilterIntervals({
    chainId: 1,
    factory: {
      ...factoryCriteria,
      includeTransactionReceipts: false,
    } as FactoryCriteria,
  });

  expect(intervals).toMatchObject([[0, 500]]);

  await cleanup();
});

test("insertBlockFilterIntervals inserts block", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertBlockFilterInterval({
    chainId: 1,
    blockFilter: {
      interval: 1,
      offset: 0,
    },
    block: rpcData.block1.block,
    interval: {
      startBlock: hexToBigInt(rpcData.block1.block.number),
      endBlock: hexToBigInt(rpcData.block1.block.number),
    },
  });

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(1);

  await cleanup();
});

test("insertBlockFilterIntervals inserts block filter intervals", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const rpcData = await getRawRPCData(sources);

  await syncStore.insertBlockFilterInterval({
    chainId: 1,
    blockFilter: {
      interval: 1,
      offset: 0,
    },
    block: rpcData.block1.block,
    interval: { startBlock: 0n, endBlock: 100n },
  });

  const blockFilterRanges = await syncStore.getBlockFilterIntervals({
    chainId: 1,
    blockFilter: {
      interval: 1,
      offset: 0,
    },
  });

  expect(blockFilterRanges).toMatchObject([[0, 100]]);
  await cleanup();
});

test("insertBlockFilterIntervals merges on insertion", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const rpcData = await getRawRPCData(sources);

  await syncStore.insertBlockFilterInterval({
    chainId: 1,
    blockFilter: {
      interval: 1,
      offset: 0,
    },
    block: rpcData.block1.block,
    interval: {
      startBlock: hexToBigInt(rpcData.block1.block.number),
      endBlock: hexToBigInt(rpcData.block1.block.number),
    },
  });

  await syncStore.insertBlockFilterInterval({
    chainId: 1,
    blockFilter: {
      interval: 1,
      offset: 0,
    },
    block: rpcData.block3.block,
    interval: {
      startBlock: hexToBigInt(rpcData.block3.block.number),
      endBlock: hexToBigInt(rpcData.block3.block.number),
    },
  });

  let blockFilterRanges = await syncStore.getBlockFilterIntervals({
    chainId: 1,
    blockFilter: {
      interval: 1,
      offset: 0,
    },
  });

  expect(blockFilterRanges).toMatchObject([
    [2, 2],
    [4, 4],
  ]);

  await syncStore.insertBlockFilterInterval({
    chainId: 1,
    blockFilter: {
      interval: 1,
      offset: 0,
    },
    block: rpcData.block2.block,
    interval: {
      startBlock: hexToBigInt(rpcData.block2.block.number),
      endBlock: hexToBigInt(rpcData.block2.block.number),
    },
  });

  blockFilterRanges = await syncStore.getBlockFilterIntervals({
    chainId: 1,
    blockFilter: {
      interval: 1,
      offset: 0,
    },
  });

  expect(blockFilterRanges).toMatchObject([[2, 4]]);

  await cleanup();
});

test("getBlockFilterIntervals retrns interval", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const rpcData = await getRawRPCData(sources);

  await syncStore.insertBlockFilterInterval({
    chainId: 1,
    blockFilter: {
      interval: 4,
      offset: 1,
    },
    block: rpcData.block1.block,
    interval: { startBlock: 10n, endBlock: 100n },
  });

  const blockFilterRanges = await syncStore.getBlockFilterIntervals({
    chainId: 1,
    blockFilter: {
      interval: 4,
      offset: 1,
    },
  });

  expect(blockFilterRanges).toMatchObject([[10, 100]]);
  await cleanup();
});

test("insertRealtimeBlock inserts data", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(1);

  const transactions = await syncStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(2);

  const transactionReceipts = await syncStore.db
    .selectFrom("logs")
    .selectAll()
    .execute();
  expect(transactionReceipts).toHaveLength(2);

  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
  await cleanup();
});

test("insertRealtimeBlock upserts transactions", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
    transactions: [
      rpcData.block1.transactions[0],
      {
        ...rpcData.block1.transactions[1],
        blockNumber: "0x69",
        blockHash: "0x68",
        transactionIndex: "0x67",
      },
    ],
  });

  const transactions = await syncStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(2);

  expect(BigInt(transactions[0].blockNumber)).toBe(2n);

  expect(BigInt(transactions[1].blockNumber)).toBe(hexToBigInt("0x69"));
  expect(transactions[1].blockHash).toBe("0x68");
  expect(BigInt(transactions[1].transactionIndex)).toBe(hexToBigInt("0x67"));

  await cleanup();
});

test("insertRealtimeInterval inserts intervals", async (context) => {
  const { erc20 } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const logFilterCriteria = {
    address: erc20.address,
    topics: [],
    includeTransactionReceipts: false,
  } satisfies LogFilterCriteria;

  const factoryCriteriaOne = {
    address: "0xparent",
    eventSelector: "0xa",
    childAddressLocation: "topic1",
    topics: [],
    includeTransactionReceipts: false,
  } satisfies FactoryCriteria;

  const factoryCriteriaTwo = {
    address: "0xparent",
    eventSelector: "0xa",
    childAddressLocation: "offset64",
    topics: [],
    includeTransactionReceipts: false,
  } satisfies FactoryCriteria;

  const blockFilterCriteria = {
    interval: 10,
    offset: 0,
  } satisfies BlockFilterCriteria;

  await syncStore.insertRealtimeInterval({
    chainId: 1,
    logFilters: [logFilterCriteria],
    factories: [factoryCriteriaOne, factoryCriteriaTwo],
    blockFilters: [blockFilterCriteria],
    interval: { startBlock: 500n, endBlock: 550n },
  });

  expect(
    await syncStore.getLogFilterIntervals({
      chainId: 1,
      logFilter: logFilterCriteria,
    }),
  ).toMatchObject([[500, 550]]);

  // Confirm log filters have been inserted for factory child address logs.
  expect(
    await syncStore.getLogFilterIntervals({
      chainId: 1,
      logFilter: {
        address: factoryCriteriaOne.address,
        topics: [factoryCriteriaOne.eventSelector, null, null, null],
        includeTransactionReceipts: false,
      },
    }),
  ).toMatchObject([[500, 550]]);
  expect(
    await syncStore.getLogFilterIntervals({
      chainId: 1,
      logFilter: {
        address: factoryCriteriaOne.address,
        topics: [factoryCriteriaOne.eventSelector, null, null, null],
        includeTransactionReceipts: false,
      },
    }),
  ).toMatchObject([[500, 550]]);

  // Also confirm factory log filters have been inserted.
  expect(
    await syncStore.getFactoryLogFilterIntervals({
      chainId: 1,
      factory: factoryCriteriaOne,
    }),
  ).toMatchObject([[500, 550]]);
  expect(
    await syncStore.getFactoryLogFilterIntervals({
      chainId: 1,
      factory: factoryCriteriaTwo,
    }),
  ).toMatchObject([[500, 550]]);

  // Confirm block filters have been inserted
  expect(
    await syncStore.getBlockFilterIntervals({
      chainId: 1,
      blockFilter: blockFilterCriteria,
    }),
  ).toMatchObject([[500, 550]]);

  await cleanup();
});

test("deleteRealtimeData deletes logs", async (context) => {
  const { erc20, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: erc20.address,
      topics: [],
      includeTransactionReceipts: false,
    },
    ...rpcData.block1,
    interval: {
      startBlock: 2n,
      endBlock: 2n,
    },
  });

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: erc20.address,
      topics: [],
      includeTransactionReceipts: false,
    },
    ...rpcData.block2,
    interval: {
      startBlock: 3n,
      endBlock: 3n,
    },
  });

  let logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(3);

  await syncStore.deleteRealtimeData({
    chainId: 1,
    fromBlock: 2n,
  });

  logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
  await cleanup();
});

test("insertRpcRequestResult inserts a request result", async (context) => {
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  await syncStore.insertRpcRequestResult({
    chainId: 1,
    request: "0x123",
    blockNumber: 100n,
    result: "0x789",
  });

  const rpcRequestResults = await syncStore.db
    .selectFrom("rpcRequestResults")
    .selectAll()
    .execute();

  expect(rpcRequestResults).toHaveLength(1);
  expect(rpcRequestResults[0]).toMatchObject({
    chainId: 1,
    request: "0x123",
    result: "0x789",
  });
  await cleanup();
});

test("insertRpcRequestResult upserts on conflict", async (context) => {
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  await syncStore.insertRpcRequestResult({
    chainId: 1,
    request: "0x123",
    blockNumber: 100n,
    result: "0x789",
  });

  const rpcRequestResult = await syncStore.db
    .selectFrom("rpcRequestResults")
    .selectAll()
    .execute();

  expect(rpcRequestResult).toHaveLength(1);
  expect(rpcRequestResult[0]).toMatchObject({
    request: "0x123",
    result: "0x789",
  });

  await syncStore.insertRpcRequestResult({
    chainId: 1,
    request: "0x123",
    blockNumber: 100n,
    result: "0x789123",
  });

  const rpcRequestResultsUpdated = await syncStore.db
    .selectFrom("rpcRequestResults")
    .selectAll()
    .execute();

  expect(rpcRequestResultsUpdated).toHaveLength(1);
  expect(rpcRequestResultsUpdated[0]).toMatchObject({
    request: "0x123",
    result: "0x789123",
  });
  await cleanup();
});

test("getRpcRequestResult returns data", async (context) => {
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  await syncStore.insertRpcRequestResult({
    chainId: 1,
    request: "0x123",
    blockNumber: 100n,
    result: "0x789",
  });

  const rpcRequestResult = await syncStore.getRpcRequestResult({
    chainId: 1,
    request: "0x123",
    blockNumber: 100n,
  });

  expect(rpcRequestResult).toMatchObject({
    chainId: 1,
    request: "0x123",
    blockNumber: 100n,
    result: "0x789",
  });
  await cleanup();
});

test("getRpcRequestResult returns null if not found", async (context) => {
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  await syncStore.insertRpcRequestResult({
    chainId: 1,
    request: "0x123",
    blockNumber: 100n,
    result: "0x789",
  });

  const rpcRequestResult = await syncStore.getRpcRequestResult({
    request: "0x125",
    chainId: 1,
    blockNumber: 100n,
  });

  expect(rpcRequestResult).toBe(null);
  await cleanup();
});

test("getLogEvents returns log events", async (context) => {
  const { erc20, sources, factory } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });
  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });
  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block3,
  });

  const ag = syncStore.getLogEvents({
    sources: sources.filter((s) => sourceIsFactory(s) || sourceIsLog(s)),
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(3);

  expect(events[0].log!.address).toBe(checksumAddress(erc20.address));
  expect(events[0].block.hash).toBe(rpcData.block1.block.hash);
  expect(events[0].transaction!.hash).toBe(rpcData.block1.transactions[0].hash);
  expect(events[0].transactionReceipt).toBeUndefined();

  expect(events[1].log!.address).toBe(checksumAddress(erc20.address));
  expect(events[1].block.hash).toBe(rpcData.block1.block.hash);
  expect(events[1].transaction!.hash).toBe(rpcData.block1.transactions[1].hash);
  expect(events[1].transactionReceipt).toBeUndefined();

  expect(events[2].log!.address).toBe(checksumAddress(factory.pair));
  expect(events[2].block.hash).toBe(rpcData.block3.block.hash);
  expect(events[2].transaction!.hash).toBe(rpcData.block3.transactions[0].hash);
  expect(events[2].transactionReceipt).toBeUndefined();

  await cleanup();
});

test("getLogEvents returns log events with receipts", async (context) => {
  const { erc20, sources, factory } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });
  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });
  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block3,
  });

  const ag = syncStore.getLogEvents({
    // @ts-ignore
    sources: sources
      .filter((s) => sourceIsLog(s) || sourceIsFactory(s))
      .map((s) => ({
        ...s,
        criteria: { ...s.criteria, includeTransactionReceipts: true },
      })),
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(3);

  expect(events[0].log!.address).toBe(checksumAddress(erc20.address));
  expect(events[0].block.hash).toBe(rpcData.block1.block.hash);
  expect(events[0].transaction!.hash).toBe(rpcData.block1.transactions[0].hash);
  expect(events[0].transactionReceipt?.transactionHash).toBe(
    rpcData.block1.transactionReceipts[0].transactionHash,
  );

  expect(events[1].log!.address).toBe(checksumAddress(erc20.address));
  expect(events[1].block.hash).toBe(rpcData.block1.block.hash);
  expect(events[1].transaction!.hash).toBe(rpcData.block1.transactions[1].hash);
  expect(events[1].transactionReceipt?.transactionHash).toBe(
    rpcData.block1.transactionReceipts[1].transactionHash,
  );

  expect(events[2].log!.address).toBe(checksumAddress(factory.pair));
  expect(events[2].block.hash).toBe(rpcData.block3.block.hash);
  expect(events[2].transaction!.hash).toBe(rpcData.block3.transactions[0].hash);
  expect(events[2].transactionReceipt?.transactionHash).toBe(
    rpcData.block3.transactionReceipts[0].transactionHash,
  );

  await cleanup();
});

test("getLogEvents with block filters", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });
  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });
  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block3,
  });

  const ag = syncStore.getLogEvents({
    sources,
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(4);

  await cleanup();
});

test("getLogEvents filters on log filter with multiple addresses", async (context) => {
  const { erc20, sources, factory } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const ag = syncStore.getLogEvents({
    sources: [
      {
        ...sources[0],
        criteria: {
          address: [erc20.address, factory.pair],
          topics: [],
          includeTransactionReceipts: false,
        },
      },
    ],
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({
    log: {
      address: checksumAddress(erc20.address),
    },
  });
  expect(events[1]).toMatchObject({
    log: {
      address: checksumAddress(erc20.address),
    },
  });
  await cleanup();
});

test("getLogEvents filters on log filter with single topic", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const transferSelector = getEventSelector(
    getAbiItem({ abi: erc20ABI, name: "Transfer" }),
  );

  const ag = syncStore.getLogEvents({
    sources: [
      {
        ...sources[0],
        criteria: {
          topics: [transferSelector, null, null, null],
          includeTransactionReceipts: false,
        },
      },
    ],
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({
    log: {
      topics: rpcData.block1.logs[0].topics,
    },
  });
  expect(events[1]).toMatchObject({
    log: {
      topics: rpcData.block1.logs[1].topics,
    },
  });
  await cleanup();
});

test("getLogEvents filters on log filter with multiple topics", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const transferSelector = getEventSelector(
    getAbiItem({ abi: erc20ABI, name: "Transfer" }),
  );

  const ag = syncStore.getLogEvents({
    sources: [
      {
        ...sources[0],
        criteria: {
          topics: [
            transferSelector,
            padHex(ALICE).toLowerCase() as Hex,
            null,
            null,
          ],
          includeTransactionReceipts: false,
        },
      },
    ],
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events[0]).toMatchObject({
    log: {
      topics: [
        transferSelector,
        padHex(ALICE).toLowerCase(),
        padHex(BOB).toLowerCase(),
      ],
    },
  });
  expect(events).toHaveLength(1);
  await cleanup();
});

test("getLogEvents filters on simple factory", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: rpcData.block2.logs,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    block: rpcData.block3.block,
    transactions: rpcData.block3.transactions,
    logs: rpcData.block3.logs,
    transactionReceipts: rpcData.block3.transactionReceipts,
  });

  const ag = syncStore.getLogEvents({
    sources: [sources[1]],
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    log: { topics: rpcData.block3.logs[0].topics },
  });
  await cleanup();
});

test("getLogEvents filters on startBlock", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const ag = syncStore.getLogEvents({
    sources: [
      { ...sources[0], startBlock: hexToNumber(rpcData.block3.block.number) },
    ],
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(0);
  await cleanup();
});

test("getLogEvents filters on endBlock", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const ag = syncStore.getLogEvents({
    sources: [
      { ...sources[0], endBlock: hexToNumber(rpcData.block1.block.number) - 1 },
    ],
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(0);
  await cleanup();
});

test("getLogEvents filters on fromCheckpoint (exclusive)", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const ag = syncStore.getLogEvents({
    sources: [sources[0]],
    fromCheckpoint: {
      chainId: 1n,
      blockTimestamp: Number(rpcData.block1.block.timestamp!),
      blockNumber: 2n,
      transactionIndex: 0n,
      eventType: EVENT_TYPES.logs,
      // Should exclude the 1st log in the first block.
      eventIndex: hexToBigInt(rpcData.block1.logs[0].logIndex!),
    },
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(1);
  expect(events[0].block.hash).toBe(rpcData.block1.block.hash);
  await cleanup();
});

test("getLogEvents filters on toCheckpoint (inclusive)", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const ag = syncStore.getLogEvents({
    sources: [sources[0]],
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: {
      chainId: 1n,
      blockTimestamp: Number(rpcData.block1.block.timestamp!),
      blockNumber: 2n,
      transactionIndex: 1n,
      eventType: EVENT_TYPES.logs,
      // Should include the 2nd log in the first block.
      eventIndex: hexToBigInt(rpcData.block1.logs[1].logIndex!),
    },
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(2);
  expect(events.map((e) => e.block.hash)).toMatchObject([
    rpcData.block1.block.hash,
    rpcData.block1.block.hash,
  ]);
  await cleanup();
});

test("getLogEvents multiple sources", async (context) => {
  const { erc20, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  const transferSelector = getEventSelector(
    getAbiItem({ abi: erc20ABI, name: "Transfer" }),
  );

  const ag = syncStore.getLogEvents({
    sources: [
      sources[0],
      {
        ...sources[0],
        id: "kevin",
        criteria: {
          ...sources[0].criteria,
          topics: [transferSelector, padHex(ALICE).toLowerCase() as Address],
        },
      },
    ],
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(3);

  expect(events[0].sourceId).toBe("Erc20_mainnet");
  expect(events[0].log!.address).toBe(checksumAddress(erc20.address));
  expect(events[0].block.hash).toBe(rpcData.block1.block.hash);
  expect(events[0].transaction!.hash).toBe(rpcData.block1.transactions[0].hash);

  expect(events[1].sourceId).toBe("Erc20_mainnet");
  expect(events[1].log!.address).toBe(checksumAddress(erc20.address));
  expect(events[1].block.hash).toBe(rpcData.block1.block.hash);
  expect(events[1].transaction!.hash).toBe(rpcData.block1.transactions[1].hash);

  expect(events[2].sourceId).toBe("kevin");
  expect(events[2].log!.address).toBe(checksumAddress(erc20.address));
  expect(events[2].block.hash).toBe(rpcData.block1.block.hash);
  expect(events[2].transaction!.hash).toBe(rpcData.block1.transactions[1].hash);

  await cleanup();
});

test("getLogEvents event filter on factory", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: rpcData.block2.logs,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    block: rpcData.block3.block,
    transactions: rpcData.block3.transactions,
    logs: rpcData.block3.logs,
    transactionReceipts: [],
  });

  const ag = syncStore.getLogEvents({
    sources: [
      {
        ...sources[1],
        criteria: { ...sources[1].criteria, topics: [`0x${"0".repeat(64)}`] },
      },
    ],
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(0);
  await cleanup();
});

test("getLogEvents multichain", async (context) => {
  const { erc20, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  const ag = syncStore.getLogEvents({
    sources: [
      sources[0],
      {
        ...sources[0],
        id: "kevin",
        chainId: 2,
      },
    ],
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(2);

  expect(events[0].sourceId).toBe("Erc20_mainnet");
  expect(events[0].log!.address).toBe(checksumAddress(erc20.address));
  expect(events[0].block.hash).toBe(rpcData.block1.block.hash);
  expect(events[0].transaction!.hash).toBe(rpcData.block1.transactions[0].hash);

  expect(events[1].sourceId).toBe("Erc20_mainnet");
  expect(events[1].log!.address).toBe(checksumAddress(erc20.address));
  expect(events[1].block.hash).toBe(rpcData.block1.block.hash);
  expect(events[1].transaction!.hash).toBe(rpcData.block1.transactions[1].hash);

  await cleanup();
});

test("getLogEvents pagination", async (context) => {
  const { erc20, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  const ag = syncStore.getLogEvents({
    sources,
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 1,
  });

  const firstBatchEvents = await ag.next();

  expect(firstBatchEvents.done).toBe(false);
  expect(firstBatchEvents.value).toHaveLength(1);

  expect(firstBatchEvents.value[0].log.address).toBe(
    checksumAddress(erc20.address),
  );
  expect(firstBatchEvents.value[0].block.hash).toBe(rpcData.block1.block.hash);
  expect(firstBatchEvents.value[0].transaction.hash).toBe(
    rpcData.block1.transactions[0].hash,
  );

  const secondBatchEvents = await ag.next();

  expect(secondBatchEvents.done).toBe(false);
  expect(secondBatchEvents.value).toHaveLength(1);

  expect(secondBatchEvents.value[0].log.address).toBe(
    checksumAddress(erc20.address),
  );
  expect(secondBatchEvents.value[0].block.hash).toBe(rpcData.block1.block.hash);
  expect(secondBatchEvents.value[0].transaction.hash).toBe(
    rpcData.block1.transactions[1].hash,
  );

  const thirdBatchEvents = await ag.next();

  expect(thirdBatchEvents.done).toBe(true);

  await cleanup();
});

test("getLogEvents empty", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const ag = syncStore.getLogEvents({
    sources,
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(0);

  await cleanup();
});

test("getLastEventCheckpoint", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  const lastEventCheckpoint = await syncStore.getLastEventCheckpoint({
    sources,
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
  });

  expect(lastEventCheckpoint?.blockNumber).toBe(2n);
  expect(lastEventCheckpoint?.transactionIndex).toBe(1n);
  expect(lastEventCheckpoint?.eventIndex).toBe(1n);

  await cleanup();
});

test("getLastEventCheckpoint empty", async (context) => {
  const { sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const lastEventCheckpoint = await syncStore.getLastEventCheckpoint({
    sources,
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
  });
  expect(lastEventCheckpoint).toBe(undefined);

  await cleanup();
});
