import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getEventsErc20, publicClient } from "@/_test/utils.js";
import { maxCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { drainAsyncGenerator } from "@/utils/drainAsyncGenerator.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { wait } from "@/utils/wait.js";
import { numberToHex } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import { HistoricalSyncService } from "./service.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

const getBlockNumbers = () =>
  publicClient.getBlockNumber().then((b) => ({
    latestBlockNumber: Number(b) + 5,
    finalizedBlockNumber: Number(b),
  }));

test("start() with log filter inserts log filter interval records", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const blockNumbers = await getBlockNumbers();
  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: sources[0].chainId,
    logFilter: sources[0].criteria,
  });

  expect(logFilterIntervals).toMatchObject([
    [0, blockNumbers.finalizedBlockNumber],
  ]);

  service.kill();
  await service.onIdle();
  await cleanup();
});

test("start() inserts transaction receipts", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const blockNumbers = await getBlockNumbers();
  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [
      {
        ...sources[0],
        criteria: { ...sources[0].criteria, includeTransactionReceipts: true },
      },
    ],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const transactionReceipts = await syncStore.db
    .selectFrom("transactionReceipts")
    .selectAll()
    .execute();
  expect(transactionReceipts).toHaveLength(2);

  service.kill();
  await service.onIdle();
  await cleanup();
});

test("start() with factory contract inserts log filter and factory log filter interval records", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[1]],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const childAddressLogFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: sources[1].chainId,
    logFilter: {
      address: sources[1].criteria.address,
      topics: [sources[1].criteria.eventSelector],
      includeTransactionReceipts: false,
    },
  });

  expect(childAddressLogFilterIntervals).toMatchObject([
    [0, blockNumbers.finalizedBlockNumber],
  ]);

  const childContractIntervals = await syncStore.getFactoryLogFilterIntervals({
    chainId: sources[1].chainId,
    factory: sources[1].criteria,
  });
  expect(childContractIntervals).toMatchObject([
    [0, blockNumbers.finalizedBlockNumber],
  ]);

  service.kill();
  await service.onIdle();
  await cleanup();
});

test("start() with factory contract inserts child contract addresses", async (context) => {
  const { common, networks, requestQueues, sources, factory } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[1]],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const iterator = syncStore.getFactoryChildAddresses({
    chainId: sources[1].chainId,
    factory: sources[1].criteria,
    fromBlock: BigInt(sources[1].startBlock),
    toBlock: BigInt(blockNumbers.finalizedBlockNumber),
  });

  const childContractAddresses = [];
  for await (const page of iterator) childContractAddresses.push(...page);

  expect(childContractAddresses).toMatchObject([toLowerCase(factory.pair)]);

  service.kill();
  await service.onIdle();
  await cleanup();
});

test("start() with block filter inserts block filter interval", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const blockNumbers = await getBlockNumbers();
  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[2]],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const blockFilterIntervals = await syncStore.getBlockFilterIntervals({
    chainId: sources[2].chainId,
    blockFilter: sources[2].criteria,
  });

  expect(blockFilterIntervals).toMatchObject([
    [0, blockNumbers.finalizedBlockNumber],
  ]);

  service.kill();
  await service.onIdle();
  await cleanup();
});

test.only("start() with block filter skips blocks already in database", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const blockNumbers = await getBlockNumbers();

  const block = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: [numberToHex(blockNumbers.finalizedBlockNumber - 3), true],
  });

  await syncStore.insertRealtimeBlock({
    chainId: 1,
    block: block!,
    logs: [],
    transactions: [],
    transactionReceipts: [],
  });

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[2]],
  });
  await service.setup(blockNumbers);

  const requestSpy = vi.spyOn(requestQueues[0], "request");

  service.start();
  await service.onIdle();

  const blockFilterIntervals = await syncStore.getBlockFilterIntervals({
    chainId: sources[2].chainId,
    blockFilter: sources[2].criteria,
  });

  expect(blockFilterIntervals).toMatchObject([
    [0, blockNumbers.finalizedBlockNumber],
  ]);

  expect(requestSpy).toHaveBeenCalledTimes(1);

  service.kill();
  await service.onIdle();
  await cleanup();
});

test("setup() with log filter and factory contract updates block metrics", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
  });
  await service.setup(blockNumbers);

  const cachedBlocksMetric = (
    await common.metrics.ponder_historical_cached_blocks.get()
  ).values;
  expect(cachedBlocksMetric).toEqual(
    expect.arrayContaining([
      { labels: { network: "mainnet", source: "Erc20" }, value: 0 },
      { labels: { network: "mainnet", source: "Pair_factory" }, value: 0 },
      { labels: { network: "mainnet", source: "Pair" }, value: 0 },
    ]),
  );

  const totalBlocksMetric = (
    await common.metrics.ponder_historical_total_blocks.get()
  ).values;
  const value = blockNumbers.finalizedBlockNumber + 1;
  expect(totalBlocksMetric).toEqual(
    expect.arrayContaining([
      { labels: { network: "mainnet", source: "Erc20" }, value },
      { labels: { network: "mainnet", source: "Pair_factory" }, value },
      { labels: { network: "mainnet", source: "Pair" }, value },
    ]),
  );

  service.kill();
  await service.onIdle();
  await cleanup();
});

test("start() with log filter and factory contract updates completed blocks metrics", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const completedBlocksMetric = (
    await common.metrics.ponder_historical_completed_blocks.get()
  ).values;
  const value = blockNumbers.finalizedBlockNumber + 1;
  expect(completedBlocksMetric).toEqual(
    expect.arrayContaining([
      { labels: { network: "mainnet", source: "Pair_factory" }, value },
      { labels: { network: "mainnet", source: "Erc20" }, value },
      { labels: { network: "mainnet", source: "Pair" }, value },
    ]),
  );

  service.kill();
  await service.onIdle();
  await cleanup();
});

test("start() adds log filter events to sync store", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const ag = syncStore.getLogEvents({
    sources: [sources[0]],
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(2);

  const erc20Events = await getEventsErc20(sources);

  expect({
    ...erc20Events[0],
    transactionReceipt: undefined,
  }).toMatchObject(events[0]);
  expect({
    ...erc20Events[1],
    transactionReceipt: undefined,
  }).toMatchObject(events[1]);

  service.kill();
  await service.onIdle();
  await cleanup();
});

test("start() adds factory events to sync store", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const ag = syncStore.getLogEvents({
    sources: [sources[1]],
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(1);

  service.kill();
  await service.onIdle();
  await cleanup();
});

test("start() adds block filter events to sync store", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[2]],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const ag = syncStore.getLogEvents({
    sources: [sources[2]],
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
  });
  const events = await drainAsyncGenerator(ag);

  expect(events).toHaveLength(2);

  expect(events[0].log).toBeUndefined();
  expect(events[0].transaction).toBeUndefined();
  expect(events[0].block.number).toBe(1n);

  expect(events[1].log).toBeUndefined();
  expect(events[1].transaction).toBeUndefined();
  expect(events[1].block.number).toBe(3n);

  service.kill();
  await service.onIdle();
  await cleanup();
});

test("start() retries unexpected error in log filter task", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const rpcRequestSpy = vi.spyOn(requestQueues[0], "request");

  rpcRequestSpy.mockRejectedValueOnce(new Error("Unexpected error!"));

  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: sources[0].chainId,
    logFilter: sources[0].criteria,
  });

  expect(logFilterIntervals).toMatchObject([
    [0, blockNumbers.finalizedBlockNumber],
  ]);
  // 2 logs + 2 blocks
  expect(rpcRequestSpy).toHaveBeenCalledTimes(4);

  service.kill();
  await service.onIdle();
  await cleanup();
});

test("start() retries unexpected error in block task", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumbers = await getBlockNumbers();

  const spy = vi.spyOn(syncStore, "insertLogFilterInterval");
  spy.mockRejectedValueOnce(new Error("Unexpected error!"));

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: sources[0].chainId,
    logFilter: sources[0].criteria,
  });

  expect(logFilterIntervals).toMatchObject([
    [0, blockNumbers.finalizedBlockNumber],
  ]);
  expect(spy).toHaveBeenCalledTimes(3);

  service.kill();
  await service.onIdle();
  await cleanup();
});

test("start() emits sync completed event", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });
  const emitSpy = vi.spyOn(service, "emit");

  await service.setup(await getBlockNumbers());
  service.start();

  await service.onIdle();
  expect(emitSpy).toHaveBeenCalledWith("syncComplete");

  service.kill();
  await service.onIdle();
  await cleanup();
});

test("start() emits checkpoint and sync completed event if 100% cached", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumbers = await getBlockNumbers();

  let service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });

  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();
  service.kill();
  await service.onIdle();

  service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("syncComplete");
  expect(emitSpy).toHaveBeenCalledTimes(1);

  service.kill();
  await service.onIdle();
  await cleanup();
});

test("start() emits historicalCheckpoint event", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumbers = await getBlockNumbers();
  const finalizedBlock = await publicClient.getBlock({
    blockNumber: BigInt(blockNumbers.finalizedBlockNumber),
  });

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
  });
  const emitSpy = vi.spyOn(service, "emit");

  await service.setup(blockNumbers);
  service.start();

  await service.onIdle();

  // Flush the debounce state
  await wait(500);

  expect(emitSpy).toHaveBeenCalledWith("historicalCheckpoint", {
    ...maxCheckpoint,
    blockTimestamp: Number(finalizedBlock.timestamp),
    chainId: 1n,
    blockNumber: BigInt(finalizedBlock.number),
  });

  service.kill();
  await service.onIdle();
  await cleanup();
});
