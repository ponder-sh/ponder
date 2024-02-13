import { HttpRequestError, InvalidParamsRpcError } from "viem";
import { beforeEach, expect, test, vi } from "vitest";

import { setupAnvil, setupSyncStore } from "@/_test/setup.js";
import { getEventsErc20, publicClient } from "@/_test/utils.js";
import { maxCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { toLowerCase } from "@/utils/lowercase.js";

import { HistoricalSyncService } from "./service.js";

beforeEach((context) => setupAnvil(context));
beforeEach((context) => setupSyncStore(context));

const getBlockNumbers = () =>
  publicClient.getBlockNumber().then((b) => ({
    latestBlockNumber: Number(b) + 5,
    finalizedBlockNumber: Number(b),
  }));

test("start() with log filter inserts log filter interval records", async (context) => {
  const { common, syncStore, networks, requestQueues, sources } = context;

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
});

test("start() with factory contract inserts log filter and factory log filter interval records", async (context) => {
  const { common, syncStore, networks, requestQueues, sources } = context;

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
});

test("start() with factory contract inserts child contract addresses", async (context) => {
  const { common, syncStore, networks, sources, requestQueues, factory } =
    context;

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
});

test("setup() with log filter and factory contract updates block metrics", async (context) => {
  const { common, syncStore, networks, requestQueues, sources } = context;

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
});

test("start() with log filter and factory contract updates completed blocks metrics", async (context) => {
  const { common, syncStore, networks, requestQueues, sources } = context;

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
});

test("start() adds log filter events to sync store", async (context) => {
  const { common, syncStore, sources, networks, requestQueues } = context;

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

  const { events } = await syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
    logFilters: [
      {
        id: sources[0].id,
        chainId: sources[0].chainId,
        criteria: sources[0].criteria,
      },
    ],
  });

  const getEvents = await getEventsErc20(sources);
  const { events: erc20Events } = getEvents({
    toCheckpoint: maxCheckpoint,
  });

  expect(erc20Events).toMatchObject(events);

  service.kill();
  await service.onIdle();
});

test("start() adds log filter and factory contract events to sync store", async (context) => {
  const { common, syncStore, networks, requestQueues, sources } = context;

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

  const { events } = await syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    limit: 100,
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

  const sourceIds = events.map((event) => event.sourceId);

  expect(sourceIds.includes("Erc20")).toBe(true);
  expect(sourceIds.includes("Pair")).toBe(true);

  service.kill();
  await service.onIdle();
});

test("start() retries unexpected error in log filter task", async (context) => {
  const { common, syncStore, networks, requestQueues, sources } = context;

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
});

test("start() retries unexpected error in block task", async (context) => {
  const { common, syncStore, networks, requestQueues, sources } = context;

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
});

test("start() handles Alchemy 'Log response size exceeded' error", async (context) => {
  const { common, syncStore, networks, requestQueues, sources } = context;

  const blockNumbers = await getBlockNumbers();

  const rpcRequestSpy = vi.spyOn(requestQueues[0], "request");

  rpcRequestSpy.mockRejectedValueOnce(
    new InvalidParamsRpcError(
      new Error(
        // The suggested block range is 16369995 to 16369996.
        "Log response size exceeded. this block range should work: [0xf9c94b, 0xf9c94c]",
      ),
    ),
  );

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
});

test("start() handles Quicknode 'eth_getLogs and eth_newFilter are limited to a 10,000 blocks range' error", async (context) => {
  const { common, syncStore, networks, requestQueues, sources } = context;

  const blockNumbers = await getBlockNumbers();

  const rpcRequestSpy = vi.spyOn(requestQueues[0], "request");

  rpcRequestSpy.mockRejectedValueOnce(
    new HttpRequestError({
      url: "http://",
      details:
        "eth_getLogs and eth_newFilter are limited to a 10,000 blocks range",
    }),
  );

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
});

test("start() emits sync completed event", async (context) => {
  const { common, syncStore, sources, networks, requestQueues } = context;

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
});

test("start() emits checkpoint and sync completed event if 100% cached", async (context) => {
  const { common, syncStore, sources, networks, requestQueues } = context;

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

  expect(emitSpy).toHaveBeenCalledWith("historicalCheckpoint", {
    blockTimestamp: expect.any(Number),
    chainId: 1,
    blockNumber: expect.any(Number),
  });
  expect(emitSpy).toHaveBeenCalledWith("syncComplete");
  expect(emitSpy).toHaveBeenCalledTimes(2);

  service.kill();
  await service.onIdle();
});

test("start() emits historicalCheckpoint event", async (context) => {
  const { common, syncStore, sources, networks, requestQueues } = context;

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

  expect(emitSpy).toHaveBeenCalledWith("historicalCheckpoint", {
    blockTimestamp: Number(finalizedBlock.timestamp),
    chainId: 1,
    blockNumber: Number(finalizedBlock.number),
  });

  service.kill();
  await service.onIdle();
});
