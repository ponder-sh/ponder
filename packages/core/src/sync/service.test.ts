import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { type Checkpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { type TestContext, beforeEach, expect, test, vi } from "vitest";
import {
  create,
  getHistoricalCheckpoint,
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
    initialCheckpoint: zeroCheckpoint,
  });

  expect(syncService.checkpoint).toStrictEqual(zeroCheckpoint);
  expect(syncService.networkServices).toHaveLength(2);

  expect(syncService.networkServices[0].realtime!.finalizedBlock.number).toBe(
    "0x1",
  );
  expect(syncService.networkServices[1].realtime!.finalizedBlock.number).toBe(
    "0x1",
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
    initialCheckpoint: zeroCheckpoint,
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
    initialCheckpoint: zeroCheckpoint,
  });

  startHistorical(syncService);

  startRealtime(syncService);

  await kill(syncService);

  await cleanup();
});

test("getHistoricalEvents returns checkpoints", async (context) => {
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
    initialCheckpoint: zeroCheckpoint,
  });

  const ag = getHistoricalCheckpoint(syncService);

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

  await kill(syncService);
  await cleanup();
});

test("getHistoricalEvents resolves when complete", async (context) => {
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
    initialCheckpoint: zeroCheckpoint,
  });

  syncService.networkServices[0].historical.isHistoricalSyncComplete = true;
  syncService.networkServices[1].historical.isHistoricalSyncComplete = true;

  const ag = getHistoricalCheckpoint(syncService);

  // wait for async generator to resolve
  for await (const _ of ag) {
  }

  expect(syncService.checkpoint.blockNumber).toBe(1n);

  await kill(syncService);
  await cleanup();
});

test("onRealtimeSyncEvent gets checkpoints", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const onRealtimeEvent = vi.fn();

  const syncService = await create({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent,
    onFatalError: vi.fn(),
    initialCheckpoint: zeroCheckpoint,
  });

  syncService.networkServices[0].realtime!.checkpoint = zeroCheckpoint;
  syncService.networkServices[1].realtime!.checkpoint = zeroCheckpoint;

  syncService.networkServices[0].realtime!.realtimeSync.onEvent({
    type: "checkpoint",
    chainId: networks[0].chainId,
    checkpoint: createCheckpoint({ blockNumber: 4n }),
  });

  expect(onRealtimeEvent).toHaveBeenCalledTimes(0);

  syncService.networkServices[0].realtime!.realtimeSync.onEvent({
    type: "checkpoint",
    chainId: networks[1].chainId,
    checkpoint: createCheckpoint({ blockNumber: 4n }),
  });

  expect(onRealtimeEvent).toHaveBeenCalledTimes(1);

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
    initialCheckpoint: zeroCheckpoint,
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

  const onRealtimeEvent = vi.fn();

  const syncService = await create({
    common,
    syncStore,
    networks,
    sources: [sources[0], { ...sources[1], endBlock: 0 }],
    onRealtimeEvent,
    onFatalError: vi.fn(),
    initialCheckpoint: zeroCheckpoint,
  });

  syncService.networkServices[0].realtime!.realtimeSync.onEvent({
    type: "checkpoint",
    chainId: networks[0].chainId,
    checkpoint: createCheckpoint({ blockNumber: 4n }),
  });

  expect(onRealtimeEvent).toHaveBeenCalledTimes(1);

  await kill(syncService);
  await cleanup();
});

test("onRealtimeSyncEvent finalize", async (context) => {
  const { common } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  const onRealtimeEvent = vi.fn();

  const syncService = await create({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent,
    onFatalError: vi.fn(),
    initialCheckpoint: zeroCheckpoint,
  });

  syncService.networkServices[0].realtime!.finalizedCheckpoint =
    createCheckpoint({
      blockNumber: 6n,
    });
  syncService.networkServices[1].realtime!.finalizedCheckpoint =
    createCheckpoint({
      blockNumber: 4n,
    });

  syncService.finalizedCheckpoint = createCheckpoint({ blockNumber: 4n });

  syncService.networkServices[0].realtime!.realtimeSync.onEvent({
    type: "finalize",
    chainId: networks[0].chainId,
    checkpoint: createCheckpoint({ blockNumber: 7n }),
  });

  expect(
    syncService.networkServices[0].realtime!.finalizedCheckpoint,
  ).toStrictEqual(createCheckpoint({ blockNumber: 7n }));
  expect(syncService.finalizedCheckpoint).toStrictEqual(
    createCheckpoint({ blockNumber: 4n }),
  );

  expect(onRealtimeEvent).toHaveBeenCalledTimes(0);

  syncService.networkServices[1].realtime!.realtimeSync.onEvent({
    type: "finalize",
    chainId: networks[1].chainId,
    checkpoint: createCheckpoint({ blockNumber: 6n }),
  });

  expect(
    syncService.networkServices[1].realtime!.finalizedCheckpoint,
  ).toStrictEqual(createCheckpoint({ blockNumber: 6n }));
  expect(syncService.finalizedCheckpoint).toStrictEqual(
    createCheckpoint({ blockNumber: 6n }),
  );

  expect(onRealtimeEvent).toHaveBeenCalledTimes(1);

  await kill(syncService);
  await cleanup();
});
