import {
  setupAnvil,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import {
  drainAsyncGenerator,
  getEventsErc20,
  publicClient,
} from "@/_test/utils.js";
import { maxCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { wait } from "@/utils/wait.js";
import { beforeEach, expect, test, vi } from "vitest";
import { HistoricalSyncService } from "./service.js";

beforeEach((context) => setupAnvil(context));
beforeEach((context) => setupIsolatedDatabase(context));

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
    upToBlockNumber: BigInt(blockNumbers.finalizedBlockNumber),
  });

  const childContractAddresses = [];
  for await (const page of iterator) childContractAddresses.push(...page);

  expect(childContractAddresses).toMatchObject([toLowerCase(factory.pair)]);

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
      { labels: { network: "mainnet", contract: "Erc20" }, value: 0 },
      { labels: { network: "mainnet", contract: "Pair_factory" }, value: 0 },
      { labels: { network: "mainnet", contract: "Pair" }, value: 0 },
    ]),
  );

  const totalBlocksMetric = (
    await common.metrics.ponder_historical_total_blocks.get()
  ).values;
  const value = blockNumbers.finalizedBlockNumber + 1;
  expect(totalBlocksMetric).toEqual(
    expect.arrayContaining([
      { labels: { network: "mainnet", contract: "Erc20" }, value },
      { labels: { network: "mainnet", contract: "Pair_factory" }, value },
      { labels: { network: "mainnet", contract: "Pair" }, value },
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
      { labels: { network: "mainnet", contract: "Pair_factory" }, value },
      { labels: { network: "mainnet", contract: "Erc20" }, value },
      { labels: { network: "mainnet", contract: "Pair" }, value },
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
  const events = drainAsyncGenerator(ag);

  const erc20Events = await getEventsErc20(sources);

  expect(erc20Events).toMatchObject(events);

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
    chainId: 1,
    blockNumber: Number(finalizedBlock.number),
  });

  service.kill();
  await service.onIdle();
  await cleanup();
});
