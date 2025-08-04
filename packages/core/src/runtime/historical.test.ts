import {
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { setupAnvil } from "@/_test/setup.js";
import {
  getBlocksConfigAndIndexingFunctions,
  getChain,
  testClient,
} from "@/_test/utils.js";
import { buildConfigAndIndexingFunctions } from "@/build/config.js";
import type { Chain } from "@/internal/types.js";
import { createRpc } from "@/rpc/index.js";
import * as ponderSyncSchema from "@/sync-store/schema.js";
import { MAX_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import { _eth_getBlockByNumber, _eth_getLogs } from "@/utils/rpc.js";
import { beforeEach, expect, test, vi } from "vitest";
import {
  getHistoricalEventsMultichain,
  getLocalEventGenerator,
  getLocalSyncGenerator,
} from "./historical.js";
import {
  type CachedIntervals,
  type ChildAddresses,
  type SyncProgress,
  getCachedIntervals,
  getChildAddresses,
  getLocalSyncProgress,
} from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("getLocalEventGenerator()", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 1 });

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    sources,
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 1 }),
    cachedIntervals,
  });

  const eventGenerator = getLocalEventGenerator({
    common: context.common,
    chain,
    rpc,
    sources,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    syncStore,
    from: syncProgress.getCheckpoint({ tag: "start" })!,
    to: syncProgress.getCheckpoint({ tag: "finalized" })!,
    limit: 100,
  });

  const events = await drainAsyncGenerator(eventGenerator);
  expect(events).toHaveLength(1);
});

test("getLocalEventGenerator() pagination", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 2 });

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    sources,
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 2 }),
    cachedIntervals,
  });

  const eventGenerator = getLocalEventGenerator({
    common: context.common,
    chain,
    rpc,
    syncStore,
    sources,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    from: syncProgress.getCheckpoint({ tag: "start" })!,
    to: syncProgress.getCheckpoint({ tag: "finalized" })!,
    limit: 1,
  });

  const events = await drainAsyncGenerator(eventGenerator);
  expect(events.length).toBeGreaterThan(1);
});

test("getLocalEventGenerator() pagination with zero interval", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 2 });

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    sources,
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 0 }),
    cachedIntervals,
  });

  const eventGenerator = getLocalEventGenerator({
    common: context.common,
    chain,
    rpc,
    syncStore,
    sources,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    from: syncProgress.getCheckpoint({ tag: "start" })!,
    to: syncProgress.getCheckpoint({ tag: "finalized" })!,
    limit: 1,
  });

  const events = await drainAsyncGenerator(eventGenerator);
  expect(events.length).toBe(1);
});

test("getLocalSyncGenerator()", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 1 });

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    sources,
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 1 }),
    cachedIntervals,
  });

  const syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    rpc,
    sources,
    childAddresses: new Map(),
    cachedIntervals,
    syncStore,
    syncProgress,
  });

  await drainAsyncGenerator(syncGenerator);

  const intervals = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);
  expect(intervals[0]!.blocks).toBe("{[0,2]}");
});

test("getLocalSyncGenerator() with partial cache", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 1 });

  let cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    sources,
  });

  let syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 1 }),
    cachedIntervals,
  });

  let syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    rpc,
    sources,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    syncStore,
  });

  await drainAsyncGenerator(syncGenerator);

  await testClient.mine({ blocks: 1 });

  cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    sources,
  });

  syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 2 }),
    cachedIntervals,
  });

  syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    rpc,
    sources,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    syncStore,
  });

  await drainAsyncGenerator(syncGenerator);

  const intervals = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);
  expect(intervals[0]!.blocks).toBe("{[0,3]}");
});

test("getLocalSyncGenerator() with full cache", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  chain.finalityBlockCount = 0;

  let cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    sources,
  });

  let syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 1 }),
    cachedIntervals,
  });

  let syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    rpc,
    sources,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    syncStore,
  });

  await drainAsyncGenerator(syncGenerator);

  cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    sources,
  });

  syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 1 }),
    cachedIntervals,
  });

  syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    rpc,
    sources,
    childAddresses: new Map(),
    syncProgress,
    cachedIntervals,
    syncStore,
  });

  const insertSpy = vi.spyOn(syncStore, "insertIntervals");
  const requestSpy = vi.spyOn(rpc, "request");

  const checkpoints = await drainAsyncGenerator(syncGenerator);
  expect(checkpoints).toHaveLength(1);

  expect(insertSpy).toHaveBeenCalledTimes(0);
  expect(requestSpy).toHaveBeenCalledTimes(0);
});

test("getHistoricalEventsMultichain()", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources, rpcs, chains } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
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

  for (const chain of chains) {
    const cachedIntervals = await getCachedIntervals({
      chain,
      syncStore,
      sources,
    });

    const syncProgress = await getLocalSyncProgress({
      common: context.common,
      sources,
      chain,
      rpc: rpcs[0]!,
      finalizedBlock: await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 1 }),
      cachedIntervals,
    });

    const childAddresses = await getChildAddresses({
      sources,
      syncStore,
    });

    perChainSync.set(chain, { syncProgress, childAddresses, cachedIntervals });
  }

  const events = await drainAsyncGenerator(
    getHistoricalEventsMultichain({
      common: context.common,
      indexingBuild: {
        sources,
        chains,
        rpcs,
        finalizedBlocks: [
          await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 1 }),
        ],
      },
      crashRecoveryCheckpoint: undefined,
      perChainSync,
      syncStore,
    }),
  );

  expect(events.flatMap(({ events }) => events)).toHaveLength(2);
  expect(events.flatMap(({ checkpoints }) => checkpoints)).toHaveLength(1);
});

test("getHistoricalEvents() omnichain", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources, rpcs, chains } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
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

  for (const chain of chains) {
    const cachedIntervals = await getCachedIntervals({
      chain,
      syncStore,
      sources,
    });

    const syncProgress = await getLocalSyncProgress({
      common: context.common,
      sources,
      chain,
      rpc: rpcs[0]!,
      finalizedBlock: await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 1 }),
      cachedIntervals,
    });

    const childAddresses = await getChildAddresses({
      sources,
      syncStore,
    });

    perChainSync.set(chain, { syncProgress, childAddresses, cachedIntervals });
  }

  const events = await drainAsyncGenerator(
    getHistoricalEventsMultichain({
      common: context.common,
      indexingBuild: {
        sources,
        chains,
        rpcs,
        finalizedBlocks: [
          await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 1 }),
        ],
      },
      crashRecoveryCheckpoint: undefined,
      perChainSync,
      syncStore,
    }),
  );

  expect(events.flatMap(({ events }) => events)).toHaveLength(2);
  expect(events.flatMap(({ checkpoints }) => checkpoints)).toHaveLength(1);
});

test("getHistoricalEvents() with crash recovery checkpoint", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources, rpcs, chains } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
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

  for (const chain of chains) {
    const cachedIntervals = await getCachedIntervals({
      chain,
      syncStore,
      sources,
    });

    const syncProgress = await getLocalSyncProgress({
      common: context.common,
      sources,
      chain,
      rpc: rpcs[0]!,
      finalizedBlock: await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 2 }),
      cachedIntervals,
    });

    const childAddresses = await getChildAddresses({
      sources,
      syncStore,
    });

    perChainSync.set(chain, { syncProgress, childAddresses, cachedIntervals });
  }

  const events = await drainAsyncGenerator(
    getHistoricalEventsMultichain({
      common: context.common,
      indexingBuild: {
        sources,
        chains,
        rpcs,
        finalizedBlocks: [
          await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 2 }),
        ],
      },
      crashRecoveryCheckpoint: [
        { chainId: 1, checkpoint: MAX_CHECKPOINT_STRING },
      ],
      perChainSync,
      syncStore,
    }),
  );

  expect(events.flatMap(({ events }) => events)).toHaveLength(0);
});
