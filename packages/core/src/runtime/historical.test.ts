import { hexToBigInt } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import {
  context,
  setupAnvil,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getBlocksIndexingBuild, getChain, testClient } from "@/_test/utils.js";
import type { Chain } from "@/internal/types.js";
import { eth_getBlockByNumber } from "@/rpc/actions.js";
import { createRpc } from "@/rpc/index.js";
import * as ponderSyncSchema from "@/sync-store/schema.js";
import {
  encodeCheckpoint,
  MAX_CHECKPOINT,
  MAX_CHECKPOINT_STRING,
} from "@/utils/checkpoint.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import {
  getHistoricalEventsMultichain,
  getLocalEventGenerator,
  getLocalInMemoryEventGenerator,
  getLocalSyncGenerator,
} from "./historical.js";
import {
  type CachedIntervals,
  type ChildAddresses,
  getCachedIntervals,
  getChildAddresses,
  getLocalSyncProgress,
  type SyncProgress,
} from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("getLocalEventGenerator()", async () => {
  const { database, syncStore } = await setupDatabaseServices();
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  await testClient.mine({ blocks: 1 });

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x1", true]),
    cachedIntervals,
  });

  const eventGenerator = getLocalEventGenerator({
    common: context.common,
    chain,
    rpc,
    eventCallbacks,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    database,
    from: syncProgress.getCheckpoint({ tag: "start" })!,
    to: syncProgress.getCheckpoint({ tag: "finalized" })!,
    limit: 100,
    isCatchup: false,
  });

  const events = await drainAsyncGenerator(eventGenerator);
  expect(events).toHaveLength(1);
});

test("getLocalEventGenerator() pagination", async () => {
  const { database, syncStore } = await setupDatabaseServices();
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  await testClient.mine({ blocks: 2 });

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x2", true]),
    cachedIntervals,
  });

  const eventGenerator = getLocalEventGenerator({
    common: context.common,
    chain,
    rpc,
    database,
    eventCallbacks,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    from: syncProgress.getCheckpoint({ tag: "start" })!,
    to: syncProgress.getCheckpoint({ tag: "finalized" })!,
    limit: 1,
    isCatchup: false,
  });

  const events = await drainAsyncGenerator(eventGenerator);
  expect(events.length).toBeGreaterThan(1);
});

test("getLocalEventGenerator() pagination checkpoints", async () => {
  const { database, syncStore } = await setupDatabaseServices();
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  await testClient.mine({ blocks: 2 });

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x2", true]),
    cachedIntervals,
  });

  const eventGenerator = getLocalEventGenerator({
    common: context.common,
    chain,
    rpc,
    database,
    eventCallbacks,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    from: syncProgress.getCheckpoint({ tag: "start" })!,
    to: syncProgress.getCheckpoint({ tag: "finalized" })!,
    limit: 1,
    isCatchup: false,
  });

  const batches = await drainAsyncGenerator(eventGenerator);

  // Note: Each batch checkpoint must be greater than all events in the
  // following batches, otherwise events are ordered and recovered incorrectly.

  let previousCheckpoint = "";
  for (const { events, checkpoint } of batches) {
    expect(checkpoint > previousCheckpoint).toBe(true);
    for (const event of events) {
      expect(event.checkpoint > previousCheckpoint).toBe(true);
      expect(event.checkpoint <= checkpoint).toBe(true);
    }
    previousCheckpoint = checkpoint;
  }
  expect(batches.at(-1)!.checkpoint).toBe(
    syncProgress.getCheckpoint({ tag: "finalized" })!,
  );
});

test("getLocalEventGenerator() pagination with zero interval", async () => {
  const { database, syncStore } = await setupDatabaseServices();
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  await testClient.mine({ blocks: 2 });

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x0", true]),
    cachedIntervals,
  });

  const eventGenerator = getLocalEventGenerator({
    common: context.common,
    chain,
    rpc,
    database,
    eventCallbacks,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    from: syncProgress.getCheckpoint({ tag: "start" })!,
    to: syncProgress.getCheckpoint({ tag: "finalized" })!,
    limit: 1,
    isCatchup: false,
  });

  const events = await drainAsyncGenerator(eventGenerator);
  expect(events.length).toBe(1);
});

test("getLocalInMemoryEventGenerator()", async () => {
  const { syncStore } = await setupDatabaseServices();
  const chain = getChain({ cacheRpcRequests: false });
  const rpc = createRpc({ chain, common: context.common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  await testClient.mine({ blocks: 1 });

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x1", true]),
    cachedIntervals,
  });

  const eventGenerator = getLocalInMemoryEventGenerator({
    common: context.common,
    chain,
    rpc,
    eventCallbacks,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    from: syncProgress.getCheckpoint({ tag: "start" })!,
    to: syncProgress.getCheckpoint({ tag: "finalized" })!,
    limit: 100,
    isCatchup: false,
  });

  const events = await drainAsyncGenerator(eventGenerator);
  expect(events.flatMap(({ events }) => events)).toHaveLength(2);
  expect(events.map(({ blockRange }) => blockRange)).toStrictEqual([
    [0, 0],
    [1, 1],
  ]);
});

test("getLocalInMemoryEventGenerator() with start block after finalized block", async () => {
  const { syncStore } = await setupDatabaseServices();
  const chain = getChain({ cacheRpcRequests: false });
  const rpc = createRpc({ chain, common: context.common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  eventCallbacks[0].filter.fromBlock = 2;

  await testClient.mine({ blocks: 2 });

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x1", true]),
    cachedIntervals,
  });

  const eventGenerator = getLocalInMemoryEventGenerator({
    common: context.common,
    chain,
    rpc,
    eventCallbacks,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    from: syncProgress.getCheckpoint({ tag: "start" })!,
    to: syncProgress.getCheckpoint({ tag: "finalized" })!,
    limit: 100,
    isCatchup: false,
  });

  const requestSpy = vi.spyOn(rpc, "request");

  const events = await drainAsyncGenerator(eventGenerator);
  expect(events).toHaveLength(0);

  expect(syncProgress.current).toBe(syncProgress.finalized);
  expect(requestSpy).toHaveBeenCalledTimes(0);
});

test("getLocalInMemoryEventGenerator() ignores intervals table", async () => {
  const { database, syncStore } = await setupDatabaseServices();
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  chain.reorgWindow = 0;

  let cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  let syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x1", true]),
    cachedIntervals,
  });

  const syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    rpc,
    eventCallbacks,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    database,
    isCatchup: false,
  });

  await drainAsyncGenerator(syncGenerator);

  const intervals = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);

  const inMemoryChain = getChain({ cacheRpcRequests: false });
  inMemoryChain.reorgWindow = 0;

  cachedIntervals = await getCachedIntervals({
    chain: inMemoryChain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain: inMemoryChain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x1", true]),
    cachedIntervals,
  });

  const eventGenerator = getLocalInMemoryEventGenerator({
    common: context.common,
    chain: inMemoryChain,
    rpc,
    eventCallbacks,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    from: syncProgress.getCheckpoint({ tag: "start" })!,
    to: syncProgress.getCheckpoint({ tag: "finalized" })!,
    limit: 100,
    isCatchup: false,
  });

  const requestSpy = vi.spyOn(rpc, "request");

  const events = await drainAsyncGenerator(eventGenerator);
  expect(events.flatMap(({ events }) => events)).toHaveLength(2);

  expect(requestSpy).toHaveBeenCalled();
});

test("getLocalInMemoryEventGenerator() with crash recovery checkpoint", async () => {
  const { syncStore } = await setupDatabaseServices();
  const chain = getChain({ cacheRpcRequests: false });
  const rpc = createRpc({ chain, common: context.common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  await testClient.mine({ blocks: 2 });

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x2", true]),
    cachedIntervals,
  });

  // Note: Block 1 and earlier is already indexed.
  const block = await eth_getBlockByNumber(rpc, ["0x1", true]);
  const crashRecoveryCheckpoint = encodeCheckpoint({
    ...MAX_CHECKPOINT,
    blockTimestamp: hexToBigInt(block.timestamp),
    chainId: BigInt(chain.id),
    blockNumber: hexToBigInt(block.number),
  });

  const eventGenerator = getLocalInMemoryEventGenerator({
    common: context.common,
    chain,
    rpc,
    eventCallbacks,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    from: crashRecoveryCheckpoint,
    to: syncProgress.getCheckpoint({ tag: "finalized" })!,
    limit: 100,
    isCatchup: false,
  });

  const requestSpy = vi.spyOn(rpc, "request");

  // Note: The crash recovery block is fetched again, the same as `getLocalEventGenerator`.
  const events = await drainAsyncGenerator(eventGenerator);
  expect(events.flatMap(({ events }) => events)).toHaveLength(2);

  const blockRequests = requestSpy.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === "eth_getBlockByNumber");
  expect(blockRequests).toStrictEqual([
    { method: "eth_getBlockByNumber", params: ["0x1", true] },
    { method: "eth_getBlockByNumber", params: ["0x2", true] },
  ]);
});

test("getLocalSyncGenerator()", async () => {
  const { database, syncStore } = await setupDatabaseServices();
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  await testClient.mine({ blocks: 1 });

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x1", true]),
    cachedIntervals,
  });

  const syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    rpc,
    eventCallbacks,
    childAddresses: new Map(),
    cachedIntervals,
    database,
    syncProgress,
    isCatchup: false,
  });

  await drainAsyncGenerator(syncGenerator);

  const intervals = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);
  expect(intervals[0]!.blocks).toBe("{[0,2]}");
});

test("getLocalSyncGenerator() with partial cache", async () => {
  const { database, syncStore } = await setupDatabaseServices();
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  await testClient.mine({ blocks: 1 });

  let cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  let syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x1", true]),
    cachedIntervals,
  });

  let syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    rpc,
    eventCallbacks,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    database,
    isCatchup: false,
  });

  await drainAsyncGenerator(syncGenerator);

  await testClient.mine({ blocks: 1 });

  cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x2", true]),
    cachedIntervals,
  });

  syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    rpc,
    eventCallbacks,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    database,
    isCatchup: false,
  });

  await drainAsyncGenerator(syncGenerator);

  const intervals = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);
  expect(intervals[0]!.blocks).toBe("{[0,3]}");
});

test("getLocalSyncGenerator() with full cache", async () => {
  const { database, syncStore } = await setupDatabaseServices();
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  chain.reorgWindow = 0;

  let cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  let syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x1", true]),
    cachedIntervals,
  });

  let syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    rpc,
    eventCallbacks,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    database,
    isCatchup: false,
  });

  await drainAsyncGenerator(syncGenerator);

  cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x1", true]),
    cachedIntervals,
  });

  syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    rpc,
    eventCallbacks,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    database,
    isCatchup: false,
  });

  const insertSpy = vi.spyOn(syncStore, "insertIntervals");
  const requestSpy = vi.spyOn(rpc, "request");

  const checkpoints = await drainAsyncGenerator(syncGenerator);
  expect(checkpoints).toHaveLength(1);

  expect(insertSpy).toHaveBeenCalledTimes(0);
  expect(requestSpy).toHaveBeenCalledTimes(0);
});

test("getHistoricalEventsMultichain()", async () => {
  const { database, syncStore } = await setupDatabaseServices();

  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  await testClient.mine({ blocks: 1 });

  const perChainSync = new Map<
    Chain,
    {
      syncProgress: SyncProgress;
      childAddresses: ChildAddresses;
      cachedIntervals: CachedIntervals;
    }
  >();

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x1", true]),
    cachedIntervals,
  });

  const childAddresses = await getChildAddresses({
    chain,
    filters: eventCallbacks.map(({ filter }) => filter),
    syncStore,
  });

  perChainSync.set(chain, { syncProgress, childAddresses, cachedIntervals });

  const events = await drainAsyncGenerator(
    getHistoricalEventsMultichain({
      common: context.common,
      indexingBuild: {
        eventCallbacks: [eventCallbacks],
        chains: [chain],
        rpcs: [rpc],
      },
      crashRecoveryCheckpoint: undefined,
      perChainSync,
      database,
    }),
  );

  expect(events).toHaveLength(1);
  expect(events.flatMap(({ events }) => events)).toHaveLength(2);
});

test("getHistoricalEvents() omnichain", async () => {
  const { database, syncStore } = await setupDatabaseServices();

  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  await testClient.mine({ blocks: 1 });

  const perChainSync = new Map<
    Chain,
    {
      syncProgress: SyncProgress;
      childAddresses: ChildAddresses;
      cachedIntervals: CachedIntervals;
    }
  >();

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x1", true]),
    cachedIntervals,
  });

  const childAddresses = await getChildAddresses({
    chain,
    filters: eventCallbacks.map(({ filter }) => filter),
    syncStore,
  });

  perChainSync.set(chain, { syncProgress, childAddresses, cachedIntervals });

  const events = await drainAsyncGenerator(
    getHistoricalEventsMultichain({
      common: context.common,
      indexingBuild: {
        eventCallbacks: [eventCallbacks],
        chains: [chain],
        rpcs: [rpc],
      },
      crashRecoveryCheckpoint: undefined,
      perChainSync,
      database,
    }),
  );

  expect(events).toHaveLength(1);
  expect(events.flatMap(({ events }) => events)).toHaveLength(2);
});

test("getHistoricalEvents() with crash recovery checkpoint", async () => {
  const { database, syncStore } = await setupDatabaseServices();

  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  await testClient.mine({ blocks: 2 });

  const perChainSync = new Map<
    Chain,
    {
      syncProgress: SyncProgress;
      childAddresses: ChildAddresses;
      cachedIntervals: CachedIntervals;
    }
  >();

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    filters: eventCallbacks.map(({ filter }) => filter),
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: await eth_getBlockByNumber(rpc, ["0x2", true]),
    cachedIntervals,
  });

  const childAddresses = await getChildAddresses({
    chain,
    filters: eventCallbacks.map(({ filter }) => filter),
    syncStore,
  });

  perChainSync.set(chain, { syncProgress, childAddresses, cachedIntervals });

  const events = await drainAsyncGenerator(
    getHistoricalEventsMultichain({
      common: context.common,
      indexingBuild: {
        eventCallbacks: [eventCallbacks],
        chains: [chain],
        rpcs: [rpc],
      },
      crashRecoveryCheckpoint: [
        { chainId: 1, checkpoint: MAX_CHECKPOINT_STRING },
      ],
      perChainSync,
      database,
    }),
  );

  expect(events.flatMap(({ events }) => events)).toHaveLength(0);
});
