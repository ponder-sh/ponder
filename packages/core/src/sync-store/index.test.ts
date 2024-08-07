import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getRawRPCData } from "@/_test/utils.js";
import { NonRetryableError } from "@/common/errors.js";
import type { Factory, LogFilter } from "@/sync/source.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { range } from "@/utils/range.js";
import { _eth_getLogs } from "@/utils/rpc.js";
import { hexToNumber } from "viem";
import { beforeEach, expect, test } from "vitest";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("setup creates tables", async (context) => {
  const { cleanup, database } = await setupDatabaseServices(context);
  const tables = await database.syncDb.introspection.getTables();
  const tableNames = tables.map((t) => t.name);

  expect(tableNames).toContain("blocks");
  expect(tableNames).toContain("logs");
  expect(tableNames).toContain("transactions");
  expect(tableNames).toContain("callTraces");
  expect(tableNames).toContain("transactionReceipts");

  expect(tableNames).toContain("rpcRequestResults");
  await cleanup();
});

test("getIntervals() empty", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const intervals = await syncStore.getIntervals({
    filter: context.sources[0].filter,
  });

  expect(intervals).toHaveLength(0);

  cleanup();
});

test("getIntervals() returns intervals", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  await syncStore.insertInterval({
    filter: context.sources[0].filter,
    interval: [0, 4],
  });

  const intervals = await syncStore.getIntervals({
    filter: context.sources[0].filter,
  });

  expect(intervals).toHaveLength(1);
  expect(intervals[0]).toStrictEqual([0, 4]);

  cleanup();
});

test("getIntervals() merges intervals", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  await syncStore.insertInterval({
    filter: context.sources[0].filter,
    interval: [0, 4],
  });

  await syncStore.insertInterval({
    filter: context.sources[0].filter,
    interval: [5, 8],
  });

  const intervals = await syncStore.getIntervals({
    filter: context.sources[0].filter,
  });

  expect(intervals).toHaveLength(1);
  expect(intervals[0]).toStrictEqual([0, 8]);

  cleanup();
});

test("getIntervals() handles log filter logic", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  await syncStore.insertInterval({
    filter: context.sources[0].filter,
    interval: [0, 4],
  });

  let intervals = await syncStore.getIntervals({
    filter: {
      ...context.sources[0].filter,
      includeTransactionReceipts: false,
    },
  });

  expect(intervals).toHaveLength(1);
  expect(intervals[0]).toStrictEqual([0, 4]);

  intervals = await syncStore.getIntervals({
    filter: { ...context.sources[0].filter, address: context.factory.address },
  });

  expect(intervals).toHaveLength(0);

  cleanup();
});

test("getIntervals() handles factory log filter logic", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  await syncStore.insertInterval({
    filter: context.sources[1].filter,
    interval: [0, 4],
  });

  let intervals = await syncStore.getIntervals({
    filter: {
      ...context.sources[1].filter,
      includeTransactionReceipts: false,
    },
  });

  expect(intervals).toHaveLength(1);
  expect(intervals[0]).toStrictEqual([0, 4]);

  intervals = await syncStore.getIntervals({
    filter: {
      ...context.sources[1].filter,
      address: {
        ...context.sources[1].filter.address,
        childAddressLocation: "topic2",
      },
    },
  });

  expect(intervals).toHaveLength(0);

  cleanup();
});

test("getIntervals() handles trace filter logic", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  await syncStore.insertInterval({
    filter: context.sources[3].filter,
    interval: [0, 4],
  });

  let intervals = await syncStore.getIntervals({
    filter: context.sources[3].filter,
  });

  expect(intervals).toHaveLength(1);
  expect(intervals[0]).toStrictEqual([0, 4]);

  intervals = await syncStore.getIntervals({
    filter: {
      ...context.sources[3].filter,
      toAddress: [context.erc20.address],
    },
  });

  expect(intervals).toHaveLength(0);

  cleanup();
});

test("getIntervals() handles factory trace filter logic", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  await syncStore.insertInterval({
    filter: context.sources[2].filter,
    interval: [0, 4],
  });

  let intervals = await syncStore.getIntervals({
    filter: context.sources[2].filter,
  });

  expect(intervals).toHaveLength(1);
  expect(intervals[0]).toStrictEqual([0, 4]);

  intervals = await syncStore.getIntervals({
    filter: {
      ...context.sources[2].filter,
      toAddress: {
        ...context.sources[2].filter.toAddress,
        childAddressLocation: "topic2",
      },
    },
  });

  expect(intervals).toHaveLength(0);

  cleanup();
});

test("getIntervals() handles block filter logic", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  await syncStore.insertInterval({
    filter: context.sources[4].filter,
    interval: [0, 4],
  });

  let intervals = await syncStore.getIntervals({
    filter: context.sources[4].filter,
  });

  expect(intervals).toHaveLength(1);
  expect(intervals[0]).toStrictEqual([0, 4]);

  intervals = await syncStore.getIntervals({
    filter: { ...context.sources[4].filter, interval: 69 },
  });

  expect(intervals).toHaveLength(0);

  cleanup();
});

test("getIntervals() handles size over max", async (context) => {
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  context.common.options = {
    ...context.common.options,
    syncStoreMaxIntervals: 20,
  };

  for (const i of range(0, 25)) {
    await syncStore.insertInterval({
      filter: context.sources[0].filter,
      interval: [i, i],
    });
  }

  const intervals = await syncStore.getIntervals({
    filter: context.sources[0].filter,
  });

  expect(intervals).toMatchObject([[0, 24]]);

  await cleanup();
});

test("getIntervals() throws non-retryable error after no merges", async (context) => {
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  context.common.options = {
    ...context.common.options,
    syncStoreMaxIntervals: 20,
  };

  for (let i = 0; i < 50; i += 2) {
    await syncStore.insertInterval({
      filter: context.sources[0].filter,
      interval: [i, i],
    });
  }

  const error = await syncStore
    .getIntervals({
      filter: context.sources[0].filter,
    })
    .catch((err) => err);

  expect(error).toBeInstanceOf(NonRetryableError);

  await cleanup();
});

test("getChildAddresses()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0] }],
    chainId: 1,
  });

  const addresses = await syncStore.getChildAddresses({
    filter: context.sources[1].filter.address as Factory,
    limit: 10,
  });

  expect(addresses).toHaveLength(1);
  expect(addresses[0]).toBe(context.factory.pair);

  cleanup();
});

test("getChildAddresses() empty", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const addresses = await syncStore.getChildAddresses({
    filter: context.sources[1].filter.address as Factory,
    limit: 10,
  });

  expect(addresses).toHaveLength(0);

  cleanup();
});

test("filterChildAddresses()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0] }],
    chainId: 1,
  });

  const addresses = await syncStore.filterChildAddresses({
    filter: context.sources[1].filter.address as Factory,
    addresses: [
      context.erc20.address,
      context.factory.address,
      context.factory.pair,
    ],
  });

  expect(addresses.size).toBe(1);

  cleanup();
});

test("insertLogs()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    chainId: 1,
  });

  const logs = await database.syncDb.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(1);

  cleanup();
});

test("insertLogs() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    chainId: 1,
  });
  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    chainId: 1,
  });

  const logs = await database.syncDb.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(1);

  cleanup();
});

test("insertLogs() creates checkpoint", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    chainId: 1,
  });

  const logs = await database.syncDb.selectFrom("logs").selectAll().execute();
  const checkpoint = decodeCheckpoint(logs[0]!.checkpoint!);

  expect(checkpoint.blockTimestamp).toBe(
    hexToNumber(rpcData.block3.block.timestamp),
  );
  expect(checkpoint.chainId).toBe(1n);
  expect(checkpoint.blockNumber).toBe(3n);
  expect(checkpoint.transactionIndex).toBe(0n);
  expect(checkpoint.eventType).toBe(5);
  expect(checkpoint.eventIndex).toBe(0n);

  cleanup();
});

test("insertBlock()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertBlock({ block: rpcData.block3.block, chainId: 1 });

  const blocks = await database.syncDb
    .selectFrom("blocks")
    .selectAll()
    .execute();
  expect(blocks).toHaveLength(1);

  cleanup();
});

test("insertBlock() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertBlock({ block: rpcData.block3.block, chainId: 1 });
  await syncStore.insertBlock({ block: rpcData.block3.block, chainId: 1 });

  const blocks = await database.syncDb
    .selectFrom("blocks")
    .selectAll()
    .execute();
  expect(blocks).toHaveLength(1);

  cleanup();
});

test("insertBlock() creates checkpoint", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertBlock({
    block: rpcData.block3.block,
    chainId: 1,
  });

  const blocks = await database.syncDb
    .selectFrom("blocks")
    .selectAll()
    .execute();
  const checkpoint = decodeCheckpoint(blocks[0]!.checkpoint!);

  expect(checkpoint.blockTimestamp).toBe(
    hexToNumber(rpcData.block3.block.timestamp),
  );
  expect(checkpoint.chainId).toBe(1n);
  expect(checkpoint.blockNumber).toBe(3n);
  expect(checkpoint.transactionIndex).toBe(maxCheckpoint.transactionIndex);
  expect(checkpoint.eventType).toBe(5);
  expect(checkpoint.eventIndex).toBe(0n);

  cleanup();
});

test("hasBlock()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertBlock({ block: rpcData.block3.block, chainId: 1 });
  let block = await syncStore.hasBlock({
    hash: rpcData.block3.block.hash,
  });
  expect(block).toBe(true);

  block = await syncStore.hasBlock({
    hash: rpcData.block2.block.hash,
  });
  expect(block).toBe(false);

  cleanup();
});

test("insertTransaction()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertTransaction({
    transaction: rpcData.block3.transactions[0],
    chainId: 1,
  });

  const transactions = await database.syncDb
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(1);

  cleanup();
});

test("insertTransaction() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertTransaction({
    transaction: rpcData.block3.transactions[0],
    chainId: 1,
  });
  await syncStore.insertTransaction({
    transaction: rpcData.block3.transactions[0],
    chainId: 1,
  });

  const transactions = await database.syncDb
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(1);

  cleanup();
});

test("hasTransaction()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertTransaction({
    transaction: rpcData.block3.transactions[0],
    chainId: 1,
  });
  let transaction = await syncStore.hasTransaction({
    hash: rpcData.block3.transactions[0].hash,
  });
  expect(transaction).toBe(true);

  transaction = await syncStore.hasTransaction({
    hash: rpcData.block2.transactions[0].hash,
  });
  expect(transaction).toBe(false);

  cleanup();
});

test("insertTransactionReceipt()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertTransactionReceipt({
    transactionReceipt: rpcData.block3.transactionReceipts[0],
    chainId: 1,
  });

  const transactionReceipts = await database.syncDb
    .selectFrom("transactionReceipts")
    .selectAll()
    .execute();
  expect(transactionReceipts).toHaveLength(1);

  cleanup();
});

test("insertTransactionReceipt() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertTransactionReceipt({
    transactionReceipt: rpcData.block3.transactionReceipts[0],
    chainId: 1,
  });
  await syncStore.insertTransactionReceipt({
    transactionReceipt: rpcData.block3.transactionReceipts[0],
    chainId: 1,
  });

  const transactionReceipts = await database.syncDb
    .selectFrom("transactionReceipts")
    .selectAll()
    .execute();
  expect(transactionReceipts).toHaveLength(1);

  cleanup();
});

test("hasTransactionReceipt()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertTransactionReceipt({
    transactionReceipt: rpcData.block3.transactionReceipts[0],
    chainId: 1,
  });
  let transaction = await syncStore.hasTransactionReceipt({
    hash: rpcData.block3.transactionReceipts[0].transactionHash,
  });
  expect(transaction).toBe(true);

  transaction = await syncStore.hasTransactionReceipt({
    hash: rpcData.block2.transactionReceipts[0].transactionHash,
  });
  expect(transaction).toBe(false);

  cleanup();
});

test("insertCallTraces()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertCallTraces({
    callTraces: [
      { callTrace: rpcData.block3.traces[0], block: rpcData.block3.block },
    ],
    chainId: 1,
  });

  const traces = await database.syncDb
    .selectFrom("callTraces")
    .selectAll()
    .execute();
  expect(traces).toHaveLength(1);

  cleanup();
});

test("insertCallTraces() creates checkpoint", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertCallTraces({
    callTraces: [
      { callTrace: rpcData.block3.traces[0], block: rpcData.block3.block },
    ],
    chainId: 1,
  });

  const traces = await database.syncDb
    .selectFrom("callTraces")
    .selectAll()
    .execute();
  const checkpoint = decodeCheckpoint(traces[0]!.checkpoint!);

  expect(checkpoint.blockTimestamp).toBe(
    hexToNumber(rpcData.block3.block.timestamp),
  );
  expect(checkpoint.chainId).toBe(1n);
  expect(checkpoint.blockNumber).toBe(3n);
  expect(checkpoint.transactionIndex).toBe(0n);
  expect(checkpoint.eventType).toBe(7);
  expect(checkpoint.eventIndex).toBe(0n);

  cleanup();
});

test("insertCallTraces() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertCallTraces({
    callTraces: [
      { callTrace: rpcData.block3.traces[0], block: rpcData.block3.block },
    ],
    chainId: 1,
  });
  await syncStore.insertCallTraces({
    callTraces: [
      { callTrace: rpcData.block3.traces[0], block: rpcData.block3.block },
    ],
    chainId: 1,
  });

  const traces = await database.syncDb
    .selectFrom("callTraces")
    .selectAll()
    .execute();
  expect(traces).toHaveLength(1);

  cleanup();
});

test("getEvents() returns events", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    chainId: 1,
  });
  await syncStore.insertBlock({ block: rpcData.block3.block, chainId: 1 });
  await syncStore.insertTransaction({
    transaction: rpcData.block3.transactions[0],
    chainId: 1,
  });

  const filter = {
    type: "log",
    chainId: 1,
    address: undefined,
    topics: [null],
    fromBlock: 0,
    toBlock: 5,
    includeTransactionReceipts: false,
  } satisfies LogFilter;

  const { events } = await syncStore.getEvents({
    filters: [filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(1);

  cleanup();
});

test("getEvents() handles log filter logic", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [
      { log: rpcData.block2.logs[0], block: rpcData.block2.block },
      { log: rpcData.block2.logs[1], block: rpcData.block2.block },
    ],
    chainId: 1,
  });
  await syncStore.insertBlock({ block: rpcData.block2.block, chainId: 1 });
  await syncStore.insertTransaction({
    transaction: rpcData.block2.transactions[0],
    chainId: 1,
  });
  await syncStore.insertTransaction({
    transaction: rpcData.block2.transactions[1],
    chainId: 1,
  });

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    chainId: 1,
  });
  await syncStore.insertBlock({ block: rpcData.block3.block, chainId: 1 });
  await syncStore.insertTransaction({
    transaction: rpcData.block3.transactions[0],
    chainId: 1,
  });

  const { events } = await syncStore.getEvents({
    filters: [context.sources[0].filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(2);

  cleanup();
});

test("getEvents() handles log address filters", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    chainId: 1,
  });
  await syncStore.insertLogs({
    logs: [{ log: rpcData.block4.logs[0], block: rpcData.block4.block }],
    chainId: 1,
  });
  await syncStore.insertBlock({ block: rpcData.block4.block, chainId: 1 });
  await syncStore.insertTransaction({
    transaction: rpcData.block4.transactions[0],
    chainId: 1,
  });

  const { events } = await syncStore.getEvents({
    filters: [context.sources[1].filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(1);

  cleanup();
});

test("getEvents() handles trace filter logic", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertCallTraces({
    callTraces: [
      { callTrace: rpcData.block3.traces[0], block: rpcData.block3.block },
    ],
    chainId: 1,
  });
  await syncStore.insertBlock({ block: rpcData.block3.block, chainId: 1 });
  await syncStore.insertTransaction({
    transaction: rpcData.block3.transactions[0],
    chainId: 1,
  });
  await syncStore.insertTransactionReceipt({
    transactionReceipt: rpcData.block3.transactionReceipts[0],
    chainId: 1,
  });

  const { events } = await syncStore.getEvents({
    filters: [context.sources[3].filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(1);

  cleanup();
});

test("getEvents() handles block filter logic", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertBlock({ block: rpcData.block2.block, chainId: 1 });
  await syncStore.insertBlock({ block: rpcData.block3.block, chainId: 1 });
  await syncStore.insertBlock({ block: rpcData.block4.block, chainId: 1 });
  await syncStore.insertBlock({ block: rpcData.block5.block, chainId: 1 });

  const { events } = await syncStore.getEvents({
    filters: [context.sources[4].filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(2);

  cleanup();
});

test("getEvents() handles block bounds", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [
      { log: rpcData.block2.logs[0], block: rpcData.block2.block },
      { log: rpcData.block2.logs[1], block: rpcData.block2.block },
    ],
    chainId: 1,
  });
  await syncStore.insertBlock({ block: rpcData.block2.block, chainId: 1 });
  await syncStore.insertTransaction({
    transaction: rpcData.block2.transactions[0],
    chainId: 1,
  });
  await syncStore.insertTransaction({
    transaction: rpcData.block2.transactions[1],
    chainId: 1,
  });

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    chainId: 1,
  });
  await syncStore.insertBlock({ block: rpcData.block3.block, chainId: 1 });
  await syncStore.insertTransaction({
    transaction: rpcData.block3.transactions[0],
    chainId: 1,
  });

  const filter = context.sources[0].filter;
  filter.toBlock = 1;

  const { events } = await syncStore.getEvents({
    filters: [filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(0);

  cleanup();
});

test("getEvents() pagination", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [
      { log: rpcData.block2.logs[0], block: rpcData.block2.block },
      { log: rpcData.block2.logs[1], block: rpcData.block2.block },
    ],
    chainId: 1,
  });
  await syncStore.insertBlock({ block: rpcData.block2.block, chainId: 1 });
  await syncStore.insertTransaction({
    transaction: rpcData.block2.transactions[0],
    chainId: 1,
  });
  await syncStore.insertTransaction({
    transaction: rpcData.block2.transactions[1],
    chainId: 1,
  });

  const { events, cursor } = await syncStore.getEvents({
    filters: [context.sources[0].filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 1,
  });

  expect(events).toHaveLength(1);

  const { events: events2 } = await syncStore.getEvents({
    filters: [context.sources[0].filter],
    from: cursor,
    to: encodeCheckpoint(maxCheckpoint),
    limit: 1,
  });

  expect(events2).toHaveLength(1);

  await cleanup();
});
