import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { type Checkpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { promiseWithResolvers } from "@ponder/common";
import { type TestContext, beforeEach, expect, test, vi } from "vitest";
import {
  create,
  getHistoricalEvents,
  kill,
  startHistorical,
  startRealtime,
} from "./service.js";

beforeEach(setupCommon);
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

test("createSyncService()", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const syncService = await create({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  expect(syncService.checkpoint).toStrictEqual(zeroCheckpoint);
  expect(syncService.networkServices).toHaveLength(2);

  expect(syncService.networkServices[0].realtime!.finalizedBlock.number).toBe(
    "0x0",
  );
  expect(syncService.networkServices[1].realtime!.finalizedBlock.number).toBe(
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

  await kill(syncService);
  await cleanup();
});

test("createSyncService() no realtime", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const syncService = await create({
    common,
    syncStore,
    networks,
    sources: [sources[0], { ...sources[1], endBlock: 0 }],
    onRealtimeEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  expect(syncService.networkServices[0].realtime).toBeDefined();
  expect(syncService.networkServices[1].realtime).toBeUndefined();

  await kill(syncService);
  await cleanup();
});

test("kill()", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const syncService = await create({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  startHistorical(syncService);

  startRealtime(syncService);

  await kill(syncService);

  await cleanup();
});

test("getHistoricalEvents returns events", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const getLogEventsSpy = vi.spyOn(syncStore, "getLogEvents");

  const syncService = await create({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const ag = getHistoricalEvents(syncService);

  syncService.networkServices[0].historical.checkpoint = createCheckpoint({
    blockNumber: 1n,
  });
  syncService.networkServices[1].historical.checkpoint = createCheckpoint({
    blockNumber: 1n,
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

  await kill(syncService);
  await cleanup();
});

test("getHistoricalEvents resolves when complete", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const getLogEventsSpy = vi.spyOn(syncStore, "getLogEvents");

  const syncService = await create({
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

  // wait for async generator to resolve
  for await (const _ of ag) {
  }

  expect(getLogEventsSpy).toHaveBeenCalledTimes(1);

  expect(syncService.checkpoint.blockNumber).toBe(0n);

  await kill(syncService);
  await cleanup();
});

test("onRealtimeSyncEvent gets events", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const getLogEventsSpy = vi.spyOn(syncStore, "getLogEvents");
  const onRealtimeEventPromiseResolver = promiseWithResolvers<void>();

  const syncService = await create({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: async () => {
      onRealtimeEventPromiseResolver.resolve();
    },
    onFatalError: vi.fn(),
  });

  syncService.networkServices[0].realtime!.checkpoint = zeroCheckpoint;
  syncService.networkServices[1].realtime!.checkpoint = zeroCheckpoint;

  syncService.networkServices[0].realtime!.realtimeSync.onEvent({
    type: "checkpoint",
    chainId: networks[0].chainId,
    checkpoint: createCheckpoint({ blockNumber: 4n }),
  });

  expect(getLogEventsSpy).toHaveBeenCalledTimes(0);

  syncService.networkServices[0].realtime!.realtimeSync.onEvent({
    type: "checkpoint",
    chainId: networks[1].chainId,
    checkpoint: createCheckpoint({ blockNumber: 4n }),
  });

  await onRealtimeEventPromiseResolver.promise;

  expect(getLogEventsSpy).toHaveBeenCalledTimes(1);

  await kill(syncService);
  await cleanup();
});

test("onRealtimeSyncEvent reorg", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const syncService = await create({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  syncService.networkServices[0].realtime!.checkpoint = createCheckpoint({
    blockNumber: 5n,
  });
  syncService.networkServices[1].realtime!.checkpoint = createCheckpoint({
    blockNumber: 5n,
  });

  syncService.checkpoint = createCheckpoint({ blockNumber: 5n });

  syncService.networkServices[0].realtime!.realtimeSync.onEvent({
    type: "reorg",
    chainId: networks[0].chainId,
    safeCheckpoint: createCheckpoint({ blockNumber: 2n }),
  });

  expect(syncService.networkServices[0].realtime!.checkpoint).toStrictEqual(
    createCheckpoint({ blockNumber: 2n }),
  );
  expect(syncService.checkpoint).toStrictEqual(
    createCheckpoint({ blockNumber: 2n }),
  );

  await kill(syncService);
  await cleanup();
});

test("onRealtimeSyncEvent multi network", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const getLogEventsSpy = vi.spyOn(syncStore, "getLogEvents");
  const onRealtimeEventPromiseResolver = promiseWithResolvers<void>();

  const syncService = await create({
    common,
    syncStore,
    networks,
    sources: [sources[0], { ...sources[1], endBlock: 0 }],
    onRealtimeEvent: async () => {
      onRealtimeEventPromiseResolver.resolve();
    },
    onFatalError: vi.fn(),
  });

  syncService.networkServices[0].realtime!.realtimeSync.onEvent({
    type: "checkpoint",
    chainId: networks[0].chainId,
    checkpoint: createCheckpoint({ blockNumber: 4n }),
  });

  await onRealtimeEventPromiseResolver.promise;

  expect(getLogEventsSpy).toHaveBeenCalledTimes(1);

  await kill(syncService);
  await cleanup();
});
