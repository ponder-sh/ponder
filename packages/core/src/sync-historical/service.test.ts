import { HttpRequestError, InvalidParamsRpcError } from "viem";
import { beforeEach, expect, test, vi } from "vitest";

import { setupEthClient, setupSyncStore } from "@/_test/setup.js";
import { getEvents, publicClient } from "@/_test/utils.js";
import { maxCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";

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
  const { common, syncStore } = context;

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network,
    sources: [uniswapV3Factory],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const childAddressLogFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: network.chainId,
    logFilter: {
      address: uniswapV3Factory.criteria.address,
      topics: [uniswapV3Factory.criteria.eventSelector, null, null, null],
    },
  });

  expect(childAddressLogFilterIntervals).toMatchObject([[16369500, 16370000]]);

  const childContractIntervals = await syncStore.getFactoryLogFilterIntervals({
    chainId: uniswapV3Factory.chainId,
    factory: uniswapV3Factory.criteria,
  });
  expect(childContractIntervals).toMatchObject([[16369500, 16370000]]);

  await service.kill();
});

test("start() with factory contract inserts child contract addresses", async (context) => {
  const { common, syncStore } = context;

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network,
    sources: [uniswapV3Factory],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const iterator = syncStore.getFactoryChildAddresses({
    chainId: uniswapV3Factory.chainId,
    factory: uniswapV3Factory.criteria,
    upToBlockNumber: 16370000n,
  });

  const childContractAddresses = [];
  for await (const page of iterator) childContractAddresses.push(...page);

  expect(childContractAddresses).toMatchObject(
    expect.arrayContaining([
      "0x6e4c301b43b5d6fc47ceac2fb9b6b3209e640eab",
      "0x8d92afe4ab7f4d0379d37a6da3643763964cb6df",
      "0x01b2848a0d9ffced595b0df3df10fb32430fa200",
      "0xd5f83865bf8edb1f02e688dc2ee02d39e28692b3",
    ]),
  );

  await service.kill();
});

test("setup() with log filter and factory contract updates block metrics", async (context) => {
  const { common, syncStore } = context;

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter, uniswapV3Factory],
  });
  await service.setup(blockNumbers);

  const cachedBlocksMetric = (
    await common.metrics.ponder_historical_cached_blocks.get()
  ).values;
  expect(cachedBlocksMetric).toMatchObject([
    { labels: { network: "mainnet", contract: "USDC" }, value: 0 },
    {
      labels: {
        network: "mainnet",
        contract: "UniswapV3Pool_factory",
      },
      value: 0,
    },
    {
      labels: { network: "mainnet", contract: "UniswapV3Pool" },
      value: 0,
    },
  ]);

  const totalBlocksMetric = (
    await common.metrics.ponder_historical_total_blocks.get()
  ).values;
  expect(totalBlocksMetric).toMatchObject([
    { labels: { network: "mainnet", contract: "USDC" }, value: 6 },
    {
      labels: {
        network: "mainnet",
        contract: "UniswapV3Pool_factory",
      },
      value: 501,
    },
    {
      labels: { network: "mainnet", contract: "UniswapV3Pool" },
      value: 501,
    },
  ]);

  await service.kill();
});

test("start() with log filter and factory contract updates completed blocks metrics", async (context) => {
  const { common, syncStore } = context;

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter, uniswapV3Factory],
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
        contract: "UniswapV3Pool_factory",
      },
      value: 501,
    },
    {
      labels: { network: "mainnet", contract: "UniswapV3Pool" },
      value: 501,
    },
    { labels: { network: "mainnet", contract: "USDC" }, value: 6 },
  ]);

  await service.kill();
});

test("start() with log filter and factory contract updates rpc request duration metrics", async (context) => {
  const { common, syncStore } = context;

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
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

  expect(await getEvents(sources).then((e) => [e[0], e[1]])).toMatchObject(
    events,
  );

  await service.kill();
});

test("start() adds log filter and factory contract events to sync store", async (context) => {
  const { common, syncStore } = context;

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter, uniswapV3Factory],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const iterator = syncStore.getLogEvents({
    fromCheckpoint: zeroCheckpoint,
    toCheckpoint: maxCheckpoint,
    logFilters: [
      {
        id: "USDC",
        chainId: network.chainId,
        criteria: usdcLogFilter.criteria,
      },
    ],
    factories: [
      {
        id: "UniswapV3Pool",
        chainId: network.chainId,
        criteria: uniswapV3Factory.criteria,
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  const sourceIds = events.map((event) => event.sourceId);

  expect(sourceIds.includes("USDC")).toBe(true);
  expect(sourceIds.includes("UniswapV3Pool")).toBe(true);

  await service.kill();
});

test.todo(
  "start() retries unexpected error in log filter task",
  async (context) => {
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
    expect(rpcRequestSpy).toHaveBeenCalledTimes(2);

    await service.kill();
  },
);

test("start() retries unexpected error in block task", async (context) => {
  const { common, syncStore } = context;

  const spy = vi.spyOn(syncStore, "insertLogFilterInterval");
  spy.mockRejectedValueOnce(new Error("Unexpected error!"));

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: network.chainId,
    logFilter: usdcLogFilter.criteria,
  });

  expect(logFilterIntervals).toMatchObject([[16369995, 16370000]]);

  await service.kill();
});

test("start() handles Alchemy 'Log response size exceeded' error", async (context) => {
  const { common, syncStore } = context;

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
    sources: [usdcLogFilter],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: network.chainId,
    logFilter: usdcLogFilter.criteria,
  });
  expect(logFilterIntervals).toMatchObject([[16369995, 16370000]]);

  await service.kill();
});

test("start() handles Quicknode 'eth_getLogs and eth_newFilter are limited to a 10,000 blocks range' error", async (context) => {
  const { common, syncStore } = context;

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
    sources: [usdcLogFilter],
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: network.chainId,
    logFilter: usdcLogFilter.criteria,
  });
  expect(logFilterIntervals).toMatchObject([[16369995, 16370000]]);

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
