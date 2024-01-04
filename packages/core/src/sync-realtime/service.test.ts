import { setupAnvil, setupSyncStore } from "@/_test/setup.js";
import { simulate } from "@/_test/simulate.js";
import { publicClient, testClient } from "@/_test/utils.js";
import { maxCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { decodeToBigInt } from "@/utils/encoding.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { range } from "@/utils/range.js";
import { HttpRequestError } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import { RealtimeSyncService } from "./service.js";

beforeEach((context) => setupAnvil(context));
beforeEach((context) => setupSyncStore(context));

const getBlockNumbers = () =>
  publicClient.getBlockNumber().then((b) => ({
    latestBlockNumber: Number(b),
    // deploy() + simulate() takes 4 blocks
    finalizedBlockNumber: Number(b) - 4,
  }));

test("setup() returns block numbers", async (context) => {
  const { common, syncStore, sources, networks } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });

  const { latestBlockNumber, finalizedBlockNumber } = await service.setup();

  expect(latestBlockNumber).toBe(blockNumbers.latestBlockNumber);
  expect(finalizedBlockNumber).toBe(blockNumbers.finalizedBlockNumber);

  await service.kill();
  networks[0].requestQueue.clear();
});

test("start() adds blocks to the store from finalized to latest", async (context) => {
  const { common, syncStore, networks, sources } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });

  await service.setup();
  await service.start();
  await service.onIdle();

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();

  expect(blocks).toHaveLength(1);
  expect(blocks.map((block) => decodeToBigInt(block.number))).toMatchObject([
    BigInt(blockNumbers.latestBlockNumber - 2),
  ]);

  await service.kill();
  networks[0].requestQueue.clear();
});

test("start() adds all required transactions to the store", async (context) => {
  const { common, syncStore, networks, sources } = context;

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });

  await service.setup();
  await service.start();
  await service.onIdle();

  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  const requiredTransactionHashes = new Set(logs.map((l) => l.transactionHash));

  const transactions = await syncStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();

  expect(transactions.length).toEqual(requiredTransactionHashes.size);
  transactions.forEach((transaction) => {
    expect(requiredTransactionHashes.has(transaction.hash)).toEqual(true);
  });

  await service.kill();
  networks[0].requestQueue.clear();
});

test("start() adds all matched logs to the store", async (context) => {
  const { common, syncStore, networks, sources, erc20 } = context;

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });

  await service.setup();
  await service.start();
  await service.onIdle();

  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
  logs.forEach((log) => {
    expect(log.address).toEqual(erc20.address);
  });

  await service.kill();
  networks[0].requestQueue.clear();
});

test("start() handles new blocks", async (context) => {
  const { common, syncStore, sources, networks, erc20, factory } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });

  await service.setup();
  await service.start();

  await simulate({
    erc20Address: erc20.address,
    factoryAddress: factory.address,
  });

  await service.addNewLatestBlock();

  await service.onIdle();

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();

  expect(blocks).toHaveLength(2);

  expect(blocks.map((block) => decodeToBigInt(block.number))).toMatchObject([
    BigInt(blockNumbers.latestBlockNumber - 2),
    BigInt(blockNumbers.latestBlockNumber + 1),
  ]);

  await service.kill();
  networks[0].requestQueue.clear();
});

test("start() handles error while fetching new latest block gracefully", async (context) => {
  const { common, syncStore, sources, networks, erc20, factory } = context;

  const blockNumbers = await getBlockNumbers();

  const rpcRequestSpy = vi.spyOn(networks[0].requestQueue, "request");

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });

  await service.setup();
  await service.start();

  await simulate({
    erc20Address: erc20.address,
    factoryAddress: factory.address,
  });

  // Mock a failed new block request.
  rpcRequestSpy.mockRejectedValueOnce(
    new HttpRequestError({ url: "http://ponder.sh/rpc" }),
  );
  await service.addNewLatestBlock();

  // Now, this one should succeed.
  await service.addNewLatestBlock();

  await service.onIdle();

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(2);
  expect(blocks.map((block) => decodeToBigInt(block.number))).toMatchObject([
    BigInt(blockNumbers.latestBlockNumber - 2),
    BigInt(blockNumbers.latestBlockNumber + 1),
  ]);

  await service.kill();
  networks[0].requestQueue.clear();
});

test("start() emits realtimeCheckpoint events", async (context) => {
  const { common, syncStore, sources, networks } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  await service.start();
  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledTimes(4);

  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    blockNumber: blockNumbers.latestBlockNumber - 3,
    // Anvil messes with the block number for blocks mined locally.
    blockTimestamp: expect.any(Number),
    chainId: 1,
  });
  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    blockNumber: blockNumbers.latestBlockNumber - 2,
    // Anvil messes with the block number for blocks mined locally.
    blockTimestamp: expect.any(Number),
    chainId: 1,
  });
  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    blockNumber: blockNumbers.latestBlockNumber - 1,
    // Anvil messes with the block number for blocks mined locally.
    blockTimestamp: expect.any(Number),
    chainId: 1,
  });
  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    blockNumber: blockNumbers.latestBlockNumber,
    // Anvil messes with the block number for blocks mined locally.
    blockTimestamp: expect.any(Number),
    chainId: 1,
  });

  await service.kill();
  networks[0].requestQueue.clear();
});

test("start() inserts log filter interval records for finalized blocks", async (context) => {
  const { common, syncStore, sources, networks, erc20, factory } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  await service.start();

  for (const _ in range(0, 2)) {
    await simulate({
      erc20Address: erc20.address,
      factoryAddress: factory.address,
    });
  }

  await service.addNewLatestBlock();
  await service.onIdle();

  const logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: sources[0].chainId,
    logFilter: sources[0].criteria,
  });
  expect(logFilterIntervals).toMatchObject([
    [blockNumbers.finalizedBlockNumber + 1, blockNumbers.latestBlockNumber],
  ]);

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", {
    blockNumber: blockNumbers.latestBlockNumber,
    blockTimestamp: expect.any(Number),
    chainId: 1,
  });

  await service.kill();
  networks[0].requestQueue.clear();
});

test("start() deletes data from the store after 3 block shallow reorg", async (context) => {
  const { common, syncStore, sources, networks, erc20, factory } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });

  await service.setup();
  await service.start();

  // Take a snapshot of the chain at the original block height.
  const originalSnapshotId = await testClient.snapshot();

  for (const _ in range(0, 2)) {
    await simulate({
      erc20Address: erc20.address,
      factoryAddress: factory.address,
    });
  }

  // Allow the service to process the new blocks.
  await service.addNewLatestBlock();
  await service.onIdle();

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks.map((block) => decodeToBigInt(block.number))).toMatchObject([
    BigInt(blockNumbers.latestBlockNumber - 2),
    BigInt(blockNumbers.latestBlockNumber + 1),
    BigInt(blockNumbers.latestBlockNumber + 4),
  ]);

  // Now, revert to the original snapshot.
  await testClient.revert({ id: originalSnapshotId });

  await simulate({
    erc20Address: erc20.address,
    factoryAddress: factory.address,
  });

  // Allow the service to process the new blocks.
  await service.addNewLatestBlock();
  await service.onIdle();
  await service.onIdle();

  const blocksAfterReorg = await syncStore.db
    .selectFrom("blocks")
    .selectAll()
    .execute();
  expect(
    blocksAfterReorg.map((block) => decodeToBigInt(block.number)),
  ).toMatchObject([
    BigInt(blockNumbers.latestBlockNumber - 2),
    BigInt(blockNumbers.latestBlockNumber + 1),
  ]);

  await service.kill();
  networks[0].requestQueue.clear();
});

test("start() emits shallowReorg event after 3 block shallow reorg", async (context) => {
  const { common, syncStore, sources, networks, erc20, factory } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  await service.start();

  // Take a snapshot of the chain at the original block height.
  const originalSnapshotId = await testClient.snapshot();

  await simulate({
    erc20Address: erc20.address,
    factoryAddress: factory.address,
  });

  // Allow the service to process the new blocks.
  await service.addNewLatestBlock();
  await service.onIdle();

  // Now, revert to the original snapshot.
  await testClient.revert({ id: originalSnapshotId });
  await testClient.mine({ blocks: 1 });

  // Add one new empty block (16380001).
  await service.addNewLatestBlock();
  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("shallowReorg", {
    blockTimestamp: expect.any(Number),
    blockNumber: blockNumbers.latestBlockNumber,
    chainId: 1,
  });

  await service.kill();
  networks[0].requestQueue.clear();
});

test("emits deepReorg event after deep reorg", async (context) => {
  const { common, syncStore, sources, networks, erc20, factory } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  await service.start();

  // Take a snapshot of the chain at the original block height.
  const originalSnapshotId = await testClient.snapshot();

  for (const _ in range(0, 3)) {
    await simulate({
      erc20Address: erc20.address,
      factoryAddress: factory.address,
    });
  }
  // Allow the service to process the new blocks.
  await service.addNewLatestBlock();
  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", {
    blockNumber: blockNumbers.latestBlockNumber,
    blockTimestamp: expect.any(Number),
    chainId: 1,
  });

  // Now, revert to the original snapshot and mine 8 blocks, with a different chain history than before.
  await testClient.revert({ id: originalSnapshotId });
  for (const _ in range(0, 3)) {
    await simulate({
      erc20Address: erc20.address,
      factoryAddress: factory.address,
    });
  }

  // Allow the service to process the new block, detecting a reorg.
  await service.addNewLatestBlock();
  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("deepReorg", {
    detectedAtBlockNumber: blockNumbers.latestBlockNumber + 9,
    minimumDepth: 5,
  });

  await service.kill();
  networks[0].requestQueue.clear();
});

test("start() with factory contract inserts new child contracts records and child contract events", async (context) => {
  const { common, syncStore, sources, networks, erc20, factory } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[1]],
  });

  await service.setup();
  await service.start();

  await simulate({
    erc20Address: erc20.address,
    factoryAddress: factory.address,
  });

  await service.addNewLatestBlock();
  await service.onIdle();

  const iterator = syncStore.getFactoryChildAddresses({
    chainId: sources[1].chainId,
    factory: sources[1].criteria,
    upToBlockNumber: BigInt(blockNumbers.latestBlockNumber),
  });

  const childContractAddresses = [];
  for await (const page of iterator) childContractAddresses.push(...page);

  expect(childContractAddresses).toMatchObject([toLowerCase(factory.pair)]);

  const eventIterator = syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    factories: [
      {
        id: "Pair",
        chainId: sources[1].chainId,
        criteria: sources[1].criteria,
      },
    ],
  });
  const events = [];
  for await (const page of eventIterator) events.push(...page.events);

  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject(
    expect.objectContaining({
      sourceId: "Pair",
      log: expect.objectContaining({
        address: factory.pair,
      }),
    }),
  );

  await service.kill();
  networks[0].requestQueue.clear();
});
