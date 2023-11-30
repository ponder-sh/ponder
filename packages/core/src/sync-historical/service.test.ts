import {
  type EIP1193RequestFn,
  HttpRequestError,
  InvalidParamsRpcError,
} from "viem";
import { rpc } from "viem/utils";
import { beforeEach, expect, test, vi } from "vitest";

import {
  uniswapV3PoolFactoryConfig,
  usdcContractConfig,
} from "@/_test/constants.js";
import { setupSyncStore } from "@/_test/setup.js";
import { publicClient } from "@/_test/utils.js";
import type { Network } from "@/config/networks.js";
import type { Source } from "@/config/sources.js";

import { HistoricalSyncService } from "./service.js";

beforeEach((context) => setupSyncStore(context));

const network: Network = {
  name: "mainnet",
  chainId: 1,
  request: (options) =>
    rpc.http(publicClient.chain.rpcUrls.default.http[0], options),
  url: publicClient.chain.rpcUrls.default.http[0],
  pollingInterval: 1_000,
  defaultMaxBlockRange: 100,
  finalityBlockCount: 10,
  maxRpcRequestConcurrency: 10,
};

const rpcRequestSpy = vi.spyOn(
  network as { request: EIP1193RequestFn },
  "request",
);

const blockNumbers = {
  latestBlockNumber: 16370005,
  finalizedBlockNumber: 16370000,
};

const usdcLogFilter = {
  ...usdcContractConfig,
  id: `USDC_${network.name}`,
  contractName: "USDC",
  networkName: network.name,
  criteria: { address: usdcContractConfig.address },
  startBlock: 16369995, // 5 blocks
  maxBlockRange: 3,
  type: "logFilter",
} satisfies Source;

const uniswapV3Factory = {
  ...uniswapV3PoolFactoryConfig,
  id: `UniswapV3Pool_${network.name}`,
  contractName: "UniswapV3Pool",
  networkName: network.name,
  startBlock: 16369500, // 500 blocks
  type: "factory",
} satisfies Source;

test("start() with log filter inserts log filter interval records", async (context) => {
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

  const logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: network.chainId,
    logFilter: usdcLogFilter.criteria,
  });

  expect(logFilterIntervals).toMatchObject([[16369995, 16370000]]);

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

  const iterator = syncStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    logFilters: [
      {
        id: "USDC",
        chainId: network.chainId,
        criteria: usdcLogFilter.criteria,
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0].block).toMatchObject({
    hash: "0xe16034f7ec28a92cd3ef29401eb0b265767aeb75a335828c1933bfc2d931dd7c",
    number: 16369995n,
    timestamp: 1673276363n,
  });

  expect(events[0].transaction).toMatchObject({
    blockHash:
      "0xe16034f7ec28a92cd3ef29401eb0b265767aeb75a335828c1933bfc2d931dd7c",
    blockNumber: 16369995n,
    hash: "0x30e074523da63f9bdc12907144e01d22f6ef943784854b65b23885f1ca7cd0a5",
  });

  expect(events[0].log).toMatchObject({
    address: usdcContractConfig.address,
    blockHash:
      "0xe16034f7ec28a92cd3ef29401eb0b265767aeb75a335828c1933bfc2d931dd7c",
    blockNumber: 16369995n,
    transactionHash:
      "0x30e074523da63f9bdc12907144e01d22f6ef943784854b65b23885f1ca7cd0a5",
  });

  expect(events[events.length - 1].block).toMatchObject({ number: 16370000n });

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
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
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

test("start() retries unexpected error in log filter task", async (context) => {
  const { common, syncStore } = context;

  rpcRequestSpy.mockRejectedValueOnce(new Error("Unexpected error!"));

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
  const { common, syncStore } = context;

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
  });
  const emitSpy = vi.spyOn(service, "emit");

  await service.setup(blockNumbers);
  service.start();

  await service.onIdle();
  expect(emitSpy).toHaveBeenCalledWith("syncComplete");

  await service.kill();
});

test("start() emits checkpoint and sync completed event if 100% cached", async (context) => {
  const { common, syncStore } = context;

  let service = new HistoricalSyncService({
    common,
    syncStore,
    sources: [usdcLogFilter],
    network,
  });

  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();
  await service.kill();

  service = new HistoricalSyncService({
    common,
    syncStore,
    sources: [usdcLogFilter],
    network,
  });

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("historicalCheckpoint", {
    blockNumber: expect.any(Number),
    blockTimestamp: expect.any(Number),
  });
  expect(emitSpy).toHaveBeenCalledWith("syncComplete");
  expect(emitSpy).toHaveBeenCalledTimes(2);

  await service.kill();
});

test("start() emits historicalCheckpoint event", async (context) => {
  const { common, syncStore } = context;

  const service = new HistoricalSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
  });
  const emitSpy = vi.spyOn(service, "emit");

  await service.setup(blockNumbers);
  service.start();

  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("historicalCheckpoint", {
    blockNumber: 16370000,
    blockTimestamp: 1673276423, // Block timestamp of block 16370000
  });

  await service.kill();
});
