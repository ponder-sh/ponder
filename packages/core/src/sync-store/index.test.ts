import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getRawRPCData } from "@/_test/utils.js";
import { NonRetryableError } from "@/common/errors.js";
import type { Factory, LogFactory, LogFilter } from "@/sync/source.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { range } from "@/utils/range.js";
import { _eth_getLogs } from "@/utils/rpc.js";
import { type Address, hexToNumber } from "viem";
import { beforeEach, expect, test } from "vitest";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("setup creates tables", async (context) => {
  const { cleanup, database } = await setupDatabaseServices(context);
  const tables = await database.qb.sync.introspection.getTables();
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

  await cleanup();
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

  await cleanup();
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

  await cleanup();
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

  await cleanup();
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

  await cleanup();
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

  await cleanup();
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

  await cleanup();
});

test("getIntervals() handles block filter logic", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  await syncStore.getIntervals({
    filter: context.sources[4].filter,
  });

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

  await cleanup();
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
    shouldUpdateCheckpoint: false,
    chainId: 1,
  });

  const addresses = await syncStore.getChildAddresses({
    filter: context.sources[1].filter.address as Factory,
    limit: 10,
  });

  expect(addresses).toHaveLength(1);
  expect(addresses[0]).toBe(context.factory.pair);

  await cleanup();
});

test("getChildAddresses() empty", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const addresses = await syncStore.getChildAddresses({
    filter: context.sources[1].filter.address as Factory,
    limit: 10,
  });

  expect(addresses).toHaveLength(0);

  await cleanup();
});

test("filterChildAddresses()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0] }],
    shouldUpdateCheckpoint: false,
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

  await cleanup();
});

test("insertLogs()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });

  const logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(1);

  await cleanup();
});

test("insertLogs() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });

  const logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(1);

  await cleanup();
});

test("insertLogs() creates checkpoint", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });

  const logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  const checkpoint = decodeCheckpoint(logs[0]!.checkpoint!);

  expect(checkpoint.blockTimestamp).toBe(
    hexToNumber(rpcData.block3.block.timestamp),
  );
  expect(checkpoint.chainId).toBe(1n);
  expect(checkpoint.blockNumber).toBe(3n);
  expect(checkpoint.transactionIndex).toBe(0n);
  expect(checkpoint.eventType).toBe(5);
  expect(checkpoint.eventIndex).toBe(0n);

  await cleanup();
});

test("insertLogs() upserts checkpoint", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0] }],
    shouldUpdateCheckpoint: false,
    chainId: 1,
  });

  let logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  expect(logs[0]!.checkpoint).toBe(null);

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });

  logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  expect(logs[0]!.checkpoint).not.toBe(null);

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0] }],
    shouldUpdateCheckpoint: false,
    chainId: 1,
  });

  logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  expect(logs[0]!.checkpoint).not.toBe(null);

  await cleanup();
});

test("insertBlocks()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertBlocks({ blocks: [rpcData.block3.block], chainId: 1 });

  const blocks = await database.qb.sync
    .selectFrom("blocks")
    .selectAll()
    .execute();
  expect(blocks).toHaveLength(1);

  await cleanup();
});

test("insertBlocks() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertBlocks({ blocks: [rpcData.block3.block], chainId: 1 });
  await syncStore.insertBlocks({ blocks: [rpcData.block3.block], chainId: 1 });

  const blocks = await database.qb.sync
    .selectFrom("blocks")
    .selectAll()
    .execute();
  expect(blocks).toHaveLength(1);

  await cleanup();
});

test("insertBlocks() creates checkpoint", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertBlocks({
    blocks: [rpcData.block3.block],
    chainId: 1,
  });

  const blocks = await database.qb.sync
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

  await cleanup();
});

test("hasBlock()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertBlocks({ blocks: [rpcData.block3.block], chainId: 1 });
  let block = await syncStore.hasBlock({
    hash: rpcData.block3.block.hash,
  });
  expect(block).toBe(true);

  block = await syncStore.hasBlock({
    hash: rpcData.block2.block.hash,
  });
  expect(block).toBe(false);

  await cleanup();
});

test("insertTransactions()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertTransactions({
    transactions: rpcData.block3.transactions,
    chainId: 1,
  });

  const transactions = await database.qb.sync
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(1);

  await cleanup();
});

test("insertTransactions() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertTransactions({
    transactions: rpcData.block3.transactions,
    chainId: 1,
  });
  await syncStore.insertTransactions({
    transactions: rpcData.block3.transactions,
    chainId: 1,
  });

  const transactions = await database.qb.sync
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(1);

  await cleanup();
});

test("hasTransaction()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertTransactions({
    transactions: rpcData.block3.transactions,
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

  await cleanup();
});

test("insertTransactionReceipts()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertTransactionReceipts({
    transactionReceipts: rpcData.block3.transactionReceipts,
    chainId: 1,
  });

  const transactionReceipts = await database.qb.sync
    .selectFrom("transactionReceipts")
    .selectAll()
    .execute();
  expect(transactionReceipts).toHaveLength(1);

  await cleanup();
});

test("insertTransactionReceipts() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertTransactionReceipts({
    transactionReceipts: rpcData.block3.transactionReceipts,
    chainId: 1,
  });
  await syncStore.insertTransactionReceipts({
    transactionReceipts: rpcData.block3.transactionReceipts,
    chainId: 1,
  });

  const transactionReceipts = await database.qb.sync
    .selectFrom("transactionReceipts")
    .selectAll()
    .execute();
  expect(transactionReceipts).toHaveLength(1);

  await cleanup();
});

test("hasTransactionReceipt()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertTransactionReceipts({
    transactionReceipts: rpcData.block3.transactionReceipts,
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

  await cleanup();
});

test("insertCallTraces()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertCallTraces({
    callTraces: [
      { callTrace: rpcData.block3.callTraces[0], block: rpcData.block3.block },
    ],
    chainId: 1,
  });

  const traces = await database.qb.sync
    .selectFrom("callTraces")
    .selectAll()
    .execute();
  expect(traces).toHaveLength(1);

  await cleanup();
});

test("insertCallTraces() creates checkpoint", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertCallTraces({
    callTraces: [
      { callTrace: rpcData.block3.callTraces[0], block: rpcData.block3.block },
    ],
    chainId: 1,
  });

  const traces = await database.qb.sync
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

  await cleanup();
});

test("insertCallTraces() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertCallTraces({
    callTraces: [
      { callTrace: rpcData.block3.callTraces[0], block: rpcData.block3.block },
    ],
    chainId: 1,
  });
  await syncStore.insertCallTraces({
    callTraces: [
      { callTrace: rpcData.block3.callTraces[0], block: rpcData.block3.block },
    ],
    chainId: 1,
  });

  const traces = await database.qb.sync
    .selectFrom("callTraces")
    .selectAll()
    .execute();
  expect(traces).toHaveLength(1);

  await cleanup();
});

test("getEvents() returns events", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcData.block3.block], chainId: 1 });
  await syncStore.insertTransactions({
    transactions: rpcData.block3.transactions,
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

  await cleanup();
});

test("getEvents() handles log filter logic", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [
      { log: rpcData.block2.logs[0], block: rpcData.block2.block },
      { log: rpcData.block2.logs[1], block: rpcData.block2.block },
    ],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcData.block2.block], chainId: 1 });
  await syncStore.insertTransactions({
    transactions: rpcData.block2.transactions,
    chainId: 1,
  });

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcData.block3.block], chainId: 1 });
  await syncStore.insertTransactions({
    transactions: rpcData.block3.transactions,
    chainId: 1,
  });

  const { events } = await syncStore.getEvents({
    filters: [context.sources[0].filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(2);

  await cleanup();
});

test("getEvents() handles log factory", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertLogs({
    logs: [{ log: rpcData.block4.logs[0], block: rpcData.block4.block }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcData.block4.block], chainId: 1 });
  await syncStore.insertTransactions({
    transactions: rpcData.block4.transactions,
    chainId: 1,
  });

  const { events } = await syncStore.getEvents({
    filters: [context.sources[1].filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(1);

  await cleanup();
});

test("getEvents() handles multiple log factories", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertLogs({
    logs: [{ log: rpcData.block4.logs[0], block: rpcData.block4.block }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcData.block4.block], chainId: 1 });
  await syncStore.insertTransactions({
    transactions: rpcData.block4.transactions,
    chainId: 1,
  });

  context.sources[1].filter = {
    ...context.sources[1].filter,
    address: {
      ...context.sources[1].filter.address,
      address: [
        context.sources[1].filter.address.address as Address,
        context.sources[1].filter.address.address as Address,
      ],
    },
  } satisfies LogFilter<LogFactory>;

  const { events } = await syncStore.getEvents({
    filters: [context.sources[1].filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(1);

  await cleanup();
});

test("getEvents() handles trace filter logic", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertCallTraces({
    callTraces: [
      { callTrace: rpcData.block3.callTraces[0], block: rpcData.block3.block },
    ],
    chainId: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcData.block3.block], chainId: 1 });
  await syncStore.insertTransactions({
    transactions: rpcData.block3.transactions,
    chainId: 1,
  });
  await syncStore.insertTransactionReceipts({
    transactionReceipts: rpcData.block3.transactionReceipts,
    chainId: 1,
  });

  const { events } = await syncStore.getEvents({
    filters: [context.sources[3].filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(1);

  await cleanup();
});

test("getEvents() handles block filter logic", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertBlocks({ blocks: [rpcData.block2.block], chainId: 1 });
  await syncStore.insertBlocks({ blocks: [rpcData.block3.block], chainId: 1 });
  await syncStore.insertBlocks({ blocks: [rpcData.block4.block], chainId: 1 });
  await syncStore.insertBlocks({ blocks: [rpcData.block5.block], chainId: 1 });

  const { events } = await syncStore.getEvents({
    filters: [context.sources[4].filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(2);

  await cleanup();
});

test("getEvents() handles block bounds", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [
      { log: rpcData.block2.logs[0], block: rpcData.block2.block },
      { log: rpcData.block2.logs[1], block: rpcData.block2.block },
    ],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcData.block2.block], chainId: 1 });
  await syncStore.insertTransactions({
    transactions: rpcData.block2.transactions,
    chainId: 1,
  });
  await syncStore.insertTransactions({
    transactions: rpcData.block2.transactions,
    chainId: 1,
  });

  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcData.block3.block], chainId: 1 });
  await syncStore.insertTransactions({
    transactions: rpcData.block3.transactions,
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

  await cleanup();
});

test("getEvents() pagination", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertLogs({
    logs: [
      { log: rpcData.block2.logs[0], block: rpcData.block2.block },
      { log: rpcData.block2.logs[1], block: rpcData.block2.block },
    ],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcData.block2.block], chainId: 1 });
  await syncStore.insertTransactions({
    transactions: rpcData.block2.transactions,
    chainId: 1,
  });
  await syncStore.insertTransactions({
    transactions: rpcData.block2.transactions,
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

test("pruneRpcRequestResult", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

  await syncStore.insertRpcRequestResult({
    request: "0x1",
    blockNumber: 1n,
    chainId: 1,
    result: "0x1",
  });
  await syncStore.insertRpcRequestResult({
    request: "0x2",
    blockNumber: 2n,
    chainId: 1,
    result: "0x2",
  });
  await syncStore.insertRpcRequestResult({
    request: "0x3",
    blockNumber: 3n,
    chainId: 1,
    result: "0x3",
  });
  await syncStore.insertRpcRequestResult({
    request: "0x4",
    blockNumber: 4n,
    chainId: 1,
    result: "0x4",
  });

  await syncStore.pruneRpcRequestResult({
    blocks: [{ number: "0x2" }, { number: "0x4" }],
    chainId: 1,
  });

  const requestResults = await database.qb.sync
    .selectFrom("rpcRequestResults")
    .selectAll()
    .execute();

  expect(requestResults).toHaveLength(2);

  await cleanup();
});

test("pruneByChain deletes filters", async (context) => {
  const { sources } = context;
  const { syncStore, database, cleanup } = await setupDatabaseServices(context);

  await syncStore.getIntervals({ filter: sources[0].filter });
  await syncStore.getIntervals({ filter: sources[1].filter });
  await syncStore.getIntervals({ filter: sources[2].filter });
  await syncStore.getIntervals({ filter: sources[3].filter });

  await syncStore.insertInterval({
    filter: sources[0].filter,
    interval: [1, 4],
  });
  await syncStore.insertInterval({
    filter: sources[1].filter,
    interval: [1, 4],
  });
  await syncStore.insertInterval({
    filter: sources[2].filter,
    interval: [1, 4],
  });
  await syncStore.insertInterval({
    filter: sources[3].filter,
    interval: [1, 4],
  });

  sources[0].filter.chainId = 2;
  sources[1].filter.chainId = 2;
  sources[2].filter.chainId = 2;
  sources[3].filter.chainId = 2;

  await syncStore.getIntervals({ filter: sources[0].filter });
  await syncStore.getIntervals({ filter: sources[1].filter });
  await syncStore.getIntervals({ filter: sources[2].filter });
  await syncStore.getIntervals({ filter: sources[3].filter });

  await syncStore.insertInterval({
    filter: sources[0].filter,
    interval: [1, 4],
  });
  await syncStore.insertInterval({
    filter: sources[1].filter,
    interval: [1, 4],
  });
  await syncStore.insertInterval({
    filter: sources[2].filter,
    interval: [1, 4],
  });
  await syncStore.insertInterval({
    filter: sources[3].filter,
    interval: [1, 4],
  });

  await syncStore.pruneByChain({ chainId: 1, fromBlock: 0 });

  const interval = await database.qb.sync
    .selectFrom("interval")
    .selectAll()
    .execute();
  expect(interval).toHaveLength(4);

  await cleanup();
});

test("pruneByChain updates filters", async (context) => {
  const { sources } = context;
  const { syncStore, database, cleanup } = await setupDatabaseServices(context);

  await syncStore.getIntervals({ filter: sources[0].filter });
  await syncStore.getIntervals({ filter: sources[1].filter });
  await syncStore.getIntervals({ filter: sources[2].filter });
  await syncStore.getIntervals({ filter: sources[3].filter });

  await syncStore.insertInterval({
    filter: sources[0].filter,
    interval: [0, 4],
  });
  await syncStore.insertInterval({
    filter: sources[1].filter,
    interval: [0, 4],
  });
  await syncStore.insertInterval({
    filter: sources[2].filter,
    interval: [0, 4],
  });
  await syncStore.insertInterval({
    filter: sources[3].filter,
    interval: [0, 4],
  });

  sources[0].filter.chainId = 2;
  sources[1].filter.chainId = 2;
  sources[2].filter.chainId = 2;
  sources[3].filter.chainId = 2;

  await syncStore.getIntervals({ filter: sources[0].filter });
  await syncStore.getIntervals({ filter: sources[1].filter });
  await syncStore.getIntervals({ filter: sources[2].filter });
  await syncStore.getIntervals({ filter: sources[3].filter });

  await syncStore.insertInterval({
    filter: sources[0].filter,
    interval: [0, 4],
  });
  await syncStore.insertInterval({
    filter: sources[1].filter,
    interval: [0, 4],
  });
  await syncStore.insertInterval({
    filter: sources[2].filter,
    interval: [0, 4],
  });
  await syncStore.insertInterval({
    filter: sources[3].filter,
    interval: [0, 4],
  });

  await syncStore.pruneByChain({ chainId: 1, fromBlock: 1 });

  const intervals = await database.qb.sync
    .selectFrom("interval")
    .selectAll()
    .orderBy("end_block", "asc")
    .execute();

  expect(intervals).toHaveLength(8);

  expect(Number(intervals[0]!.end_block)).toBe(1);
  expect(Number(intervals[1]!.end_block)).toBe(1);
  expect(Number(intervals[2]!.end_block)).toBe(1);
  expect(Number(intervals[3]!.end_block)).toBe(1);
  expect(Number(intervals[4]!.end_block)).toBe(4);
  expect(Number(intervals[5]!.end_block)).toBe(4);
  expect(Number(intervals[6]!.end_block)).toBe(4);
  expect(Number(intervals[7]!.end_block)).toBe(4);

  await cleanup();
});

test("pruneByChain deletes block filters", async (context) => {
  const { sources } = context;
  const { syncStore, database, cleanup } = await setupDatabaseServices(context);

  await syncStore.getIntervals({ filter: sources[4].filter });

  await syncStore.insertInterval({
    filter: sources[4].filter,
    interval: [2, 4],
  });

  sources[4].filter.chainId = 2;

  await syncStore.getIntervals({ filter: sources[4].filter });

  await syncStore.insertInterval({
    filter: sources[4].filter,
    interval: [2, 4],
  });

  await syncStore.pruneByChain({ chainId: 1, fromBlock: 1 });

  const intervals = await database.qb.sync
    .selectFrom("interval")
    .selectAll()
    .execute();
  expect(intervals).toHaveLength(1);

  await cleanup();
});

test("pruneByChain updates block filters", async (context) => {
  const { sources } = context;
  const { syncStore, database, cleanup } = await setupDatabaseServices(context);

  await syncStore.getIntervals({ filter: sources[4].filter });

  await syncStore.insertInterval({
    filter: sources[4].filter,
    interval: [0, 4],
  });

  sources[4].filter.chainId = 2;

  await syncStore.getIntervals({ filter: sources[4].filter });

  await syncStore.insertInterval({
    filter: sources[4].filter,
    interval: [0, 4],
  });

  await syncStore.pruneByChain({ chainId: 1, fromBlock: 1 });

  const intervals = await database.qb.sync
    .selectFrom("interval")
    .selectAll()
    .orderBy("end_block", "asc")
    .execute();
  expect(intervals).toHaveLength(2);
  expect(Number(intervals[0]!.end_block)).toBe(1);

  await cleanup();
});

test("pruneByChain deletes blocks, logs, traces, transactions", async (context) => {
  const { syncStore, database, cleanup } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertBlocks({ blocks: [rpcData.block2.block], chainId: 1 });
  await syncStore.insertLogs({
    logs: [
      { log: rpcData.block2.logs[0], block: rpcData.block2.block },
      { log: rpcData.block2.logs[1], block: rpcData.block2.block },
    ],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertTransactions({
    transactions: rpcData.block2.transactions,
    chainId: 1,
  });
  await syncStore.insertTransactionReceipts({
    transactionReceipts: rpcData.block2.transactionReceipts,
    chainId: 1,
  });
  await syncStore.insertCallTraces({
    callTraces: [
      { callTrace: rpcData.block2.callTraces[0], block: rpcData.block2.block },
      { callTrace: rpcData.block2.callTraces[1], block: rpcData.block2.block },
    ],
    chainId: 1,
  });

  await syncStore.insertBlocks({ blocks: [rpcData.block3.block], chainId: 1 });
  await syncStore.insertLogs({
    logs: [{ log: rpcData.block3.logs[0], block: rpcData.block3.block }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertTransactions({
    transactions: rpcData.block3.transactions,
    chainId: 1,
  });
  await syncStore.insertTransactionReceipts({
    transactionReceipts: rpcData.block3.transactionReceipts,
    chainId: 1,
  });
  await syncStore.insertCallTraces({
    callTraces: [
      { callTrace: rpcData.block3.callTraces[0], block: rpcData.block3.block },
    ],
    chainId: 1,
  });

  await syncStore.pruneByChain({ chainId: 1, fromBlock: 3 });

  const logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  const blocks = await database.qb.sync
    .selectFrom("blocks")
    .selectAll()
    .execute();
  const callTraces = await database.qb.sync
    .selectFrom("callTraces")
    .selectAll()
    .execute();
  const transactions = await database.qb.sync
    .selectFrom("transactions")
    .selectAll()
    .execute();
  const transactionReceipts = await database.qb.sync
    .selectFrom("transactionReceipts")
    .selectAll()
    .execute();

  expect(logs).toHaveLength(2);
  expect(blocks).toHaveLength(1);
  expect(callTraces).toHaveLength(2);
  expect(transactions).toHaveLength(2);
  expect(transactionReceipts).toHaveLength(2);

  await cleanup();
});
