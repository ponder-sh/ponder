import {
  setupAnvil,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { simulate } from "@/_test/simulate.js";
import { publicClient, testClient } from "@/_test/utils.js";
import { decodeToBigInt } from "@/utils/encoding.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { beforeEach, expect, test, vi } from "vitest";
import { RealtimeSyncService } from "./service.js";

beforeEach((context) => setupAnvil(context));
beforeEach((context) => setupIsolatedDatabase(context));

const getBlockNumbers = () =>
  publicClient.getBlockNumber().then((b) => ({
    latestBlockNumber: Number(b),
    // deploy() + simulate() takes 4 blocks
    finalizedBlockNumber: Number(b) - 4,
  }));

test("setup() returns block numbers", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
    requestQueue: requestQueues[0],
  });

  const { latestBlockNumber, finalizedBlockNumber } = await service.setup();

  expect(latestBlockNumber).toBe(blockNumbers.latestBlockNumber);
  expect(finalizedBlockNumber).toBe(blockNumbers.finalizedBlockNumber);

  service.kill();
  await cleanup();
});

test("start() emits checkpoint at finality block even if no realtime contracts", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [
      { ...sources[0], endBlock: blockNumbers.finalizedBlockNumber - 1 },
    ],
    requestQueue: requestQueues[0],
  });

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  service.start();

  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    blockNumber: blockNumbers.finalizedBlockNumber,
    // Anvil messes with the block timestamp for blocks mined locally.
    blockTimestamp: expect.any(Number),
    chainId: 1,
  });

  service.kill();
  await cleanup();
});

test("start() sync realtime data with traversal method", async (context) => {
  const { common, networks, requestQueues, sources, erc20 } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });

  const emitSpy = vi.spyOn(service, "emit");
  const determineSpy = vi.spyOn(service, "determineSyncPath");

  await service.setup();
  service.start();

  await service.onIdle();

  expect(determineSpy).toHaveLastReturnedWith("traverse");

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  const transactions = await syncStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();

  const requiredTransactionHashes = new Set(logs.map((l) => l.transactionHash));

  expect(blocks).toHaveLength(1);
  expect(transactions.length).toEqual(requiredTransactionHashes.size);
  expect(logs).toHaveLength(2);

  expect(blocks.map((block) => decodeToBigInt(block.number))).toMatchObject([
    BigInt(blockNumbers.latestBlockNumber - 2),
  ]);
  logs.forEach((log) => {
    expect(log.address).toEqual(erc20.address);
  });
  transactions.forEach((transaction) => {
    expect(requiredTransactionHashes.has(transaction.hash)).toEqual(true);
  });

  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    blockNumber: blockNumbers.latestBlockNumber,
    // Anvil messes with the block timestamp for blocks mined locally.
    blockTimestamp: expect.any(Number),
    chainId: 1,
  });

  service.kill();
  await cleanup();
});

test("start() sync realtime data with batch method", async (context) => {
  const { common, networks, requestQueues, sources, erc20 } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });

  const emitSpy = vi.spyOn(service, "emit");
  const determineSpy = vi.spyOn(service, "determineSyncPath");

  await service.setup();
  await testClient.mine({ blocks: 10 });
  service.start();

  await service.onIdle();

  expect(determineSpy).toHaveLastReturnedWith("batch");

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  const transactions = await syncStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();

  const requiredTransactionHashes = new Set(logs.map((l) => l.transactionHash));

  expect(blocks).toHaveLength(1);
  expect(transactions.length).toEqual(requiredTransactionHashes.size);
  expect(logs).toHaveLength(2);

  expect(blocks.map((block) => decodeToBigInt(block.number))).toMatchObject([
    BigInt(blockNumbers.latestBlockNumber - 2),
  ]);
  logs.forEach((log) => {
    expect(log.address).toEqual(erc20.address);
  });
  transactions.forEach((transaction) => {
    expect(requiredTransactionHashes.has(transaction.hash)).toEqual(true);
  });

  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    blockNumber: blockNumbers.latestBlockNumber + 10,
    // Anvil messes with the block timestamp for blocks mined locally.
    blockTimestamp: expect.any(Number),
    chainId: 1,
  });

  service.kill();
  await cleanup();
});

test("start() insert logFilterInterval records with traversal method", async (context) => {
  const { common, networks, requestQueues, sources, erc20, factory } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });

  const requestSpy = vi.spyOn(service, "reconcileReorg");
  const emitSpy = vi.spyOn(service, "emit");
  const determineSpy = vi.spyOn(service, "determineSyncPath");

  await service.setup();
  service.start();

  await service.onIdle();

  expect(determineSpy).toHaveLastReturnedWith("traverse");

  await simulate({
    erc20Address: erc20.address,
    factoryAddress: factory.address,
  });

  service.process();
  await service.onIdle();

  expect(determineSpy).toHaveLastReturnedWith("batch");

  await simulate({
    erc20Address: erc20.address,
    factoryAddress: factory.address,
  });

  service.process();
  await service.onIdle();

  expect(determineSpy).toHaveLastReturnedWith("traverse");

  const logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: sources[0].chainId,
    logFilter: sources[0].criteria,
  });
  expect(logFilterIntervals).toMatchObject([
    [blockNumbers.finalizedBlockNumber + 1, blockNumbers.latestBlockNumber + 1],
  ]);

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", {
    blockNumber: blockNumbers.latestBlockNumber + 1,
    blockTimestamp: expect.any(Number),
    chainId: 1,
  });

  expect(requestSpy).toHaveBeenCalledTimes(1);

  service.kill();
  await cleanup();
});

test("start() insert logFilterInterval records with batch method", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });

  const emitSpy = vi.spyOn(service, "emit");
  const determineSpy = vi.spyOn(service, "determineSyncPath");

  await service.setup();
  await testClient.mine({ blocks: 10 });

  service.start();
  await service.onIdle();

  expect(determineSpy).toHaveLastReturnedWith("batch");

  const logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: sources[0].chainId,
    logFilter: sources[0].criteria,
  });
  expect(logFilterIntervals).toMatchObject([
    [blockNumbers.finalizedBlockNumber + 1, blockNumbers.latestBlockNumber - 2],
  ]);

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", {
    blockNumber: blockNumbers.latestBlockNumber - 2,
    blockTimestamp: expect.any(Number),
    chainId: 1,
  });

  service.kill();
  await cleanup();
});

test("start() retries on error", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });

  const insertBlockSpy = vi.spyOn(syncStore, "insertRealtimeBlock");

  insertBlockSpy.mockRejectedValueOnce(new Error());

  await service.setup();
  service.start();

  await service.onIdle();

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();

  expect(blocks).toHaveLength(1);
  expect(insertBlockSpy).toHaveBeenCalledTimes(2);

  service.kill();
  await cleanup();
});

test("start() emits fatal error", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: { ...networks[0], pollingInterval: 2_000 },
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });

  const emitSpy = vi.spyOn(service, "emit");
  const insertBlockSpy = vi.spyOn(syncStore, "insertRealtimeBlock");

  insertBlockSpy.mockRejectedValue(new Error());

  await service.setup();
  service.start();

  await service.onIdle();

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();

  expect(blocks).toHaveLength(0);
  expect(emitSpy).toHaveBeenCalledWith("fatal");

  service.kill();
  await cleanup();
});

test("start() deletes data from the store after 3 block shallow reorg", async (context) => {
  const { common, networks, requestQueues, sources, erc20, factory } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });

  // Take a snapshot of the chain at the original block height.
  const originalSnapshotId = await testClient.snapshot();

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  service.start();

  await service.onIdle();

  await simulate({
    erc20Address: erc20.address,
    factoryAddress: factory.address,
  });

  service.process();
  await service.onIdle();

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks.map((block) => decodeToBigInt(block.number))).toMatchObject([
    BigInt(blockNumbers.latestBlockNumber - 2),
    BigInt(blockNumbers.latestBlockNumber + 1),
  ]);

  // Now, revert to the original snapshot.
  await testClient.revert({ id: originalSnapshotId });

  await testClient.mine({ blocks: 8 });

  await simulate({
    erc20Address: erc20.address,
    factoryAddress: factory.address,
  });

  // Allow the service to process the new blocks.
  await service.process();
  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("shallowReorg", {
    blockTimestamp: expect.any(Number),
    chainId: 1,
    blockNumber: blockNumbers.latestBlockNumber,
  });

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", {
    blockTimestamp: expect.any(Number),
    chainId: 1,
    blockNumber: blockNumbers.latestBlockNumber,
  });

  const blocksAfterReorg = await syncStore.db
    .selectFrom("blocks")
    .selectAll()
    .execute();
  expect(
    blocksAfterReorg.map((block) => decodeToBigInt(block.number)),
  ).toMatchObject([
    BigInt(blockNumbers.latestBlockNumber - 2),
    BigInt(blockNumbers.latestBlockNumber + 9),
  ]);

  service.kill();
  await cleanup();
});

test("emits deepReorg event after deep reorg", async (context) => {
  const { common, networks, requestQueues, sources, erc20, factory } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });

  // Take a snapshot of the chain at the original block height.
  const originalSnapshotId = await testClient.snapshot();

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  service.start();

  await service.onIdle();

  await simulate({
    erc20Address: erc20.address,
    factoryAddress: factory.address,
  });

  await testClient.mine({ blocks: 10 });

  service.process();
  await service.onIdle();

  // Now, revert to the original snapshot.
  await testClient.revert({ id: originalSnapshotId });

  await testClient.mine({ blocks: 10 });

  // Allow the service to process the new blocks.
  await service.process();
  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("deepReorg", {
    detectedAtBlockNumber: expect.any(Number),
    minimumDepth: expect.any(Number),
  });
  expect(emitSpy).toHaveBeenCalledWith("fatal");

  service.kill();
  await cleanup();
});

test("start() sync realtime data with factory sources", async (context) => {
  const { common, networks, requestQueues, sources, factory } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
  });

  await service.setup();
  service.start();
  await service.onIdle();

  const iterator = syncStore.getFactoryChildAddresses({
    chainId: sources[1].chainId,
    factory: sources[1].criteria,
    upToBlockNumber: BigInt(blockNumbers.latestBlockNumber),
  });

  const childContractAddresses = [];
  for await (const page of iterator) childContractAddresses.push(...page);

  expect(childContractAddresses).toMatchObject([toLowerCase(factory.pair)]);

  service.kill();
  await cleanup();
});
