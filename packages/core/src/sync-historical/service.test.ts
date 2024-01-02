import { setupAnvil, setupSyncStore } from "@/_test/setup.js";
import { getEventsErc20, publicClient } from "@/_test/utils.js";
import { maxCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { beforeEach, expect, test, vi } from "vitest";
import { HistoricalSyncService } from "./service.js";

beforeEach((context) => setupAnvil(context));
beforeEach((context) => setupSyncStore(context));

const getBlockNumbers = () =>
  publicClient.getBlockNumber().then((b) => ({
    latestBlockNumber: Number(b) + 5,
    finalizedBlockNumber: Number(b),
  }));

test("start() with log filter inserts log filter interval records", async (context) => {
  const { common, syncStore, networks, sources } = context;

  const blockNumbers = await getBlockNumbers();
  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0]!,
    sources: [sources[0]],
  });
  await service.start(blockNumbers);

  await new Promise<void>((resolve) => service.on("syncComplete", resolve));

  const logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: sources[0].chainId,
    logFilter: sources[0].criteria,
  });

  expect(logFilterIntervals).toMatchObject([
    [0, blockNumbers.finalizedBlockNumber],
  ]);

  networks[0].requestQueue.kill();
  networks[0].requestQueue.clear();
});

test("start() with factory contract inserts log filter and factory log filter interval records", async (context) => {
  const { common, syncStore, networks, sources } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[1]],
  });
  await service.start(blockNumbers);

  await new Promise<void>((resolve) => service.on("syncComplete", resolve));

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

  networks[0].requestQueue.kill();
  networks[0].requestQueue.clear();
});

test("start() with factory contract inserts child contract addresses", async (context) => {
  const { common, syncStore, networks, sources, factory } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[1]],
  });
  await service.start(blockNumbers);

  await new Promise<void>((resolve) => service.on("syncComplete", resolve));

  const iterator = syncStore.getFactoryChildAddresses({
    chainId: sources[1].chainId,
    factory: sources[1].criteria,
    upToBlockNumber: BigInt(blockNumbers.finalizedBlockNumber),
  });

  const childContractAddresses = [];
  for await (const page of iterator) childContractAddresses.push(...page);

  expect(childContractAddresses).toMatchObject([toLowerCase(factory.pair)]);

  networks[0].requestQueue.kill();
  networks[0].requestQueue.clear();
});

test("setup() with log filter and factory contract updates block metrics", async (context) => {
  const { common, syncStore, networks, sources } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    sources,
  });

  await service.start(blockNumbers);

  const cachedBlocksMetric = (
    await common.metrics.ponder_historical_cached_blocks.get()
  ).values;

  expect(cachedBlocksMetric).toMatchObject([
    { labels: { network: "mainnet", contract: "Erc20" }, value: 0 },
    {
      labels: {
        network: "mainnet",
        contract: "Pair_factory",
      },
      value: 0,
    },
    {
      labels: { network: "mainnet", contract: "Pair" },
      value: 0,
    },
  ]);

  const totalBlocksMetric = (
    await common.metrics.ponder_historical_total_blocks.get()
  ).values;
  expect(totalBlocksMetric).toMatchObject([
    {
      labels: { network: "mainnet", contract: "Erc20" },
      value: blockNumbers.finalizedBlockNumber + 1,
    },
    {
      labels: {
        network: "mainnet",
        contract: "Pair_factory",
      },
      value: blockNumbers.finalizedBlockNumber + 1,
    },
    {
      labels: { network: "mainnet", contract: "Pair" },
      value: blockNumbers.finalizedBlockNumber + 1,
    },
  ]);

  await new Promise<void>((resolve) => service.on("syncComplete", resolve));

  networks[0].requestQueue.kill();
  networks[0].requestQueue.clear();
});

test("start() with log filter and factory contract updates completed blocks metrics", async (context) => {
  const { common, syncStore, networks, sources } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    sources,
  });

  await service.start(blockNumbers);

  await new Promise<void>((resolve) => service.on("syncComplete", resolve));

  const completedBlocksMetric = (
    await common.metrics.ponder_historical_completed_blocks.get()
  ).values;
  expect(completedBlocksMetric).toMatchObject([
    {
      labels: {
        network: "mainnet",
        contract: "Pair_factory",
      },
      value: blockNumbers.finalizedBlockNumber + 1,
    },
    {
      labels: { network: "mainnet", contract: "Erc20" },
      value: blockNumbers.finalizedBlockNumber + 1,
    },
    {
      labels: { network: "mainnet", contract: "Pair" },
      value: blockNumbers.finalizedBlockNumber + 1,
    },
  ]);

  networks[0].requestQueue.kill();
  networks[0].requestQueue.clear();
});

test("start() adds log filter events to sync store", async (context) => {
  const { common, syncStore, sources, networks } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });
  await service.start(blockNumbers);

  await new Promise<void>((resolve) => service.on("syncComplete", resolve));

  const iterator = syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    logFilters: [
      {
        id: sources[0].id,
        chainId: sources[0].chainId,
        criteria: sources[0].criteria,
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  const getEvents = await getEventsErc20(sources);
  const erc20Events = [];
  for await (const page of getEvents({ toCheckpoint: maxCheckpoint }))
    erc20Events.push(...page.events);

  expect(erc20Events).toMatchObject(events);

  networks[0].requestQueue.kill();
  networks[0].requestQueue.clear();
});

test("start() adds log filter and factory contract events to sync store", async (context) => {
  const { common, syncStore, networks, sources } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    sources,
  });
  await service.start(blockNumbers);

  await new Promise<void>((resolve) => service.on("syncComplete", resolve));

  const iterator = syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    logFilters: [
      {
        id: "Erc20",
        chainId: sources[0].chainId,
        criteria: sources[0].criteria,
      },
    ],
    factories: [
      {
        id: "Pair",
        chainId: sources[1].chainId,
        criteria: sources[1].criteria,
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  const sourceIds = events.map((event) => event.sourceId);

  expect(sourceIds.includes("Erc20")).toBe(true);
  expect(sourceIds.includes("Pair")).toBe(true);

  networks[0].requestQueue.kill();
  networks[0].requestQueue.clear();
});

test.todo("start() emits error in log filter task");

test.todo("start() emits error in block task");

test("start() emits sync completed event", async (context) => {
  const { common, syncStore, sources, networks } = context;

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });
  const emitSpy = vi.spyOn(service, "emit");

  await service.start(await getBlockNumbers());

  await new Promise<void>((resolve) => service.on("syncComplete", resolve));

  expect(emitSpy).toHaveBeenCalledWith("syncComplete");

  networks[0].requestQueue.kill();
  networks[0].requestQueue.clear();
});

test("start() emits checkpoint and sync completed event if 100% cached", async (context) => {
  const { common, syncStore, sources, networks } = context;

  const blockNumbers = await getBlockNumbers();

  let service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });

  await service.start(blockNumbers);

  await new Promise<void>((resolve) => service.on("syncComplete", resolve));

  networks[0].requestQueue.kill();
  networks[0].requestQueue.clear();

  service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });

  const emitSpy = vi.spyOn(service, "emit");

  const onComplete = new Promise<void>((resolve) =>
    service.on("syncComplete", resolve),
  );

  await service.start(blockNumbers);

  await onComplete;

  expect(emitSpy).toHaveBeenCalledWith("historicalCheckpoint", {
    blockTimestamp: expect.any(Number),
    chainId: 1,
    blockNumber: expect.any(Number),
  });
  expect(emitSpy).toHaveBeenCalledWith("syncComplete");
  expect(emitSpy).toHaveBeenCalledTimes(3);

  networks[0].requestQueue.kill();
  networks[0].requestQueue.clear();
});

test("start() emits historicalCheckpoint event", async (context) => {
  const { common, syncStore, sources, networks } = context;

  const blockNumbers = await getBlockNumbers();
  const finalizedBlock = await publicClient.getBlock({
    blockNumber: BigInt(blockNumbers.finalizedBlockNumber),
  });

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });
  const emitSpy = vi.spyOn(service, "emit");

  await service.start(blockNumbers);

  await new Promise<void>((resolve) => service.on("syncComplete", resolve));

  expect(emitSpy).toHaveBeenCalledWith("historicalCheckpoint", {
    blockTimestamp: Number(finalizedBlock.timestamp),
    chainId: 1,
    blockNumber: Number(finalizedBlock.number),
  });

  networks[0].requestQueue.kill();
  networks[0].requestQueue.clear();
});
