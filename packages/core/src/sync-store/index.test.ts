import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getRawRPCData } from "@/_test/utils.js";
import type { AddressFilter, LogFilter } from "@/sync/source.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
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

test.todo("getInterval() empty");

test.todo("getInterval() merges intervals");

test("getAddresses()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const logs = await _eth_getLogs(context.requestQueues[0], {
    address: context.factory.address,
    fromBlock: 0,
    toBlock: 5,
  });

  await syncStore.insertLogs({
    logs: logs.map((log) => ({ log })),
    chainId: 1,
  });

  const addresses = await syncStore.getAddresses({
    filter: context.sources[1].filter.address as AddressFilter,
    limit: 10,
  });

  expect(addresses).toHaveLength(1);
  expect(addresses[0]).toBe(context.factory.pair);

  cleanup();
});

test("getAddressess() empty", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const addresses = await syncStore.getAddresses({
    filter: context.sources[1].filter.address as AddressFilter,
    limit: 10,
  });

  expect(addresses).toHaveLength(0);

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

  // block = await syncStore.hasBlock({
  //   hash: rpcData.block3.block.hash,
  // });
  // expect(block).toBe(false);

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

  // transaction = await syncStore.hasTransaction({
  //   hash: rpcData.block3.transactions[0].hash,
  // });
  // expect(transaction).toBe(false);

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

  // transaction = await syncStore.hasTransactionReceipt({
  //   hash: rpcData.block3.transactionReceipts[0].transactionHash,
  // });
  // expect(transaction).toBe(false);

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
    fromBlock: 0,
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

test("populateEvents() handles block filter logic", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const rpcData = await getRawRPCData();

  await syncStore.insertBlock({ block: rpcData.block2.block, chainId: 1 });
  await syncStore.insertBlock({ block: rpcData.block3.block, chainId: 1 });
  await syncStore.insertBlock({ block: rpcData.block4.block, chainId: 1 });

  const { events } = await syncStore.getEvents({
    filters: [context.sources[2].filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(1);

  cleanup();
});

// test("getEventCount empty", async (context) => {
//   const { cleanup, syncStore } = await setupDatabaseServices(context);

//   const filter = { type: "log", chainId: 1, fromBlock: 0 } satisfies LogFilter;
//   const count = await syncStore.getEventCount({ filters: [filter] });

//   expect(count).toBe(0);

//   cleanup();
// });

// test("getEventCount", async (context) => {
//   const { cleanup, syncStore } = await setupDatabaseServices(context);
//   const rpcData = await getRawRPCData();

//   await syncStore.insertLogs({ logs: rpcData.block3.logs, chainId: 1 });
//   await syncStore.insertBlock({ block: rpcData.block3.block, chainId: 1 });
//   await syncStore.insertTransaction({
//     transaction: rpcData.block3.transactions[0],
//     chainId: 1,
//   });

//   const filter = { type: "log", chainId: 1, fromBlock: 0 } satisfies LogFilter;
//   await syncStore.populateEvents({ filter, interval: [3, 3] });

//   const count = await syncStore.getEventCount({ filters: [filter] });

//   expect(count).toBe(1);

//   cleanup();
// });

test.todo("getEvents() pagination");
