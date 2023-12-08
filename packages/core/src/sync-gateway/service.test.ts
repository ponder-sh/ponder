import { rpc } from "viem/utils";
import { beforeEach, expect, test, vi } from "vitest";

import { usdcContractConfig } from "@/_test/constants.js";
import { setupSyncStore } from "@/_test/setup.js";
import { publicClient } from "@/_test/utils.js";
import type { Network } from "@/config/networks.js";
import type { Source } from "@/config/sources.js";
import { type Checkpoint, zeroCheckpoint } from "@/utils/checkpoint.js";

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
  maxHistoricalTaskConcurrency: 20,
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

function createCheckpoint(checkpoint: Partial<Checkpoint>): Checkpoint {
  return { ...zeroCheckpoint, ...checkpoint };
}

test("handleNewHistoricalCheckpoint emits new checkpoint", async (context) => {
  const { common, syncStore } = context;

  const service = new SyncGateway({
    common,
    syncStore,
    networks,
    sources,
  });
  const emitSpy = vi.spyOn(service, "emit");

  const mainnet10 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 10,
  });
  const optimism12 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 12,
  });
  service.handleNewHistoricalCheckpoint(mainnet10);
  service.handleNewHistoricalCheckpoint(optimism12);

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", mainnet10);
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

  const mainnet10 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 10,
  });
  const optimism5 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 5,
  });
  const mainnet15 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 15,
  });

  service.handleNewHistoricalCheckpoint(mainnet10);
  service.handleNewHistoricalCheckpoint(optimism5);
  service.handleNewHistoricalCheckpoint(mainnet15);

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", optimism5);
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

  const mainnet10 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 10,
  });
  const optimism5 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 5,
  });

  service.handleNewHistoricalCheckpoint(mainnet10);
  service.handleHistoricalSyncComplete({ chainId: mainnet.chainId });

  service.handleNewHistoricalCheckpoint(optimism5); // should emit newCheckpoint
  service.handleHistoricalSyncComplete({ chainId: optimism.chainId }); // should emit historicalSyncComplete 10

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", optimism5);
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

  const mainnet10 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 10,
  });
  const optimism12 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 12,
  });
  const mainnet25 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 10,
  });

  service.handleNewHistoricalCheckpoint(optimism12);
  service.handleNewHistoricalCheckpoint(mainnet10);
  service.handleNewRealtimeCheckpoint(mainnet25);

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", mainnet10);
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

  const mainnet10 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 10,
  });
  const mainnet25 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 25,
  });
  const optimism12 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 12,
  });
  const optimism27 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 27,
  });

  service.handleNewHistoricalCheckpoint(optimism12);
  service.handleHistoricalSyncComplete({ chainId: optimism.chainId });

  service.handleNewHistoricalCheckpoint(mainnet10);
  service.handleHistoricalSyncComplete({ chainId: mainnet.chainId });

  service.handleNewRealtimeCheckpoint(optimism27);
  service.handleNewRealtimeCheckpoint(mainnet25);

  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", mainnet10);
  expect(emitSpy).toHaveBeenCalledWith("newCheckpoint", mainnet25);
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

  const mainnet15 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 15,
  });
  const optimism12 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 12,
  });

  service.handleNewFinalityCheckpoint(optimism12);
  service.handleNewFinalityCheckpoint(mainnet15);

  expect(emitSpy).toHaveBeenCalledWith("newFinalityCheckpoint", optimism12);
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

  const mainnet15 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 15,
  });
  const mainnet19 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 19,
  });
  const optimism12 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 12,
  });

  service.handleNewFinalityCheckpoint(optimism12);
  service.handleNewFinalityCheckpoint(mainnet15);
  service.handleNewFinalityCheckpoint(mainnet19);

  expect(emitSpy).toHaveBeenCalledWith("newFinalityCheckpoint", optimism12);
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

  const mainnet15 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 15,
  });
  const optimism12 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 12,
  });
  const optimism16 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 16,
  });

  service.handleNewFinalityCheckpoint(optimism12);
  service.handleNewFinalityCheckpoint(mainnet15);
  service.handleNewFinalityCheckpoint(optimism16);

  expect(emitSpy).toHaveBeenCalledWith("newFinalityCheckpoint", optimism12);
  expect(emitSpy).toHaveBeenCalledWith("newFinalityCheckpoint", mainnet15);
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

  const mainnet2 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 2,
  });
  const mainnet3 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 3,
  });
  const optimism4 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 4,
  });
  const optimism5 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 5,
  });

  service.handleNewRealtimeCheckpoint(mainnet2);
  service.handleNewHistoricalCheckpoint(mainnet3);
  service.handleHistoricalSyncComplete({ chainId: mainnet.chainId });

  service.handleNewRealtimeCheckpoint(optimism5);
  service.handleNewHistoricalCheckpoint(optimism4);
  service.handleHistoricalSyncComplete({ chainId: optimism.chainId });

  expect(service.checkpoint).toBe(mainnet3);
  expect(service.historicalSyncCompletedAt).toBe(4);

  service.resetCheckpoints({ chainId: mainnet.chainId });

  expect(service.checkpoint).toBe(zeroCheckpoint);
  expect(service.finalityCheckpoint).toBe(zeroCheckpoint);
  expect(service.historicalSyncCompletedAt).toBe(0);
});
