import { rpc } from "viem/utils";
import { beforeEach, expect, test, vi } from "vitest";

import { usdcContractConfig } from "@/_test/constants.js";
import { setupSyncStore } from "@/_test/setup.js";
import { publicClient } from "@/_test/utils.js";
import type { Network } from "@/config/networks.js";
import type { Source } from "@/config/sources.js";

import { SyncGateway } from "./service.js";

beforeEach((context) => setupSyncStore(context));

const mainnet: Network = {
  name: "mainnet",
  chainId: 1,
  request: (options) =>
    rpc.http(publicClient.chain.rpcUrls.default.http[0], options),
  url: publicClient.chain.rpcUrls.default.http[0],
  pollingInterval: 1_000,
  defaultMaxBlockRange: 3,
  finalityBlockCount: 10,
  maxRpcRequestConcurrency: 10,
};

const optimism: Network = {
  ...mainnet,
  name: "optimism",
  chainId: 10,
} as const;

const networks = [mainnet, optimism];

const usdcLogFilter = {
  ...usdcContractConfig,
  id: `USDC_${mainnet.name}`,
  contractName: "USDC",
  networkName: mainnet.name,
  criteria: { address: usdcContractConfig.address },
  startBlock: 16369950,
  type: "logFilter",
} as const;

const sources: Source[] = [
  usdcLogFilter,
  {
    ...usdcLogFilter,
    id: `USDC_${optimism.name}`,
    contractName: "USDC",
    networkName: optimism.name,
    chainId: optimism.chainId,
  },
];

test("handleNewHistoricalCheckpoint emits new checkpoint", async (context) => {
  const { common, syncStore } = context;

  const service = new SyncGateway({
    common,
    syncStore,
    networks,
    sources,
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
  const { common, syncStore } = context;

  const service = new SyncGateway({
    common,
    syncStore,
    sources,
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
  const { common, syncStore } = context;

  const service = new SyncGateway({
    common,
    syncStore,
    sources,
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
  const { common, syncStore } = context;

  const service = new SyncGateway({
    common,
    syncStore,
    sources,
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
  const { common, syncStore } = context;

  const service = new SyncGateway({
    common,
    syncStore,
    sources,
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
  const { common, syncStore } = context;

  const service = new SyncGateway({
    common,
    syncStore,
    sources,
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
  const { common, syncStore } = context;

  const service = new SyncGateway({
    common,
    syncStore,
    sources,
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
  const { common, syncStore } = context;

  const service = new SyncGateway({
    common,
    syncStore,
    sources,
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

test("resetCheckpoints resets the checkpoint states", async (context) => {
  const { common, syncStore } = context;

  const service = new SyncGateway({
    common,
    syncStore,
    sources,
    networks,
  });

  // Sets a historical checkpoint, realtime checkpoint, and sets the historical sync complete for mainnet.
  service.handleNewRealtimeCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 2,
  });

  service.handleNewHistoricalCheckpoint({
    chainId: mainnet.chainId,
    timestamp: 3,
  });

  service.handleHistoricalSyncComplete({ chainId: mainnet.chainId });

  // Sets checkpoints for optimism to assert it has not changed.
  service.handleNewRealtimeCheckpoint({
    chainId: optimism.chainId,
    timestamp: 4,
  });

  service.handleNewHistoricalCheckpoint({
    chainId: optimism.chainId,
    timestamp: 5,
  });

  service.handleHistoricalSyncComplete({ chainId: optimism.chainId });

  expect(service.checkpoint).toBe(3);
  expect(service.historicalSyncCompletedAt).toBe(5);

  service.resetCheckpoints({ chainId: mainnet.chainId });

  // Global checkpoints should be reset to 0.
  expect(service.checkpoint).toBe(0);
  expect(service.finalityCheckpoint).toBe(0);
  expect(service.historicalSyncCompletedAt).toBe(0);
});
