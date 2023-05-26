import { usdcContractConfig } from "test/utils/constants";
import { publicClient } from "test/utils/utils";
import { expect, test, vi } from "vitest";

import { encodeLogFilterKey } from "@/config/logFilterKey";
import { LogFilter } from "@/config/logFilters";
import { Network } from "@/config/networks";

import { EventAggregatorService } from "./service";

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
};

const networks = [mainnet, optimism];

const usdcLogFilter = {
  name: "USDC",
  ...usdcContractConfig,
  network: mainnet,
  filter: {
    key: encodeLogFilterKey({
      chainId: mainnet.chainId,
      address: usdcContractConfig.address,
    }),
    startBlock: 16369950,
    // Note: the service uses the `finalizedBlockNumber` as the end block if undefined.
    endBlock: undefined,
  },
  maxBlockRange: mainnet.defaultMaxBlockRange,
};

const logFilters: LogFilter[] = [
  usdcLogFilter,
  {
    ...usdcLogFilter,
    name: "USDC Optimism",
    network: optimism,
  },
];

test("handleNewHistoricalCheckpoint emits new checkpoint", async (context) => {
  const { store } = context;

  const service = new EventAggregatorService({ store, logFilters, networks });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewHistoricalCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 10,
  });

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { timestamp: 10 });
});

test("handleNewHistoricalCheckpoint does not emit new checkpoint if not best", async (context) => {
  const { store } = context;

  const service = new EventAggregatorService({ store, logFilters, networks });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewHistoricalCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 10,
  });

  service.handleNewHistoricalCheckpoint({
    chainId: optimism.chainId,
    timestamp: 5,
  });

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { timestamp: 10 });
  expect(emitSpy).toHaveBeenCalledTimes(1);
});

test("handleNewRealtimeCheckpoint does not emit new checkpoint if historical sync is not complete", async (context) => {
  const { store } = context;

  const service = new EventAggregatorService({ store, logFilters, networks });
  const emitSpy = vi.spyOn(service, "emit");

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

test("handleNewRealtimeCheckpoint emit new checkpoint if historical sync is complete", async (context) => {
  const { store } = context;

  const service = new EventAggregatorService({ store, logFilters, networks });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewHistoricalCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 10,
  });

  service.handleHistoricalSyncComplete({ chainId: mainnet.chainId });

  service.handleNewRealtimeCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 25,
  });

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { timestamp: 10 });
  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", { timestamp: 25 });
  expect(emitSpy).toHaveBeenCalledTimes(2);
});

test("handleNewFinalityCheckpoint emits newFinalityCheckpoint", async (context) => {
  const { store } = context;

  const service = new EventAggregatorService({ store, logFilters, networks });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewFinalityCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 15,
  });

  expect(emitSpy).toHaveBeenCalledWith("newFinalityCheckpoint", {
    timestamp: 15,
  });
  expect(emitSpy).toHaveBeenCalledTimes(1);
});

test("handleNewFinalityCheckpoint does not emit newFinalityCheckpoint if subsequent event is earlier", async (context) => {
  const { store } = context;

  const service = new EventAggregatorService({ store, logFilters, networks });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewFinalityCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 15,
  });

  service.handleNewFinalityCheckpoint({
    chainId: optimism.chainId,
    timestamp: 14,
  });

  expect(emitSpy).toHaveBeenCalledWith("newFinalityCheckpoint", {
    timestamp: 15,
  });
  expect(emitSpy).toHaveBeenCalledTimes(1);
});

test("handleNewFinalityCheckpoint emits newFinalityCheckpoint if subsequent event is later", async (context) => {
  const { store } = context;

  const service = new EventAggregatorService({ store, logFilters, networks });
  const emitSpy = vi.spyOn(service, "emit");

  service.handleNewFinalityCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 15,
  });

  service.handleNewFinalityCheckpoint({
    chainId: optimism.chainId,
    timestamp: 16,
  });

  expect(emitSpy).toHaveBeenCalledWith("newFinalityCheckpoint", {
    timestamp: 15,
  });
  expect(emitSpy).toHaveBeenCalledWith("newFinalityCheckpoint", {
    timestamp: 16,
  });
  expect(emitSpy).toHaveBeenCalledTimes(2);
});
