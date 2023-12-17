import { HttpRequestError, InvalidParamsRpcError } from "viem";
import { beforeEach, expect, test, vi } from "vitest";

import { setupEthClient, setupSyncStore } from "@/_test/setup.js";
import { getEventsErc20, publicClient } from "@/_test/utils.js";
import { maxCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { toLowerCase } from "@/utils/lowercase.js";

import { HistoricalSyncService } from "./service.js";

beforeEach((context) => setupEthClient(context));
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

  await service.kill();
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
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const childAddressLogFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: sources[1].chainId,
    logFilter: {
      address: sources[1].criteria.address,
      topics: [sources[1].criteria.eventSelector, null, null, null],
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

  await service.kill();
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

  await service.kill();
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
  await service.setup(blockNumbers);

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

  await service.kill();
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
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

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

  await service.kill();
});

test("start() with log filter and factory contract updates rpc request duration metrics", async (context) => {
  const { common, syncStore, networks, sources } = context;

  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });
  await service.setup(blockNumbers);
  service.start();

  await service.onIdle();

  const requestsDurationMetric = (
    await common.metrics.ponder_historical_rpc_request_duration.get()
  ).values;

  expect(requestsDurationMetric).toMatchObject(
    expect.arrayContaining([
      expect.objectContaining({
        labels: expect.objectContaining({
          network: "mainnet",
          method: "eth_getLogs",
        }),
      }),
      expect.objectContaining({
        labels: expect.objectContaining({
          network: "mainnet",
          method: "eth_getBlockByNumber",
        }),
      }),
    ]),
  );

  await service.kill();
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
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

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

  await service.kill();
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
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

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

  await service.kill();
});

test("start() retries unexpected error in log filter task", async (context) => {
  const { common, syncStore, networks, sources } = context;

  const network = networks[0];
  const rpcRequestSpy = vi.spyOn(network, "request");

  rpcRequestSpy.mockRejectedValueOnce(new Error("Unexpected error!"));

  const blockNumbers = await getBlockNumbers();

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: network,
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

  await service.kill();
});

test("start() retries unexpected error in block task", async (context) => {
  const { common, syncStore, networks, sources } = context;

  const blockNumbers = await getBlockNumbers();

  const spy = vi.spyOn(syncStore, "insertLogFilterInterval");
  spy.mockRejectedValueOnce(new Error("Unexpected error!"));

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
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

  await service.kill();
});

test("start() handles Alchemy 'Log response size exceeded' error", async (context) => {
  const { common, syncStore, networks, sources } = context;

  const blockNumbers = await getBlockNumbers();

  const network = networks[0];
  const rpcRequestSpy = vi.spyOn(network, "request");

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
    network,
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

  await service.kill();
});

test("start() handles Quicknode 'eth_getLogs and eth_newFilter are limited to a 10,000 blocks range' error", async (context) => {
  const { common, syncStore, networks, sources } = context;

  const blockNumbers = await getBlockNumbers();

  const network = networks[0];
  const rpcRequestSpy = vi.spyOn(network, "request");

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
    network,
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
  expect(rpcRequestSpy).toHaveBeenCalledTimes(5);

  await service.kill();
});

test("start() emits sync completed event", async (context) => {
  const { common, syncStore, sources, networks } = context;

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
    sources: [sources[0]],
  });
  const emitSpy = vi.spyOn(service, "emit");

  await service.setup(await getBlockNumbers());
  service.start();

  await service.onIdle();
  expect(emitSpy).toHaveBeenCalledWith("syncComplete");

  await service.kill();
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

  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();
  await service.kill();

  service = new HistoricalSyncService({
    common,
    syncStore,
    network: networks[0],
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

  await service.kill();
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

  await service.setup(blockNumbers);
  service.start();

  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("historicalCheckpoint", {
    blockTimestamp: Number(finalizedBlock.timestamp),
    chainId: 1,
    blockNumber: Number(finalizedBlock.number),
  });

  await service.kill();
});
