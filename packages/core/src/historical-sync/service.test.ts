import {
  type EIP1193RequestFn,
  HttpRequestError,
  InvalidParamsRpcError,
} from "viem";
import { beforeEach, expect, test, vi } from "vitest";

import { usdcContractConfig } from "@/_test/constants.js";
import { setupEventStore } from "@/_test/setup.js";
import { publicClient } from "@/_test/utils.js";
import { encodeLogFilterKey } from "@/config/logFilterKey.js";
import type { LogFilter } from "@/config/logFilters.js";
import type { Network } from "@/config/networks.js";

import { HistoricalSyncService } from "./service.js";

beforeEach((context) => setupEventStore(context));

const network: Network = {
  name: "mainnet",
  chainId: 1,
  client: publicClient,
  pollingInterval: 1_000,
  defaultMaxBlockRange: 3,
  finalityBlockCount: 10,
  maxRpcRequestConcurrency: 10,
};

const rpcRequestSpy = vi.spyOn(
  network.client as { request: EIP1193RequestFn },
  "request"
);

const usdcFilter = {
  key: encodeLogFilterKey({
    chainId: network.chainId,
    address: usdcContractConfig.address,
  }),
  chainId: network.chainId,
  startBlock: 16369950,
};

const logFilters: LogFilter[] = [
  {
    name: "USDC",
    ...usdcContractConfig,
    network: network.name,
    filter: usdcFilter,
  },
];

const blockNumbers = {
  latestBlockNumber: 16369965,
  finalizedBlockNumber: 16369955,
};

test("setup() throws if log filter start block is greater than latest block", async (context) => {
  const { common, eventStore } = context;

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

  await expect(() =>
    service.setup({
      latestBlockNumber: 16369945,
      finalizedBlockNumber: 16369935,
    })
  ).rejects.toThrow(
    /Start block number \(16369950\) cannot be greater than latest block number \(16369945\)/
  );

  await service.kill();
});

test("setup() succeeds if log filter start block is greater than finalized block", async (context) => {
  const { common, eventStore } = context;

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

  await service.setup({
    latestBlockNumber: 16369955,
    finalizedBlockNumber: 16369945,
  });

  const totalBlocksMetric = (
    await common.metrics.ponder_historical_total_blocks.get()
  ).values;
  expect(totalBlocksMetric).toMatchObject([
    { labels: { network: "mainnet", logFilter: "USDC" }, value: 0 },
  ]);

  await service.kill();
});

test("setup() throws if log filter end block is greater than start block", async (context) => {
  const { common, eventStore } = context;

  const logFilters_ = [
    {
      name: "USDC",
      ...usdcContractConfig,
      network: network.name,
      filter: { ...usdcFilter, startBlock: 16369950, endBlock: 16369940 },
    },
  ];

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters: logFilters_,
    network,
  });

  await expect(() => service.setup(blockNumbers)).rejects.toThrow(
    /End block number \(16369940\) cannot be less than start block number \(16369950\)/
  );

  await service.kill();
});

test("setup() throws if log filter end block is greater than latest block", async (context) => {
  const { common, eventStore } = context;

  const logFilters_ = [
    {
      name: "USDC",
      ...usdcContractConfig,
      network: network.name,
      filter: { ...usdcFilter, startBlock: 16369950, endBlock: 16369980 },
    },
  ];

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters: logFilters_,
    network,
  });

  await expect(() =>
    service.setup({
      latestBlockNumber: 16369975,
      finalizedBlockNumber: 16369965,
    })
  ).rejects.toThrow(
    /End block number \(16369980\) cannot be greater than latest block number \(16369975\)/
  );

  await service.kill();
});

test("setup() throws if log filter end block is greater than finalized block", async (context) => {
  const { common, eventStore } = context;

  const logFilters_ = [
    {
      name: "USDC",
      ...usdcContractConfig,
      network: network.name,
      filter: { ...usdcFilter, startBlock: 16369950, endBlock: 16369980 },
    },
  ];

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters: logFilters_,
    network,
  });

  await expect(() =>
    service.setup({
      latestBlockNumber: 16369985,
      finalizedBlockNumber: 16369975,
    })
  ).rejects.toThrow(
    /End block number \(16369980\) cannot be greater than finalized block number \(16369975\)/
  );

  await service.kill();
});

test("setup() updates cached block, total block, and scheduled task metrics", async (context) => {
  const { common, eventStore } = context;

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });
  await service.setup(blockNumbers);

  const cachedBlocksMetric = (
    await common.metrics.ponder_historical_cached_blocks.get()
  ).values;
  expect(cachedBlocksMetric).toMatchObject([
    { labels: { network: "mainnet", logFilter: "USDC" }, value: 0 },
  ]);

  const totalBlocksMetric = (
    await common.metrics.ponder_historical_total_blocks.get()
  ).values;
  expect(totalBlocksMetric).toMatchObject([
    { labels: { network: "mainnet", logFilter: "USDC" }, value: 6 },
  ]);

  const scheduledTaskMetric = (
    await common.metrics.ponder_historical_scheduled_tasks.get()
  ).values;
  expect(scheduledTaskMetric).toMatchObject([
    { labels: { network: "mainnet", kind: "log" }, value: 2 },
  ]);

  await service.kill();
});

test("start() updates completed tasks and completed blocks metrics", async (context) => {
  const { common, eventStore } = context;

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });
  await service.setup(blockNumbers);
  service.start();

  await service.onIdle();

  const completedTasksMetric = (
    await common.metrics.ponder_historical_completed_tasks.get()
  ).values;
  expect(completedTasksMetric).toMatchObject([
    {
      labels: { network: "mainnet", kind: "log", status: "success" },
      value: 2,
    },
    {
      labels: { network: "mainnet", kind: "block", status: "success" },
      value: 6,
    },
  ]);

  const totalBlocksMetric = (
    await common.metrics.ponder_historical_completed_blocks.get()
  ).values;
  expect(totalBlocksMetric).toMatchObject([
    { labels: { network: "mainnet", logFilter: "USDC" }, value: 6 },
  ]);

  await service.kill();
});

test("start() updates rpc request duration metrics", async (context) => {
  const { common, eventStore } = context;

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
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
    ])
  );

  await service.kill();
});

test("start() adds events to event store", async (context) => {
  const { common, eventStore } = context;

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    filters: [
      {
        name: "usdc",
        chainId: network.chainId,
        address: usdcContractConfig.address,
      },
    ],
  });
  const events = [];
  for await (const page of iterator) {
    events.push(...page.events);
  }

  expect(events[0].block).toMatchObject({
    hash: "0x0d8710de44b1b42ef86da0e9bebeaacb6d1cb5603f8014dec82e429f0cbf2fe0",
    number: 16369950n,
    timestamp: 1673275799n,
  });

  expect(events[0].transaction).toMatchObject({
    blockHash:
      "0x0d8710de44b1b42ef86da0e9bebeaacb6d1cb5603f8014dec82e429f0cbf2fe0",
    blockNumber: 16369950n,
    hash: "0xc921941ceddbd1341e3899d0b51e4cacbc9675ee07549d12d99ce7caecc6904b",
  });

  expect(events[0].log).toMatchObject({
    address: usdcContractConfig.address,
    blockHash:
      "0x0d8710de44b1b42ef86da0e9bebeaacb6d1cb5603f8014dec82e429f0cbf2fe0",
    blockNumber: 16369950n,
    transactionHash:
      "0xc921941ceddbd1341e3899d0b51e4cacbc9675ee07549d12d99ce7caecc6904b",
  });

  expect(events).toHaveLength(61);

  await service.kill();
});

test("start() inserts cached ranges", async (context) => {
  const { common, eventStore } = context;

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const logFilterCachedRanges = await eventStore.getLogFilterCachedRanges({
    logFilterKey: logFilters[0].filter.key,
  });

  expect(logFilterCachedRanges[0]).toMatchObject({
    filterKey: '1-"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"-null',
    startBlock: 16369950,
    endBlock: 16369955,
    endBlockTimestamp: 1673275859,
  });
  expect(logFilterCachedRanges).toHaveLength(1);

  await service.kill();
});

test("start() retries errors", async (context) => {
  const { common, eventStore } = context;

  const spy = vi.spyOn(eventStore, "insertHistoricalLogs");
  spy.mockRejectedValueOnce(new Error("Unexpected error!"));

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });
  await service.setup({ ...blockNumbers, finalizedBlockNumber: 16369951 }); // Only process two blocks
  service.start();
  await service.onIdle();

  const logFilterCachedRanges = await eventStore.getLogFilterCachedRanges({
    logFilterKey: logFilters[0].filter.key,
  });
  expect(logFilterCachedRanges[0]).toMatchObject({
    startBlock: 16369950,
    endBlock: 16369951,
  });
  expect(logFilterCachedRanges).toHaveLength(1);

  await service.kill();
});

test("start() updates failed task metrics", async (context) => {
  const { common, eventStore } = context;

  const spy = vi.spyOn(eventStore, "insertHistoricalLogs");
  spy.mockRejectedValueOnce(new Error("Unexpected error!"));

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });
  await service.setup({ ...blockNumbers, finalizedBlockNumber: 16369951 }); // Only process two blocks
  service.start();
  await service.onIdle();

  const completedTasksMetric = (
    await common.metrics.ponder_historical_completed_tasks.get()
  ).values;
  expect(completedTasksMetric).toMatchObject([
    {
      labels: { network: "mainnet", kind: "log", status: "failure" },
      value: 1,
    },
    {
      labels: { network: "mainnet", kind: "log", status: "success" },
      value: 1,
    },
    {
      labels: { network: "mainnet", kind: "block", status: "success" },
      value: 2,
    },
  ]);

  await service.kill();
});

test("start() handles Alchemy 'Log response size exceeded' error", async (context) => {
  const { common, eventStore } = context;

  rpcRequestSpy.mockRejectedValueOnce(
    new InvalidParamsRpcError(
      new Error(
        // The suggested block range is 16369950 to 16369951.
        "Log response size exceeded. this block range should work: [0xf9c91e, 0xf9c91f]"
      )
    )
  );

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const logFilterCachedRanges = await eventStore.getLogFilterCachedRanges({
    logFilterKey: logFilters[0].filter.key,
  });
  expect(logFilterCachedRanges[0]).toMatchObject({
    startBlock: 16369950,
    endBlock: 16369955,
  });
  expect(logFilterCachedRanges).toHaveLength(1);

  await service.kill();
});

test("start() handles Quicknode 'eth_getLogs and eth_newFilter are limited to a 10,000 blocks range' error", async (context) => {
  const { common, eventStore } = context;

  rpcRequestSpy.mockRejectedValueOnce(
    new HttpRequestError({
      url: "http://",
      details:
        "eth_getLogs and eth_newFilter are limited to a 10,000 blocks range",
    })
  );

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });
  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  const logFilterCachedRanges = await eventStore.getLogFilterCachedRanges({
    logFilterKey: logFilters[0].filter.key,
  });
  expect(logFilterCachedRanges[0]).toMatchObject({
    startBlock: 16369950,
    endBlock: 16369955,
  });
  expect(logFilterCachedRanges).toHaveLength(1);

  await service.kill();
});

test("start() emits sync completed event", async (context) => {
  const { common, eventStore } = context;

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });
  const emitSpy = vi.spyOn(service, "emit");

  await service.setup(blockNumbers);
  service.start();

  await service.onIdle();
  expect(emitSpy).toHaveBeenCalledWith("syncComplete");

  await service.kill();
});

test("start() emits checkpoit and sync completed event if 100% cached", async (context) => {
  const { common, eventStore } = context;

  let service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();
  await service.kill();

  service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

  const emitSpy = vi.spyOn(service, "emit");

  await service.setup(blockNumbers);
  service.start();
  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("historicalCheckpoint", {
    timestamp: expect.any(Number),
  });
  expect(emitSpy).toHaveBeenCalledWith("syncComplete");
  expect(emitSpy).toHaveBeenCalledTimes(2);

  await service.kill();
});

test("start() emits historicalCheckpoint event", async (context) => {
  const { common, eventStore } = context;

  const service = new HistoricalSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });
  const emitSpy = vi.spyOn(service, "emit");

  await service.setup(blockNumbers);
  service.start();

  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("historicalCheckpoint", {
    timestamp: 1673275859, // Block timestamp of block 16369955
  });

  await service.kill();
});
