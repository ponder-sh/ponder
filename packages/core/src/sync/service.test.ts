import {
  setupAnvil,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { drainAsyncGenerator } from "@/_test/utils.js";
import { type Checkpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { type TestContext, beforeEach, expect, test, vi } from "vitest";
import {
  createSyncService,
  getHistoricalEvents,
  startRealtimeSyncServices,
} from "./service.js";

beforeEach((context) => setupAnvil(context));
beforeEach((context) => setupIsolatedDatabase(context));

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

test("createSyncService()", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  expect(syncService.checkpoint).toStrictEqual(zeroCheckpoint);
  expect(syncService.networkServices).toHaveLength(2);

  expect(syncService.networkServices[0].realtime.finalizedBlock.number).toBe(
    "0x0",
  );
  expect(syncService.networkServices[1].realtime.finalizedBlock.number).toBe(
    "0x0",
  );

  expect(
    syncService.networkServices[0].historical.isHistoricalSyncComplete,
  ).toBe(false);
  expect(
    syncService.networkServices[1].historical.isHistoricalSyncComplete,
  ).toBe(false);

  expect(syncService.networkServices[0].historical.checkpoint).toBe(undefined);
  expect(syncService.networkServices[1].historical.checkpoint).toBe(undefined);
  await cleanup();
});

test.todo("kill()");

test("getHistoricalEvents returns events", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const getLogEventsSpy = vi.spyOn(syncStore, "getLogEvents");

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const ag = getHistoricalEvents(syncService);

  syncService.networkServices[0].historical.checkpoint = createCheckpoint({
    blockNumber: 1,
  });
  syncService.networkServices[1].historical.checkpoint = createCheckpoint({
    blockNumber: 1,
  });

  const iter1 = await ag.next();
  expect(iter1.done).toBe(false);

  syncService.networkServices[0].historical.isHistoricalSyncComplete = true;
  syncService.networkServices[1].historical.isHistoricalSyncComplete = true;

  const iter2 = await ag.next();
  expect(iter2.done).toBe(false);

  const iter3 = await ag.next();
  expect(iter3.done).toBe(true);

  expect(getLogEventsSpy).toHaveBeenCalledTimes(2);

  await cleanup();
});

test("getHistoricalEvents resolves when complete", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const getLogEventsSpy = vi.spyOn(syncStore, "getLogEvents");

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  syncService.networkServices[0].historical.isHistoricalSyncComplete = true;
  syncService.networkServices[1].historical.isHistoricalSyncComplete = true;

  const ag = getHistoricalEvents(syncService);
  await drainAsyncGenerator(ag);

  expect(getLogEventsSpy).toHaveBeenCalledTimes(1);

  expect(syncService.checkpoint.blockNumber).toBe(0);

  await cleanup();
});

test("getHistoricalEvents waits until all networks have checkpoint", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const getLogEventsSpy = vi.spyOn(syncStore, "getLogEvents");

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const ag = getHistoricalEvents(syncService);

  const iter1 = await ag.next();
  expect(iter1.done).toBe(false);

  syncService.networkServices[0].historical.isHistoricalSyncComplete = true;
  syncService.networkServices[1].historical.isHistoricalSyncComplete = true;

  await drainAsyncGenerator(ag);

  expect(getLogEventsSpy).toHaveBeenCalledTimes(1);

  await cleanup();
});

test.todo("startRealtime checks end block", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  startRealtimeSyncServices(syncService);

  await cleanup();
});

test("onRealtimeSyncEvent gets events", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const getLogEventsSpy = vi.spyOn(syncStore, "getLogEvents");

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  syncService.networkServices[0].realtime.checkpoint = zeroCheckpoint;
  syncService.networkServices[1].realtime.checkpoint = zeroCheckpoint;

  await syncService.networkServices[0].realtime.realtimeSync.onEvent({
    type: "checkpoint",
    chainId: networks[0].chainId,
    checkpoint: createCheckpoint({ blockNumber: 4 }),
  });

  expect(getLogEventsSpy).toHaveBeenCalledTimes(0);

  await syncService.networkServices[0].realtime.realtimeSync.onEvent({
    type: "checkpoint",
    chainId: networks[1].chainId,
    checkpoint: createCheckpoint({ blockNumber: 4 }),
  });

  expect(getLogEventsSpy).toHaveBeenCalledTimes(1);

  await cleanup();
});

test.todo("onRealtimeSyncEvent reorg");

test.todo("onRealtimeSyncEvent multi network");
