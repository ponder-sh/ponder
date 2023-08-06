import { beforeEach, expect, test, vi } from "vitest";

import { usdcContractConfig } from "@/_test/constants";
import { setupEventStore } from "@/_test/setup";
import { publicClient } from "@/_test/utils";
import { encodeLogFilterKey } from "@/config/logFilterKey";
import type { Network } from "@/config/network";

import { EventAggregatorService } from "./service";

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

const usdcLogFilter = {
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
};

const logFilters = [usdcLogFilter];

test("handleNewHistoricalCheckpoint emits new checkpoint", async (context) => {
  const { common, eventStore } = context;

  const service = new EventAggregatorService({
    common,
    eventStore,
    network,
    logFilters,
  });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewHistoricalCheckpoint({ blockNumber: 10 });
  service.handleNewHistoricalCheckpoint({ blockNumber: 12 });

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { blockNumber: 10 });
  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { blockNumber: 12 });
});

test("handleNewHistoricalCheckpoint does not emit new checkpoint if not best", async (context) => {
  const { common, eventStore } = context;

  const service = new EventAggregatorService({
    common,
    eventStore,
    network,
    logFilters,
  });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewHistoricalCheckpoint({ blockNumber: 10 });
  service.handleNewHistoricalCheckpoint({ blockNumber: 5 });

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { blockNumber: 10 });
  expect(emitSpy).toHaveBeenCalledTimes(1);
});

test("handleHistoricalSyncComplete sets isHistoricalSyncComplete", async (context) => {
  const { common, eventStore } = context;

  const service = new EventAggregatorService({
    common,
    eventStore,
    network,
    logFilters,
  });

  service.handleNewHistoricalCheckpoint({ blockNumber: 10 });
  service.handleHistoricalSyncComplete();

  expect(service.isHistoricalSyncComplete).toBe(true);
});

test("handleNewRealtimeCheckpoint does not emit new checkpoint if historical sync is not complete", async (context) => {
  const { common, eventStore } = context;

  const service = new EventAggregatorService({
    common,
    eventStore,
    network,
    logFilters,
  });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewHistoricalCheckpoint({ blockNumber: 10 });
  service.handleNewRealtimeCheckpoint({ blockNumber: 25 });

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { blockNumber: 10 });
  expect(emitSpy).toHaveBeenCalledTimes(1);
});

test("handleNewRealtimeCheckpoint emits new checkpoint if historical sync is complete", async (context) => {
  const { common, eventStore } = context;

  const service = new EventAggregatorService({
    common,
    eventStore,
    network,
    logFilters,
  });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewHistoricalCheckpoint({ blockNumber: 10 });
  service.handleHistoricalSyncComplete();

  service.handleNewRealtimeCheckpoint({ blockNumber: 25 });

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { blockNumber: 10 });
  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { blockNumber: 25 });
  expect(emitSpy).toHaveBeenCalledTimes(2);
  expect(service.isHistoricalSyncComplete).toBe(true);
});

test("handleNewFinalityCheckpoint emits newFinalityCheckpoint", async (context) => {
  const { common, eventStore } = context;

  const service = new EventAggregatorService({
    common,
    eventStore,
    network,
    logFilters,
  });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewFinalityCheckpoint({ blockNumber: 15 });
  service.handleNewFinalityCheckpoint({ blockNumber: 30 });

  expect(emitSpy).toHaveBeenCalledWith("newFinalityCheckpoint", {
    blockNumber: 15,
  });
  expect(emitSpy).toHaveBeenCalledWith("newFinalityCheckpoint", {
    blockNumber: 30,
  });
  expect(emitSpy).toHaveBeenCalledTimes(2);
});
