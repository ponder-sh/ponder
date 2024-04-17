import {
  setupAnvil,
  setupContext,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import {
  type Checkpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { type TestContext, beforeEach, expect, test, vi } from "vitest";
import { SyncService } from "./service.js";

beforeEach(setupContext);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

function getMultichainNetworksAndSources(context: TestContext) {
  const mainnet = context.networks[0];
  const optimism = { ...mainnet, name: "optimism", chainId: 10 };

  const sources = [
    context.sources[0],
    {
      ...context.sources[0],
      id: `Erc20_${optimism.name}`,
      networkName: optimism.name,
      chainId: optimism.chainId,
    },
  ];

  return { networks: [mainnet, optimism], sources };
}

function createCheckpoint(checkpoint: Partial<Checkpoint>): Checkpoint {
  return { ...zeroCheckpoint, ...checkpoint };
}

test("handleNewHistoricalCheckpoint emits new checkpoint", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const { networks, sources } = getMultichainNetworksAndSources(context);
  const [mainnet, optimism] = networks;

  const service = new SyncService({ common, syncStore, networks, sources });
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

  expect(emitSpy).toHaveBeenCalledWith("checkpoint", mainnet10);
  expect(emitSpy).toHaveBeenCalledTimes(1);

  await cleanup();
});

test("handleNewHistoricalCheckpoint does not emit new checkpoint if not best", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const { networks, sources } = getMultichainNetworksAndSources(context);
  const [mainnet, optimism] = networks;

  const service = new SyncService({ common, syncStore, networks, sources });
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

  expect(emitSpy).toHaveBeenCalledWith("checkpoint", optimism5);
  expect(emitSpy).toHaveBeenCalledTimes(1);

  await cleanup();
});

test("handleHistoricalSyncComplete sets historicalSyncCompletedAt", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const { networks, sources } = getMultichainNetworksAndSources(context);
  const [mainnet, optimism] = networks;

  const service = new SyncService({ common, syncStore, networks, sources });
  const emitSpy = vi.spyOn(service, "emit");

  const mainnet10 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 10,
  });
  const optimism5 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 5,
  });

  service.handleNewRealtimeCheckpoint(mainnet10);
  service.handleNewRealtimeCheckpoint(optimism5);

  service.handleNewHistoricalCheckpoint(mainnet10);
  service.handleHistoricalSyncComplete({ chainId: mainnet.chainId });

  service.handleNewHistoricalCheckpoint(optimism5); // should emit checkpoint
  service.handleHistoricalSyncComplete({ chainId: optimism.chainId }); // should emit historicalSyncComplete 10

  expect(emitSpy).toHaveBeenCalledWith("checkpoint", optimism5);
  expect(emitSpy).toHaveBeenCalledTimes(1);
  expect(service.isHistoricalSyncComplete).toBe(true);

  await cleanup();
});

test("handleNewHistoricalCheckpoint emits new checkpoint when other chain is completed", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const { networks, sources } = getMultichainNetworksAndSources(context);
  const [mainnet, optimism] = networks;

  const service = new SyncService({ common, syncStore, networks, sources });
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
  service.handleHistoricalSyncComplete({ chainId: mainnet.chainId });
  service.handleNewRealtimeCheckpoint({
    ...maxCheckpoint,
    chainId: mainnet.chainId,
  });

  // Because the mainnet sync is finished, this should advance the checkpoint freely.
  service.handleNewHistoricalCheckpoint(optimism12);

  expect(emitSpy).toHaveBeenCalledWith("checkpoint", optimism12);
  expect(emitSpy).toHaveBeenCalledTimes(1);

  await cleanup();
});

test("handleNewRealtimeCheckpoint does not emit new checkpoint if historical sync is not complete", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const { networks, sources } = getMultichainNetworksAndSources(context);
  const [mainnet, optimism] = networks;

  const service = new SyncService({ common, syncStore, networks, sources });
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
    blockTimestamp: 25,
  });

  service.handleNewHistoricalCheckpoint(optimism12);
  service.handleNewHistoricalCheckpoint(mainnet10);
  service.handleNewRealtimeCheckpoint(mainnet25);

  expect(emitSpy).toHaveBeenCalledWith("checkpoint", mainnet10);
  expect(emitSpy).toHaveBeenCalledTimes(1);

  await cleanup();
});

test("handleNewRealtimeCheckpoint emits new checkpoint if historical sync is complete", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const { networks, sources } = getMultichainNetworksAndSources(context);
  const [mainnet, optimism] = networks;

  const service = new SyncService({ common, syncStore, networks, sources });
  const emitSpy = vi.spyOn(service, "emit");

  const mainnet10 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 10,
  });
  const mainnet20 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 20,
  });
  const mainnet25 = createCheckpoint({
    chainId: mainnet.chainId,
    blockTimestamp: 25,
  });
  const optimism12 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 12,
  });
  const optimism22 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 22,
  });
  const optimism27 = createCheckpoint({
    chainId: optimism.chainId,
    blockTimestamp: 27,
  });

  service.handleNewRealtimeCheckpoint(mainnet20);
  service.handleNewRealtimeCheckpoint(optimism22);

  expect(emitSpy).toHaveBeenCalledTimes(0);

  service.handleNewHistoricalCheckpoint(optimism12);
  service.handleNewHistoricalCheckpoint(mainnet10);

  expect(emitSpy).toHaveBeenCalledWith("checkpoint", mainnet10);
  expect(emitSpy).toHaveBeenCalledTimes(1);

  service.handleHistoricalSyncComplete({ chainId: optimism.chainId });
  service.handleHistoricalSyncComplete({ chainId: mainnet.chainId });

  expect(emitSpy).toHaveBeenCalledWith("checkpoint", mainnet20);
  expect(emitSpy).toHaveBeenCalledTimes(2);

  service.handleNewRealtimeCheckpoint(optimism27);
  service.handleNewRealtimeCheckpoint(mainnet25);

  expect(emitSpy).toHaveBeenCalledWith("checkpoint", mainnet25);
  expect(emitSpy).toHaveBeenCalledTimes(3);

  expect(service.isHistoricalSyncComplete).toBe(true);

  await cleanup();
});

test("handleNewFinalityCheckpoint emits finalityCheckpoint", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const { networks, sources } = getMultichainNetworksAndSources(context);
  const [mainnet, optimism] = networks;

  const service = new SyncService({ common, syncStore, networks, sources });
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

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", optimism12);
  expect(emitSpy).toHaveBeenCalledTimes(1);

  await cleanup();
});

test("handleNewFinalityCheckpoint does not emit finalityCheckpoint if subsequent event is earlier", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const { networks, sources } = getMultichainNetworksAndSources(context);
  const [mainnet, optimism] = networks;

  const service = new SyncService({ common, syncStore, networks, sources });
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

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", optimism12);
  expect(emitSpy).toHaveBeenCalledTimes(1);

  await cleanup();
});

test("handleNewFinalityCheckpoint emits finalityCheckpoint if subsequent event is later", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const { networks, sources } = getMultichainNetworksAndSources(context);
  const [mainnet, optimism] = networks;

  const service = new SyncService({ common, syncStore, networks, sources });
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

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", optimism12);
  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", mainnet15);
  expect(emitSpy).toHaveBeenCalledTimes(2);

  await cleanup();
});
