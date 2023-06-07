import { HttpRequestError, InvalidParamsRpcError } from "viem";
import { expect, test, vi } from "vitest";

import { usdcContractConfig } from "@/_test/constants";
import { publicClient } from "@/_test/utils";
import { encodeLogFilterKey } from "@/config/logFilterKey";
import { LogFilter } from "@/config/logFilters";
import { Network } from "@/config/networks";

import { HistoricalSyncService } from "./service";

const network: Network = {
  name: "mainnet",
  chainId: 1,
  client: publicClient,
  pollingInterval: 1_000,
  defaultMaxBlockRange: 3,
  finalityBlockCount: 10,
};

const logFilters: LogFilter[] = [
  {
    name: "USDC",
    ...usdcContractConfig,
    network: network.name,
    filter: {
      key: encodeLogFilterKey({
        chainId: network.chainId,
        address: usdcContractConfig.address,
      }),
      chainId: network.chainId,
      startBlock: 16369950,
      // Note: the service uses the `finalizedBlockNumber` as the end block if undefined.
      endBlock: undefined,
    },
  },
];

test("setup() calculates cached and total block counts", async (context) => {
  const { eventStore } = context;

  const service = new HistoricalSyncService({
    eventStore,
    logFilters,
    network,
  });
  await service.setup({ finalizedBlockNumber: 16369955 });

  expect(service.metrics.logFilters["USDC"]).toMatchObject({
    totalBlockCount: 6,
    cacheRate: 0,
  });
});

test("start() runs log tasks and block tasks", async (context) => {
  const { eventStore } = context;

  const service = new HistoricalSyncService({
    eventStore,
    logFilters,
    network,
  });
  await service.setup({ finalizedBlockNumber: 16369955 });
  service.start();

  await service.onIdle();

  expect(service.metrics.logFilters["USDC"]).toMatchObject({
    blockTaskTotalCount: 6,
    blockTaskCompletedCount: 6,
    logTaskTotalCount: 2,
    logTaskCompletedCount: 2,
  });
});

test("start() adds events to event store", async (context) => {
  const { eventStore } = context;

  const service = new HistoricalSyncService({
    eventStore,
    logFilters,
    network,
  });
  await service.setup({ finalizedBlockNumber: 16369955 });
  service.start();
  await service.onIdle();

  const { events } = await eventStore.getLogEvents({
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
});

test("start() inserts cached ranges", async (context) => {
  const { eventStore } = context;

  const service = new HistoricalSyncService({
    eventStore,
    logFilters,
    network,
  });
  await service.setup({ finalizedBlockNumber: 16369955 });
  service.start();
  await service.onIdle();

  const logFilterCachedRanges = await eventStore.getLogFilterCachedRanges({
    filterKey: logFilters[0].filter.key,
  });

  expect(logFilterCachedRanges[0]).toMatchObject({
    filterKey: '1-"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"-null',
    startBlock: 16369950n,
    endBlock: 16369955n,
    endBlockTimestamp: 1673275859n,
  });
  expect(logFilterCachedRanges).toHaveLength(1);
});

test("start() retries errors", async (context) => {
  const { eventStore } = context;

  const spy = vi.spyOn(eventStore, "insertFinalizedLogs");
  spy.mockRejectedValueOnce(new Error("Unexpected error!"));

  const service = new HistoricalSyncService({
    eventStore,
    logFilters,
    network,
  });
  await service.setup({ finalizedBlockNumber: 16369950 }); // One block
  service.start();
  await service.onIdle();

  expect(service.metrics.logFilters["USDC"]).toMatchObject({
    logTaskTotalCount: 2,
    logTaskErrorCount: 1,
    logTaskCompletedCount: 1,
  });

  const logFilterCachedRanges = await eventStore.getLogFilterCachedRanges({
    filterKey: logFilters[0].filter.key,
  });
  expect(logFilterCachedRanges[0]).toMatchObject({
    startBlock: 16369950n,
    endBlock: 16369950n,
  });
  expect(logFilterCachedRanges).toHaveLength(1);
});

test("start() handles Alchemy 'Log response size exceeded' error", async (context) => {
  const { eventStore } = context;

  const spy = vi.spyOn(network.client, "request");
  spy.mockRejectedValueOnce(
    new InvalidParamsRpcError(
      new Error(
        // The suggested block range is 16369950 to 16369951.
        "Log response size exceeded. this block range should work: [0xf9c91e, 0xf9c91f]"
      )
    )
  );

  const service = new HistoricalSyncService({
    eventStore,
    logFilters,
    network,
  });
  await service.setup({ finalizedBlockNumber: 16369955 });
  service.start();
  await service.onIdle();

  expect(service.metrics.logFilters["USDC"]).toMatchObject({
    logTaskTotalCount: 4,
    logTaskErrorCount: 1,
    logTaskCompletedCount: 3,
  });

  const logFilterCachedRanges = await eventStore.getLogFilterCachedRanges({
    filterKey: logFilters[0].filter.key,
  });
  expect(logFilterCachedRanges[0]).toMatchObject({
    startBlock: 16369950n,
    endBlock: 16369955n,
  });
  expect(logFilterCachedRanges).toHaveLength(1);
});

test("start() handles Quicknode 'eth_getLogs and eth_newFilter are limited to a 10,000 blocks range' error", async (context) => {
  const { eventStore } = context;

  const spy = vi.spyOn(network.client, "request");
  spy.mockRejectedValueOnce(
    new HttpRequestError({
      url: "http://",
      details:
        "eth_getLogs and eth_newFilter are limited to a 10,000 blocks range",
    })
  );

  const service = new HistoricalSyncService({
    eventStore,
    logFilters,
    network,
  });
  await service.setup({ finalizedBlockNumber: 16369955 });
  service.start();
  await service.onIdle();

  expect(service.metrics.logFilters["USDC"]).toMatchObject({
    logTaskTotalCount: 4,
    logTaskErrorCount: 1,
    logTaskCompletedCount: 3,
  });

  const logFilterCachedRanges = await eventStore.getLogFilterCachedRanges({
    filterKey: logFilters[0].filter.key,
  });
  expect(logFilterCachedRanges[0]).toMatchObject({
    startBlock: 16369950n,
    endBlock: 16369955n,
  });
  expect(logFilterCachedRanges).toHaveLength(1);
});

test("start() emits sync started and completed events", async (context) => {
  const { eventStore } = context;

  const service = new HistoricalSyncService({
    eventStore,
    logFilters,
    network,
  });
  const emitSpy = vi.spyOn(service, "emit");

  await service.setup({ finalizedBlockNumber: 16369955 });
  service.start();

  expect(emitSpy).toHaveBeenCalledWith("syncStarted");

  await service.onIdle();
  expect(emitSpy).toHaveBeenCalledWith("syncComplete");
});

test("start() emits historicalCheckpoint event", async (context) => {
  const { eventStore } = context;

  const service = new HistoricalSyncService({
    eventStore,
    logFilters,
    network,
  });
  const emitSpy = vi.spyOn(service, "emit");

  await service.setup({ finalizedBlockNumber: 16369955 });
  service.start();

  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("historicalCheckpoint", {
    timestamp: 1673275859, // Block timestamp of block 16369955
  });
});
