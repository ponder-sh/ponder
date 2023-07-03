import { beforeEach, expect, test, vi } from "vitest";

import { usdcContractConfig } from "@/_test/constants";
import { setupEventStore } from "@/_test/setup";
import { publicClient } from "@/_test/utils";
import { encodeLogFilterKey } from "@/config/logFilterKey";
import { LogFilter } from "@/config/logFilters";
import { Network } from "@/config/networks";

import { EventAggregatorService } from "./service";

beforeEach((context) => setupEventStore(context));

const mainnet: Network = {
  name: "mainnet",
  chainId: 1,
  client: publicClient,
  pollingInterval: 1_000,
  defaultMaxBlockRange: 3,
  finalityBlockCount: 10,
};

const optimism: Network = {
  ...mainnet,
  name: "optimism",
  chainId: 10,
};

const networks = [mainnet, optimism];

const usdcLogFilter = {
  name: "USDC",
  ...usdcContractConfig,
  network: mainnet.name,
  filter: {
    key: encodeLogFilterKey({
      chainId: mainnet.chainId,
      address: usdcContractConfig.address,
    }),
    chainId: mainnet.chainId,
    startBlock: 16369950,
    // Note: the service uses the `finalizedBlockNumber` as the end block if undefined.
    endBlock: undefined,
  },
};

const logFilters: LogFilter[] = [
  usdcLogFilter,
  {
    ...usdcLogFilter,
    name: "USDC Optimism",
    network: optimism.name,
    filter: {
      ...usdcLogFilter.filter,
      chainId: optimism.chainId,
    },
  },
];

test("handleNewHistoricalCheckpoint emits new checkpoint", async (context) => {
  const { eventStore } = context;

  const service = new EventAggregatorService({
    eventStore,
    logFilters,
    networks,
  });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewHistoricalCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 10,
  });
  service.handleNewHistoricalCheckpoint({
    chainId: optimism.chainId,
    timestamp: 12,
  });

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { timestamp: 10 });
});

test("handleNewHistoricalCheckpoint does not emit new checkpoint if not best", async (context) => {
  const { eventStore } = context;

  const service = new EventAggregatorService({
    eventStore,
    logFilters,
    networks,
  });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewHistoricalCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 10,
  });

  service.handleNewHistoricalCheckpoint({
    chainId: optimism.chainId,
    timestamp: 5,
  });

  service.handleNewHistoricalCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 15,
  });

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { timestamp: 5 });
  expect(emitSpy).toHaveBeenCalledTimes(1);
});

test("handleHistoricalSyncComplete sets historicalSyncCompletedAt if final historical sync is complete", async (context) => {
  const { eventStore } = context;

  const service = new EventAggregatorService({
    eventStore,
    logFilters,
    networks,
  });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewHistoricalCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 10,
  });
  service.handleHistoricalSyncComplete({ chainId: mainnet.chainId });

  service.handleNewHistoricalCheckpoint({
    chainId: optimism.chainId,
    timestamp: 5,
  }); // emits newCheckpoint 5
  service.handleHistoricalSyncComplete({ chainId: optimism.chainId }); // emits historicalSyncComplete 10

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { timestamp: 5 });
  expect(emitSpy).toHaveBeenCalledTimes(1);
  expect(service.historicalSyncCompletedAt).toBe(10);
});

test("handleNewRealtimeCheckpoint does not emit new checkpoint if historical sync is not complete", async (context) => {
  const { eventStore } = context;

  const service = new EventAggregatorService({
    eventStore,
    logFilters,
    networks,
  });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewHistoricalCheckpoint({
    chainId: optimism.chainId,
    timestamp: 12,
  });
  service.handleNewHistoricalCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 10,
  });

  service.handleNewRealtimeCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 25,
  });

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { timestamp: 10 });
  expect(emitSpy).toHaveBeenCalledTimes(1);
});

test("handleNewRealtimeCheckpoint emits new checkpoint if historical sync is complete", async (context) => {
  const { eventStore } = context;

  const service = new EventAggregatorService({
    eventStore,
    logFilters,
    networks,
  });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewHistoricalCheckpoint({
    chainId: optimism.chainId,
    timestamp: 12,
  });
  service.handleHistoricalSyncComplete({ chainId: optimism.chainId });

  service.handleNewHistoricalCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 10,
  });
  service.handleHistoricalSyncComplete({ chainId: mainnet.chainId });

  service.handleNewRealtimeCheckpoint({
    chainId: optimism.chainId,
    timestamp: 27,
  });
  service.handleNewRealtimeCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 25,
  });

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { timestamp: 10 });
  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { timestamp: 25 });
  expect(emitSpy).toHaveBeenCalledTimes(2);
  expect(service.historicalSyncCompletedAt).toBe(12);
});

test("handleNewFinalityCheckpoint emits newFinalityCheckpoint", async (context) => {
  const { eventStore } = context;

  const service = new EventAggregatorService({
    eventStore,
    logFilters,
    networks,
  });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewFinalityCheckpoint({
    chainId: optimism.chainId,
    timestamp: 12,
  });
  service.handleNewFinalityCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 15,
  });

  expect(emitSpy).toHaveBeenCalledWith("newFinalityCheckpoint", {
    timestamp: 12,
  });
  expect(emitSpy).toHaveBeenCalledTimes(1);
});

test("handleNewFinalityCheckpoint does not emit newFinalityCheckpoint if subsequent event is earlier", async (context) => {
  const { eventStore } = context;

  const service = new EventAggregatorService({
    eventStore,
    logFilters,
    networks,
  });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewFinalityCheckpoint({
    chainId: optimism.chainId,
    timestamp: 12,
  });
  service.handleNewFinalityCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 15,
  });
  service.handleNewFinalityCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 19,
  });

  expect(emitSpy).toHaveBeenCalledWith("newFinalityCheckpoint", {
    timestamp: 12,
  });
  expect(emitSpy).toHaveBeenCalledTimes(1);
});

test("handleNewFinalityCheckpoint emits newFinalityCheckpoint if subsequent event is later", async (context) => {
  const { eventStore } = context;

  const service = new EventAggregatorService({
    eventStore,
    logFilters,
    networks,
  });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewFinalityCheckpoint({
    chainId: optimism.chainId,
    timestamp: 12,
  });
  service.handleNewFinalityCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 15,
  });

  service.handleNewFinalityCheckpoint({
    chainId: optimism.chainId,
    timestamp: 16,
  });

  expect(emitSpy).toHaveBeenCalledWith("newFinalityCheckpoint", {
    timestamp: 12,
  });
  expect(emitSpy).toHaveBeenCalledWith("newFinalityCheckpoint", {
    timestamp: 15,
  });
  expect(emitSpy).toHaveBeenCalledTimes(2);
});
