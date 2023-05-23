import { usdcContractConfig } from "test/utils/constants";
import { publicClient } from "test/utils/utils";
import { expect, test } from "vitest";

import { encodeLogFilterKey } from "@/config/encodeLogFilterKey";
import { LogFilter } from "@/config/logFilters";
import { Network } from "@/config/networks";

import { HistoricalSyncService } from "./service";

const network: Network = {
  name: "mainnet",
  chainId: 1,
  client: publicClient,
  pollingInterval: 1_000,
  defaultMaxBlockRange: 3,
};

const logFilters: LogFilter[] = [
  {
    name: "USDC",
    ...usdcContractConfig,
    network,
    startBlock: 16369950,
    // Note: the service uses the `finalizedBlockNumber` as the end block if undefined.
    endBlock: undefined,
    maxBlockRange: network.defaultMaxBlockRange,
    filter: {
      key: encodeLogFilterKey({
        chainId: network.chainId,
        address: usdcContractConfig.address,
      }),
    },
  },
];

test("setup() calculates cached and total block counts", async (context) => {
  const { store } = context;

  const service = new HistoricalSyncService({ store, logFilters, network });

  await service.setup({ finalizedBlockNumber: 16369955 });

  expect(service.metrics.logFilters["USDC"]).toMatchObject({
    cachedBlockCount: 0,
    totalBlockCount: 6,
  });
});

test("start() runs log tasks and block tasks", async (context) => {
  const { store } = context;

  const service = new HistoricalSyncService({ store, logFilters, network });
  await service.setup({ finalizedBlockNumber: 16369955 });

  service.start();

  await service.onIdle();

  expect(service.metrics.logFilters["USDC"]).toMatchObject({
    blockTaskCompletedCount: 6,
    blockTaskStartedCount: 6,
    logTaskCompletedCount: 2,
    logTaskStartedCount: 2,
  });
});

test("start() adds events to event store", async (context) => {
  const { store } = context;

  const service = new HistoricalSyncService({ store, logFilters, network });
  await service.setup({ finalizedBlockNumber: 16369955 });

  service.start();

  await service.onIdle();

  const logEvents = await store.getLogEvents({
    chainId: network.chainId,
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    address: usdcContractConfig.address,
  });

  expect(logEvents[0].block).toMatchObject({
    hash: "0x0d8710de44b1b42ef86da0e9bebeaacb6d1cb5603f8014dec82e429f0cbf2fe0",
    number: 16369950n,
    timestamp: 1673275799n,
  });

  expect(logEvents[0].transaction).toMatchObject({
    blockHash:
      "0x0d8710de44b1b42ef86da0e9bebeaacb6d1cb5603f8014dec82e429f0cbf2fe0",
    blockNumber: 16369950n,
    hash: "0xc921941ceddbd1341e3899d0b51e4cacbc9675ee07549d12d99ce7caecc6904b",
  });

  expect(logEvents[0].log).toMatchObject({
    address: usdcContractConfig.address,
    blockHash:
      "0x0d8710de44b1b42ef86da0e9bebeaacb6d1cb5603f8014dec82e429f0cbf2fe0",
    blockNumber: 16369950n,
    transactionHash:
      "0xc921941ceddbd1341e3899d0b51e4cacbc9675ee07549d12d99ce7caecc6904b",
  });

  expect(logEvents).toHaveLength(61);
});

test("start() inserts cached ranges", async (context) => {
  const { store } = context;

  const service = new HistoricalSyncService({ store, logFilters, network });
  await service.setup({ finalizedBlockNumber: 16369955 });

  service.start();

  await service.onIdle();

  const logFilterCachedRanges = await store.getLogFilterCachedRanges({
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
