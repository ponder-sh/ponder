import {
  setupAnvil,
  setupContext,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { simulate, simulateErc20 } from "@/_test/simulate.js";
import { testClient } from "@/_test/utils.js";
import { maxCheckpoint } from "@/utils/checkpoint.js";
import { decodeToBigInt } from "@/utils/encoding.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { beforeEach, expect, test, vi } from "vitest";
import { RealtimeSyncService } from "./service.js";

beforeEach(setupContext);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("setup() returns block numbers", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
    requestQueue: requestQueues[0],
  });

  const { latestBlockNumber, finalizedBlockNumber } = await service.setup();

  expect(latestBlockNumber).toBe(4);
  expect(finalizedBlockNumber).toBe(0);

  service.kill();
  await cleanup();
});

test("start() emits checkpoint at finality block even if no realtime contracts", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [{ ...sources[0], endBlock: 1 }],
    requestQueue: requestQueues[0],
  });

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  service.start();

  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    ...maxCheckpoint,
    blockNumber: 0,
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

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  service.start();
  await service.onIdle();

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
    2n,
  ]);
  logs.forEach((log) => {
    expect(log.address).toEqual(erc20.address);
  });
  transactions.forEach((transaction) => {
    expect(requiredTransactionHashes.has(transaction.hash)).toEqual(true);
  });

  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    ...maxCheckpoint,
    blockNumber: 4,
    // Anvil messes with the block timestamp for blocks mined locally.
    blockTimestamp: expect.any(Number),
    chainId: 1,
  });

  service.kill();
  await cleanup();
});

test("start() insert logFilterInterval records with traversal method", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  service.start();
  await service.onIdle();

  await simulateErc20(context.erc20.address);
  await simulateErc20(context.erc20.address);
  await simulateErc20(context.erc20.address);
  await simulateErc20(context.erc20.address);
  service.process();
  await service.onIdle();

  const logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: sources[0].chainId,
    logFilter: sources[0].criteria,
  });
  expect(logFilterIntervals).toMatchObject([[1, 4]]);

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", {
    ...maxCheckpoint,
    blockNumber: 4,
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

test(
  "start() emits fatal error",
  async (context) => {
    const { common, networks, requestQueues, sources } = context;
    const { syncStore, cleanup } = await setupDatabaseServices(context);

    const service = new RealtimeSyncService({
      common,
      syncStore,
      network: { ...networks[0], pollingInterval: 10_000 },
      requestQueue: requestQueues[0],
      sources: [sources[0]],
    });

    const emitSpy = vi.spyOn(service, "emit");
    const insertBlockSpy = vi.spyOn(syncStore, "insertRealtimeBlock");

    insertBlockSpy.mockRejectedValue(new Error());

    await service.setup();
    service.start();
    await service.onIdle();

    const blocks = await syncStore.db
      .selectFrom("blocks")
      .selectAll()
      .execute();

    expect(blocks).toHaveLength(0);
    expect(emitSpy).toHaveBeenCalledWith("fatal", expect.any(Error));

    service.kill();
    await cleanup();
  },
  { timeout: 10_000 },
);

test("start() deletes data from the store after 2 block reorg", async (context) => {
  const { common, networks, requestQueues, sources, erc20, factory } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  service.start();
  await service.onIdle();

  // Take a snapshot of the chain at the original block height.
  const originalSnapshotId = await testClient.snapshot();
  await simulate({
    erc20Address: erc20.address,
    factoryAddress: factory.address,
  });

  service.process();
  await service.onIdle();

  // Now, revert to the original snapshot.
  await testClient.revert({ id: originalSnapshotId });
  // Mine enough blocks to move the finality checkpoint
  await testClient.mine({ blocks: 4 });

  service.process();
  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("reorg", {
    ...maxCheckpoint,
    blockTimestamp: expect.any(Number),
    chainId: 1,
    blockNumber: 4,
  });

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", {
    ...maxCheckpoint,
    blockTimestamp: expect.any(Number),
    chainId: 1,
    blockNumber: 4,
  });

  const blocksAfterReorg = await syncStore.db
    .selectFrom("blocks")
    .selectAll()
    .execute();
  expect(
    blocksAfterReorg.map((block) => decodeToBigInt(block.number)),
  ).toMatchObject([2n]);

  service.kill();
  await cleanup();
});

test("start() fatal after unrecoverable reorg", async (context) => {
  const { common, networks, requestQueues, sources, erc20 } = context;
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

  // add data that can eventually be forked out and finalize it
  await simulateErc20(erc20.address);
  await testClient.mine({ blocks: 8 });

  service.process();
  await service.onIdle();

  // Now, revert to the original snapshot.
  await testClient.revert({ id: originalSnapshotId });
  await testClient.mine({ blocks: 12 });

  // Allow the service to process the new blocks.
  service.process();
  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("fatal", expect.any(Error));

  service.kill();
  await cleanup();
});

test("start() sync realtime data with factory sources", async (context) => {
  const { common, networks, requestQueues, sources, factory } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
  });

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  service.start();
  await service.onIdle();

  const iterator = syncStore.getFactoryChildAddresses({
    chainId: sources[1].chainId,
    factory: sources[1].criteria,
    upToBlockNumber: BigInt(4),
  });

  const childContractAddresses = [];
  for await (const page of iterator) childContractAddresses.push(...page);

  expect(childContractAddresses).toMatchObject([toLowerCase(factory.pair)]);

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  const transactions = await syncStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();

  const requiredTransactionHashes = new Set(logs.map((l) => l.transactionHash));

  expect(blocks).toHaveLength(2);
  expect(transactions.length + 1).toEqual(requiredTransactionHashes.size);
  expect(logs).toHaveLength(4);

  expect(blocks.map((block) => decodeToBigInt(block.number))).toMatchObject([
    2n,
    4n,
  ]);

  transactions.forEach((transaction) => {
    expect(requiredTransactionHashes.has(transaction.hash)).toEqual(true);
  });

  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    ...maxCheckpoint,
    blockNumber: 4,
    // Anvil messes with the block timestamp for blocks mined locally.
    blockTimestamp: expect.any(Number),
    chainId: 1,
  });

  service.kill();
  await cleanup();
});

test("start() finalize realtime data with factory sources", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
  });

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  await testClient.mine({ blocks: 4 });
  service.start();
  await service.onIdle();

  const logFilterIntervals = await syncStore.getFactoryLogFilterIntervals({
    chainId: sources[1].chainId,
    factory: sources[1].criteria,
  });
  expect(logFilterIntervals).toMatchObject([[1, 4]]);

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", {
    ...maxCheckpoint,
    blockNumber: 4,
    // Anvil messes with the block timestamp for blocks mined locally.
    blockTimestamp: expect.any(Number),
    chainId: 1,
  });

  service.kill();
  await cleanup();
});
