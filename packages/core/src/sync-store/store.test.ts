import { checksumAddress, hexToBigInt, toHex } from "viem";
import { beforeEach, expect, test } from "vitest";

import { setupAnvil, setupSyncStore } from "@/_test/setup.js";
import { getRawRPCData, publicClient } from "@/_test/utils.js";
import type { FactoryCriteria, LogFilterCriteria } from "@/config/sources.js";
import { maxCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";

beforeEach((context) => setupAnvil(context));
beforeEach((context) => setupSyncStore(context));

test("setup creates tables", async ({ syncStore }) => {
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
});

test("insertLogFilterInterval inserts block, transactions, and logs", async ({
  syncStore,
  erc20,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);
  const blockNumber = await publicClient.getBlockNumber();

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: { address: erc20.address },
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

  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
});

test("insertLogFilterInterval updates sync db metrics", async ({
  syncStore,
  common,
  erc20,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);
  const blockNumber = await publicClient.getBlockNumber();

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: { address: erc20.address },
    ...rpcData.block1,
    interval: {
      startBlock: blockNumber - 3n,
      endBlock: blockNumber,
    },
  });

  const metrics = (await common.metrics.ponder_sync_store_method_duration.get())
    .values;
  const countMetric = metrics
    .filter((m) => m.labels.method === "insertLogFilterInterval")
    .find((m) => m.metricName === "ponder_sync_store_method_duration_count");

  expect(countMetric).toBeTruthy();
  expect(countMetric?.value).toBe(1);
});

test("insertLogFilterInterval inserts log filter intervals", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: ["0xa", "0xb"],
      topics: [["0xc", "0xd"], null, "0xe", null],
    },
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 100n },
  });

  const logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      address: ["0xa", "0xb"],
      topics: [["0xc", "0xd"], null, "0xe", null],
    },
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);
});

test("insertLogFilterInterval merges ranges on insertion", async ({
  syncStore,
  erc20,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: { address: erc20.address },
    ...rpcData.block1,
    interval: {
      startBlock: hexToBigInt(rpcData.block1.block.number!),
      endBlock: hexToBigInt(rpcData.block1.block.number!),
    },
  });

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: { address: erc20.address },
    ...rpcData.block3,
    interval: {
      startBlock: hexToBigInt(rpcData.block3.block.number!),
      endBlock: hexToBigInt(rpcData.block3.block.number!),
    },
  });

  let logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { address: erc20.address },
  });

  expect(logFilterRanges).toMatchObject([
    [
      Number(rpcData.block1.block.number!),
      Number(rpcData.block1.block.number!),
    ],
    [
      Number(rpcData.block3.block.number!),
      Number(rpcData.block3.block.number!),
    ],
  ]);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: { address: erc20.address },
    ...rpcData.block2,
    interval: {
      startBlock: hexToBigInt(rpcData.block2.block.number!),
      endBlock: hexToBigInt(rpcData.block2.block.number!),
    },
  });

  logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { address: erc20.address },
  });

  expect(logFilterRanges).toMatchObject([
    [
      Number(rpcData.block1.block.number!),
      Number(rpcData.block3.block.number!),
    ],
  ]);
});

test("insertLogFilterInterval merges log intervals inserted concurrently", async ({
  syncStore,
  erc20,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  await Promise.all([
    syncStore.insertLogFilterInterval({
      chainId: 1,
      logFilter: { address: erc20.address },
      ...rpcData.block1,
      interval: {
        startBlock: hexToBigInt(rpcData.block1.block.number!),
        endBlock: hexToBigInt(rpcData.block1.block.number!),
      },
    }),
    syncStore.insertLogFilterInterval({
      chainId: 1,
      logFilter: { address: erc20.address },
      ...rpcData.block2,
      interval: {
        startBlock: hexToBigInt(rpcData.block2.block.number!),
        endBlock: hexToBigInt(rpcData.block2.block.number!),
      },
    }),
    syncStore.insertLogFilterInterval({
      chainId: 1,
      logFilter: { address: erc20.address },
      ...rpcData.block3,
      interval: {
        startBlock: hexToBigInt(rpcData.block3.block.number!),
        endBlock: hexToBigInt(rpcData.block3.block.number!),
      },
    }),
  ]);

  const logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { address: erc20.address },
  });

  expect(logFilterRanges).toMatchObject([
    [
      Number(rpcData.block1.block.number!),
      Number(rpcData.block3.block.number!),
    ],
  ]);
});

test("getLogFilterIntervals respects log filter inclusivity rules", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: ["0xa", "0xb"],
      topics: [["0xc", "0xd"], null, "0xe", null],
    },
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 100n },
  });

  // This is a narrower inclusion criteria on `address` and `topic0`. Full range is available.
  let logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { address: ["0xa"], topics: [["0xc"], null, "0xe", null] },
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);

  // This is a broader inclusion criteria on `address`. No ranges available.
  logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { address: undefined, topics: [["0xc"], null, "0xe", null] },
  });

  expect(logFilterRanges).toMatchObject([]);

  // This is a narrower inclusion criteria on `topic1`. Full range available.
  logFilterRanges = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { address: ["0xa"], topics: [["0xc"], "0xd", "0xe", null] },
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);
});

test("getLogFilterRanges handles complex log filter inclusivity rules", async ({
  syncStore,

  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {},
    ...rpcData.block1,
    interval: { startBlock: 0n, endBlock: 100n },
  });

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: { topics: [null, ["0xc", "0xd"], null, null] },
    ...rpcData.block1,
    interval: { startBlock: 150n, endBlock: 250n },
  });

  // Broad criteria only includes broad intervals.
  let logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {},
  });
  expect(logFilterIntervals).toMatchObject([[0, 100]]);

  // Narrower criteria includes both broad and specific intervals.
  logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { topics: [null, "0xc", null, null] },
  });
  expect(logFilterIntervals).toMatchObject([
    [0, 100],
    [150, 250],
  ]);
});

test("insertFactoryChildAddressLogs inserts logs", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: rpcData.block2.logs,
  });

  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(1);
});

test("getFactoryChildAddresses gets child addresses for topic location", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
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
    upToBlockNumber: 150n,
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
    upToBlockNumber: 150n,
  });

  results = [];
  for await (const page of iterator) results.push(...page);

  expect(results).toMatchObject([
    "0xchild20000000000000000000000000000000000",
    "0xchild40000000000000000000000000000000000",
  ]);
});

test("getFactoryChildAddresses gets child addresses for offset location", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "offset32",
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
    upToBlockNumber: 150n,
  });

  const results = [];
  for await (const page of iterator) results.push(...page);

  expect(results).toMatchObject([
    "0xchild10000000000000000000000000000000000",
    "0xchild20000000000000000000000000000000000",
  ]);
});

test("getFactoryChildAddresses respects upToBlockNumber argument", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
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
    upToBlockNumber: 150n,
  });

  let results = [];
  for await (const page of iterator) results.push(...page);

  expect(results).toMatchObject(["0xchild10000000000000000000000000000000000"]);

  iterator = syncStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    upToBlockNumber: 250n,
  });

  results = [];
  for await (const page of iterator) results.push(...page);

  expect(results).toMatchObject([
    "0xchild10000000000000000000000000000000000",
    "0xchild20000000000000000000000000000000000",
  ]);
});

test("getFactoryChildAddresses paginates correctly", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
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
      {
        ...rpcData.block1.logs[1],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child30000000000000000000000000000000000",
        ],
        blockNumber: toHex(201),
      },
    ],
  });

  const iterator = syncStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    upToBlockNumber: 1000n,
    pageSize: 1,
  });

  let idx = 0;
  for await (const page of iterator) {
    if (idx === 0)
      expect(page).toMatchObject([
        "0xchild10000000000000000000000000000000000",
      ]);
    if (idx === 1)
      expect(page).toMatchObject([
        "0xchild20000000000000000000000000000000000",
      ]);
    if (idx === 2) {
      expect(page).toMatchObject([
        "0xchild30000000000000000000000000000000000",
      ]);
      expect((await iterator.next()).done).toBe(true);
    }
    idx++;
  }
});

test("getFactoryChildAddresses does not yield empty list", async ({
  syncStore,
}) => {
  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
  } satisfies FactoryCriteria;

  const iterator = syncStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    upToBlockNumber: 1000n,
  });

  let didYield = false;
  for await (const _page of iterator) {
    didYield = true;
  }

  expect(didYield).toBe(false);
});

test("insertFactoryLogFilterInterval inserts block, transactions, and logs", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
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

  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
});

test("insertFactoryLogFilterInterval inserts and merges child contract intervals", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
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
});

test("getFactoryLogFilterIntervals handles topic filtering rules", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
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
});

test("insertRealtimeBlock inserts data", async ({ syncStore, sources }) => {
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

  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
});

test("insertRealtimeInterval inserts log filter intervals", async ({
  syncStore,
  erc20,
}) => {
  const logFilterCriteria = {
    address: erc20.address,
  } satisfies LogFilterCriteria;

  const factoryCriteriaOne = {
    address: "0xparent",
    eventSelector: "0xa",
    childAddressLocation: "topic1",
  } satisfies FactoryCriteria;

  const factoryCriteriaTwo = {
    address: "0xparent",
    eventSelector: "0xa",
    childAddressLocation: "offset64",
  } satisfies FactoryCriteria;

  await syncStore.insertRealtimeInterval({
    chainId: 1,
    logFilters: [logFilterCriteria],
    factories: [factoryCriteriaOne, factoryCriteriaTwo],
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
      },
    }),
  ).toMatchObject([[500, 550]]);
  expect(
    await syncStore.getLogFilterIntervals({
      chainId: 1,
      logFilter: {
        address: factoryCriteriaOne.address,
        topics: [factoryCriteriaOne.eventSelector, null, null, null],
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
});

test("deleteRealtimeData deletes blocks, transactions and logs", async ({
  syncStore,
  sources,
  erc20,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: { address: erc20.address },
    ...rpcData.block1,
    interval: {
      startBlock: hexToBigInt(rpcData.block1.block.number!),
      endBlock: hexToBigInt(rpcData.block1.block.number!),
    },
  });

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: { address: erc20.address },
    ...rpcData.block2,
    interval: {
      startBlock: hexToBigInt(rpcData.block2.block.number!),
      endBlock: hexToBigInt(rpcData.block2.block.number!),
    },
  });

  let blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(2);

  let transactions = await syncStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(3);

  let logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(3);

  await syncStore.deleteRealtimeData({
    chainId: 1,
    fromBlock: hexToBigInt(rpcData.block1.block.number!),
  });

  blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(1);

  transactions = await syncStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(2);

  logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
});

test("deleteRealtimeData updates interval data", async ({
  syncStore,
  sources,
  erc20,
}) => {
  const rpcData = await getRawRPCData(sources);

  const logFilterCriteria = {
    address: erc20.address,
  } satisfies LogFilterCriteria;

  const factoryCriteria = {
    address: "0xparent",
    eventSelector: "0xa",
    childAddressLocation: "topic1",
  } satisfies FactoryCriteria;

  await syncStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: logFilterCriteria,
    ...rpcData.block2,
    interval: {
      startBlock: hexToBigInt(rpcData.block1.block.number!),
      endBlock: hexToBigInt(rpcData.block2.block.number!),
    },
  });

  await syncStore.insertFactoryLogFilterInterval({
    chainId: 1,
    factory: factoryCriteria,
    ...rpcData.block2,
    interval: {
      startBlock: hexToBigInt(rpcData.block1.block.number!),
      endBlock: hexToBigInt(rpcData.block2.block.number!),
    },
  });

  expect(
    await syncStore.getLogFilterIntervals({
      chainId: 1,
      logFilter: logFilterCriteria,
    }),
  ).toMatchObject([
    [
      Number(rpcData.block1.block.number!),
      Number(rpcData.block2.block.number!),
    ],
  ]);

  expect(
    await syncStore.getFactoryLogFilterIntervals({
      chainId: 1,
      factory: factoryCriteria,
    }),
  ).toMatchObject([
    [
      Number(rpcData.block1.block.number!),
      Number(rpcData.block2.block.number!),
    ],
  ]);

  await syncStore.deleteRealtimeData({
    chainId: 1,
    fromBlock: hexToBigInt(rpcData.block1.block.number!),
  });

  expect(
    await syncStore.getLogFilterIntervals({
      chainId: 1,
      logFilter: logFilterCriteria,
    }),
  ).toMatchObject([
    [
      Number(rpcData.block1.block.number!),
      Number(rpcData.block1.block.number!),
    ],
  ]);

  expect(
    await syncStore.getFactoryLogFilterIntervals({
      chainId: 1,
      factory: factoryCriteria,
    }),
  ).toMatchObject([
    [
      Number(rpcData.block1.block.number!),
      Number(rpcData.block1.block.number!),
    ],
  ]);
});

test("insertRpcRequestResult inserts a request result", async ({
  syncStore,
}) => {
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
});

test("insertRpcRequestResult upserts on conflict", async ({ syncStore }) => {
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
});

test("getRpcRequestResult returns data", async ({ syncStore }) => {
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
});

test("getRpcRequestResult returns null if not found", async ({ syncStore }) => {
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
});

test("getLogEvents returns log events", async ({
  syncStore,
  sources,
  erc20,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  const { events } = await syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
    logFilters: [{ id: "noFilter", chainId: 1, criteria: {} }],
  });

  expect(events).toHaveLength(2);

  expect(events[0].sourceId).toEqual("noFilter");
  expect(events[0].log.address).toBe(checksumAddress(erc20.address));
  expect(events[0].block.hash).toBe(rpcData.block1.block.hash);
  expect(events[0].transaction.hash).toBe(rpcData.block1.transactions[0].hash);

  expect(events[1].sourceId).toEqual("noFilter");
  expect(events[1].log.address).toBe(checksumAddress(erc20.address));
  expect(events[1].block.hash).toBe(rpcData.block1.block.hash);
  expect(events[1].transaction.hash).toBe(rpcData.block1.transactions[1].hash);
});

test("getLogEvents filters on log filter with one address", async ({
  syncStore,
  sources,
  erc20,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  const { events } = await syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
    logFilters: [
      {
        id: "singleAddress",
        chainId: 1,
        criteria: { address: erc20.address },
      },
    ],
  });

  expect(events).toHaveLength(2);
  expect(events[0].log.address).toBe(checksumAddress(erc20.address));
  expect(events[1].log.address).toBe(checksumAddress(erc20.address));
});

test("getLogEvents filters on log filter with multiple addresses", async ({
  syncStore,
  sources,
  erc20,
  factory,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const { events } = await syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
    logFilters: [
      {
        id: "multipleAddress",
        chainId: 1,
        criteria: {
          address: [erc20.address, factory.address],
        },
      },
    ],
  });

  expect(events).toHaveLength(3);
  expect(events[0]).toMatchObject({
    sourceId: "multipleAddress",
    log: {
      address: checksumAddress(erc20.address),
    },
  });
  expect(events[1]).toMatchObject({
    sourceId: "multipleAddress",
    log: {
      address: checksumAddress(erc20.address),
    },
  });
  expect(events[2]).toMatchObject({
    sourceId: "multipleAddress",
    log: {
      address: checksumAddress(factory.address),
    },
  });
});

test("getLogEvents filters on log filter with single topic", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const { events } = await syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
    logFilters: [
      {
        id: "singleTopic",
        chainId: 1,
        criteria: {
          topics: [rpcData.block1.logs[0].topics[0]!, null, null, null],
        },
      },
    ],
  });

  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({
    sourceId: "singleTopic",
    log: {
      topics: rpcData.block1.logs[0].topics,
    },
  });
  expect(events[1]).toMatchObject({
    sourceId: "singleTopic",
    log: {
      topics: rpcData.block1.logs[1].topics,
    },
  });
});

test("getLogEvents filters on log filter with multiple topics", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const { events } = await syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
    logFilters: [
      {
        id: "multipleTopics",
        chainId: 1,
        criteria: {
          topics: [
            rpcData.block1.logs[0].topics[0]!,
            rpcData.block1.logs[0].topics[1]!,
            null,
            null,
          ],
        },
      },
    ],
  });

  expect(events[0]).toMatchObject({
    sourceId: "multipleTopics",
    log: {
      topics: rpcData.block1.logs[0].topics,
    },
  });
  expect(events).toHaveLength(1);
});

test("getLogEvents filters on simple factory", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

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
    ],
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    block: rpcData.block2.block,
    transactions: rpcData.block2.transactions,
    logs: [
      {
        ...rpcData.block2.logs[0],
        address: "0xchild10000000000000000000000000000000000",
      },
    ],
  });

  const { events } = await syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
    factories: [
      {
        id: "simple",
        chainId: 1,
        criteria: {
          address: "0xfactory",
          eventSelector:
            "0x0000000000000000000000000000000000000000000factoryeventsignature",
          childAddressLocation: "topic1",
        },
      },
    ],
  });

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    sourceId: "simple",
    log: { topics: rpcData.block2.logs[0].topics },
  });
});

test("getLogEvents filters on fromBlock", async ({ syncStore, sources }) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const { events } = await syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
    logFilters: [
      {
        id: "fromBlock",
        chainId: 1,
        fromBlock: Number(rpcData.block2.block.number!),
        criteria: {},
      },
    ],
  });

  expect(events[0]).toMatchObject({
    sourceId: "fromBlock",
    block: {
      number: BigInt(rpcData.block2.block.number!),
    },
  });
  expect(events).toHaveLength(1);
});

test("getLogEvents filters on multiple filters", async ({
  syncStore,
  sources,
  erc20,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const { events } = await syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
    logFilters: [
      {
        id: "singleAddress",
        chainId: 1,
        criteria: { address: erc20.address },
      },
      {
        id: "singleTopic",
        chainId: 1,
        criteria: {
          topics: [rpcData.block1.logs[0].topics[0]!, null, null, null],
        },
      },
    ],
  });

  expect(events).toHaveLength(4);
  expect(events[0]).toMatchObject({
    sourceId: "singleAddress",
    log: {
      address: checksumAddress(erc20.address),
    },
  });
  expect(events[2]).toMatchObject({
    sourceId: "singleAddress",
    log: {
      address: checksumAddress(erc20.address),
    },
  });
  expect(events[1]).toMatchObject({
    sourceId: "singleTopic",
    log: {
      topics: rpcData.block1.logs[0].topics,
    },
  });
  expect(events[3]).toMatchObject({
    sourceId: "singleTopic",
    log: {
      topics: rpcData.block1.logs[1].topics,
    },
  });
});

test("getLogEvents filters on fromCheckpoint (exclusive)", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const { events } = await syncStore.getLogEvents({
    fromCheckpoint: {
      chainId: 1,
      blockTimestamp: Number(rpcData.block1.block.timestamp!),
      blockNumber: Number(rpcData.block1.block.number!),
      // Should exclude the 2nd log in the first block.
      logIndex: Number(rpcData.block1.logs[1].logIndex),
    },
    toCheckpoint: maxCheckpoint,
    limit: 100,
    logFilters: [{ id: "noFilter", chainId: 1, criteria: {} }],
  });

  expect(events).toHaveLength(1);
  expect(events[0].block.hash).toBe(rpcData.block2.block.hash);
});

test("getLogEvents filters on toCheckpoint (inclusive)", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const { events } = await syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: {
      ...maxCheckpoint,
      blockTimestamp: Number(rpcData.block1.block.timestamp!),
      blockNumber: Number(rpcData.block1.block.number!),
    },
    limit: 100,
    logFilters: [{ id: "noFilter", chainId: 1, criteria: {} }],
  });

  expect(events).toHaveLength(2);
  expect(events.map((e) => e.block.hash)).toMatchObject([
    rpcData.block1.block.hash,
    rpcData.block1.block.hash,
  ]);
});

test("getLogEvents returns no events if includeEventSelectors is an empty array", async ({
  syncStore,
  sources,
}) => {
  const rpcData = await getRawRPCData(sources);

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block1,
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    ...rpcData.block2,
  });

  const { events } = await syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
    logFilters: [
      { id: "noFilter", chainId: 1, criteria: {}, includeEventSelectors: [] },
    ],
  });

  expect(events).toHaveLength(0);
});
