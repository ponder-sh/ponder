import { ALICE } from "@/_test/constants.js";
import {
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { setupAnvil } from "@/_test/setup.js";
import { deployErc20, mintErc20 } from "@/_test/simulate.js";
import {
  getBlocksConfigAndIndexingFunctions,
  getChain,
  getErc20ConfigAndIndexingFunctions,
  testClient,
} from "@/_test/utils.js";
import { buildConfigAndIndexingFunctions } from "@/build/config.js";
import type { BlockFilter, Event, Filter, Fragment } from "@/internal/types.js";
import { createRpc } from "@/rpc/index.js";
import { createHistoricalSync } from "@/sync-historical/index.js";
import * as ponderSyncSchema from "@/sync-store/schema.js";
import { MAX_CHECKPOINT_STRING, decodeCheckpoint } from "@/utils/checkpoint.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import type { Interval } from "@/utils/interval.js";
import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
import { _eth_getBlockByNumber, _eth_getLogs } from "@/utils/rpc.js";
import { parseEther } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import {
  syncBlockToInternal,
  syncLogToInternal,
  syncTransactionToInternal,
} from "./events.js";
import { getFragments } from "./fragments.js";
import {
  createSync,
  getCachedBlock,
  getChainCheckpoint,
  getLocalEventGenerator,
  getLocalSyncGenerator,
  getLocalSyncProgress,
  getPerChainOnRealtimeSyncEvent,
  mergeAsyncGeneratorsWithEventOrder,
  splitEvents,
} from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("splitEvents()", async () => {
  const events = [
    {
      chainId: 1,
      checkpoint: "0",
      event: {
        block: {
          hash: "0x1",
          timestamp: 1,
          number: 1n,
        },
      },
    },
    {
      chainId: 1,
      checkpoint: "0",
      event: {
        block: {
          hash: "0x2",
          timestamp: 2,
          number: 2n,
        },
      },
    },
  ] as unknown as Event[];

  const result = splitEvents(events);

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "chainId": 1,
        "checkpoint": "000000000100000000000000010000000000000001999999999999999999999999999999999",
        "events": [
          {
            "chainId": 1,
            "checkpoint": "0",
            "event": {
              "block": {
                "hash": "0x1",
                "number": 1n,
                "timestamp": 1,
              },
            },
          },
        ],
      },
      {
        "chainId": 1,
        "checkpoint": "000000000200000000000000010000000000000002999999999999999999999999999999999",
        "events": [
          {
            "chainId": 1,
            "checkpoint": "0",
            "event": {
              "block": {
                "hash": "0x2",
                "number": 2n,
                "timestamp": 2,
              },
            },
          },
        ],
      },
    ]
  `);
});

test("getPerChainOnRealtimeSyncEvent() handles block", async (context) => {
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

  const intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >();
  for (const source of sources) {
    for (const { fragment } of getFragments(source.filter)) {
      intervalsCache.set(source.filter, [{ fragment, intervals: [] }]);
    }
  }

  await testClient.mine({ blocks: 1 });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 0 }),
    intervalsCache,
  });

  const onRealtimeSyncEvent = getPerChainOnRealtimeSyncEvent({
    common: context.common,
    chain,
    sources,
    syncStore,
    syncProgress,
  });

  const block = await _eth_getBlockByNumber(rpc, {
    blockNumber: 1,
  });

  await onRealtimeSyncEvent({
    type: "block",
    hasMatchedFilter: false,
    block,
    logs: [],
    traces: [],
    transactions: [],
    transactionReceipts: [],
    childAddresses: new Map(),
  });
});

test("getPerChainOnRealtimeSyncEvent() handles finalize", async (context) => {
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

  const intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >();
  for (const source of sources) {
    for (const { fragment } of getFragments(source.filter)) {
      intervalsCache.set(source.filter, [{ fragment, intervals: [] }]);
    }
  }

  await testClient.mine({ blocks: 1 });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 0 }),
    intervalsCache,
  });

  const onRealtimeSyncEvent = getPerChainOnRealtimeSyncEvent({
    common: context.common,
    chain,
    sources,
    syncStore,
    syncProgress,
  });

  const block = await _eth_getBlockByNumber(rpc, {
    blockNumber: 1,
  });

  await onRealtimeSyncEvent({
    type: "block",
    hasMatchedFilter: true,
    block,
    logs: [],
    traces: [],
    transactions: [],
    transactionReceipts: [],
    childAddresses: new Map(),
  });

  await onRealtimeSyncEvent({
    type: "finalize",
    block,
  });

  const blocks = await database.syncQB
    .select()
    .from(ponderSyncSchema.blocks)
    .execute();

  expect(blocks).toHaveLength(1);

  const intervals = await database.syncQB
    .select()
    .from(ponderSyncSchema.intervals)
    .execute();

  expect(intervals).toHaveLength(1);
  expect(intervals[0]!.blocks).toBe("{[0,2]}");
});

test("getPerChainOnRealtimeSyncEvent() handles reorg", async (context) => {
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

  const intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >();
  for (const source of sources) {
    for (const { fragment } of getFragments(source.filter)) {
      intervalsCache.set(source.filter, [{ fragment, intervals: [] }]);
    }
  }

  await testClient.mine({ blocks: 1 });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 0 }),
    intervalsCache,
  });

  const onRealtimeSyncEvent = getPerChainOnRealtimeSyncEvent({
    common: context.common,
    chain,
    sources,
    syncStore,
    syncProgress,
  });

  const block = await _eth_getBlockByNumber(rpc, {
    blockNumber: 1,
  });

  await onRealtimeSyncEvent({
    type: "block",
    hasMatchedFilter: true,
    block,
    logs: [],
    traces: [],
    transactions: [],
    transactionReceipts: [],
    childAddresses: new Map(),
  });

  await onRealtimeSyncEvent({
    type: "reorg",
    block,
    reorgedBlocks: [block],
  });
});

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

  const historicalSync = await createHistoricalSync({
    common: context.common,
    chain,
    syncStore,
    sources,
    rpc: createRpc({
      chain,
      common: context.common,
    }),
    onFatalError: () => {},
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 1 }),
    intervalsCache: historicalSync.intervalsCache,
  });

  const syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    syncProgress,
    historicalSync,
  });

  const eventGenerator = getLocalEventGenerator({
    common: context.common,
    chain,
    syncStore,
    sources,
    localSyncGenerator: syncGenerator,
    from: getChainCheckpoint({ syncProgress, chain, tag: "start" })!,
    to: getChainCheckpoint({ syncProgress, chain, tag: "finalized" })!,
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

  const historicalSync = await createHistoricalSync({
    common: context.common,
    chain,
    syncStore,
    sources,
    rpc,
    onFatalError: () => {},
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 2 }),
    intervalsCache: historicalSync.intervalsCache,
  });

  const syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    syncProgress,
    historicalSync,
  });

  const eventGenerator = getLocalEventGenerator({
    common: context.common,
    chain,
    syncStore,
    sources,
    localSyncGenerator: syncGenerator,
    from: getChainCheckpoint({ syncProgress, chain, tag: "start" })!,
    to: getChainCheckpoint({ syncProgress, chain, tag: "finalized" })!,
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

  const historicalSync = await createHistoricalSync({
    common: context.common,
    chain,
    syncStore,
    sources,
    rpc,
    onFatalError: () => {},
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 0 }),
    intervalsCache: historicalSync.intervalsCache,
  });

  const syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    syncProgress,
    historicalSync,
  });

  const eventGenerator = getLocalEventGenerator({
    common: context.common,
    chain,
    syncStore,
    sources,
    localSyncGenerator: syncGenerator,
    from: getChainCheckpoint({ syncProgress, chain, tag: "start" })!,
    to: getChainCheckpoint({ syncProgress, chain, tag: "finalized" })!,
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

  const historicalSync = await createHistoricalSync({
    common: context.common,
    chain,
    syncStore,
    sources,
    rpc,
    onFatalError: () => {},
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 1 }),

    intervalsCache: historicalSync.intervalsCache,
  });

  const syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    syncProgress,
    historicalSync,
  });

  await drainAsyncGenerator(syncGenerator);

  const intervals = await database.syncQB
    .select()
    .from(ponderSyncSchema.intervals)
    .execute();

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

  let historicalSync = await createHistoricalSync({
    common: context.common,
    chain,
    syncStore,
    sources,
    rpc,
    onFatalError: () => {},
  });

  let syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 1 }),
    intervalsCache: historicalSync.intervalsCache,
  });

  let syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    syncProgress,
    historicalSync,
  });

  await drainAsyncGenerator(syncGenerator);

  await testClient.mine({ blocks: 1 });

  historicalSync = await createHistoricalSync({
    common: context.common,
    chain,
    syncStore,
    sources,
    rpc,
    onFatalError: () => {},
  });

  syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 2 }),
    intervalsCache: historicalSync.intervalsCache,
  });

  syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    syncProgress,
    historicalSync,
  });

  await drainAsyncGenerator(syncGenerator);

  const intervals = await database.syncQB
    .select()
    .from(ponderSyncSchema.intervals)
    .execute();

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

  let historicalSync = await createHistoricalSync({
    common: context.common,
    chain,
    syncStore,
    sources,
    rpc,
    onFatalError: () => {},
  });

  let syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 1 }),
    intervalsCache: historicalSync.intervalsCache,
  });

  let syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    syncProgress,
    historicalSync,
  });

  await drainAsyncGenerator(syncGenerator);

  historicalSync = await createHistoricalSync({
    common: context.common,
    chain,
    syncStore,
    sources,
    rpc,
    onFatalError: () => {},
  });

  syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 1 }),
    intervalsCache: historicalSync.intervalsCache,
  });

  syncGenerator = getLocalSyncGenerator({
    common: context.common,
    chain,
    syncProgress,
    historicalSync,
  });

  const insertSpy = vi.spyOn(syncStore, "insertIntervals");
  const requestSpy = vi.spyOn(rpc, "request");

  const checkpoints = await drainAsyncGenerator(syncGenerator);
  expect(checkpoints).toHaveLength(1);

  expect(insertSpy).toHaveBeenCalledTimes(0);
  expect(requestSpy).toHaveBeenCalledTimes(0);
});

test("getLocalSyncProgress()", async (context) => {
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

  const intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >();
  for (const source of sources) {
    for (const { fragment } of getFragments(source.filter)) {
      intervalsCache.set(source.filter, [{ fragment, intervals: [] }]);
    }
  }

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 0 }),
    intervalsCache,
  });

  expect(syncProgress.finalized.number).toBe("0x0");
  expect(syncProgress.start.number).toBe("0x0");
  expect(syncProgress.end).toBe(undefined);
  expect(syncProgress.current).toBe(undefined);
});

test("getLocalSyncProgress() future end block", async (context) => {
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });

  // @ts-ignore
  config.blocks.Blocks.endBlock = 12;

  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  const intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >();
  for (const source of sources) {
    for (const { fragment } of getFragments(source.filter)) {
      intervalsCache.set(source.filter, [{ fragment, intervals: [] }]);
    }
  }

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 0 }),
    intervalsCache,
  });

  expect(syncProgress.finalized.number).toBe("0x0");
  expect(syncProgress.start.number).toBe("0x0");
  expect(syncProgress.end).toMatchInlineSnapshot(`
    {
      "hash": "0x",
      "number": "0xc",
      "parentHash": "0x",
      "timestamp": "0x2540be3ff",
    }
  `);
  expect(syncProgress.current).toBe(undefined);
});

test("getCachedBlock() no cached intervals", async () => {
  const filter = {
    type: "block",
    chainId: 1,
    interval: 1,
    offset: 0,
    fromBlock: 0,
    toBlock: 100,
    include: [],
  } satisfies BlockFilter;

  const intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([[filter, []]]);

  const cachedBlock = getCachedBlock({
    filters: [filter],
    intervalsCache,
  });

  expect(cachedBlock).toBe(undefined);
});

test("getCachedBlock() with cache", async () => {
  const filter = {
    type: "block",
    chainId: 1,
    interval: 1,
    offset: 0,
    fromBlock: 0,
    toBlock: 100,
    include: [],
  } satisfies BlockFilter;

  let intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([[filter, [{ fragment: {} as Fragment, intervals: [[0, 24]] }]]]);

  let cachedBlock = getCachedBlock({
    filters: [filter],
    intervalsCache,
  });

  expect(cachedBlock).toBe(24);

  intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([
    [
      filter,
      [
        {
          fragment: {} as Fragment,
          intervals: [
            [0, 50],
            [50, 102],
          ],
        },
      ],
    ],
  ]);

  cachedBlock = getCachedBlock({
    filters: [filter],
    intervalsCache,
  });

  expect(cachedBlock).toBe(100);
});

test("getCachedBlock() with incomplete cache", async () => {
  const filter = {
    type: "block",
    chainId: 1,
    interval: 1,
    offset: 0,
    fromBlock: 0,
    toBlock: 100,
    include: [],
  } satisfies BlockFilter;

  const intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([[filter, [{ fragment: {} as Fragment, intervals: [[1, 24]] }]]]);

  const cachedBlock = getCachedBlock({
    filters: [filter],
    intervalsCache,
  });

  expect(cachedBlock).toBeUndefined();
});

test("getCachedBlock() with multiple filters", async () => {
  const filters = [
    {
      type: "block",
      chainId: 1,
      interval: 1,
      offset: 0,
      fromBlock: 0,
      toBlock: 100,
      include: [],
    },
    {
      type: "block",
      chainId: 1,
      interval: 1,
      offset: 1,
      fromBlock: 50,
      toBlock: 150,
      include: [],
    },
  ] satisfies BlockFilter[];

  let intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([
    [filters[0]!, [{ fragment: {} as Fragment, intervals: [[0, 24]] }]],
    [filters[1]!, []],
  ]);

  let cachedBlock = getCachedBlock({
    filters,
    intervalsCache,
  });

  expect(cachedBlock).toBe(24);

  intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([
    [filters[0]!, [{ fragment: {} as Fragment, intervals: [[0, 24]] }]],
    [filters[1]!, [{ fragment: {} as Fragment, intervals: [[50, 102]] }]],
  ]);

  cachedBlock = getCachedBlock({
    filters,
    intervalsCache,
  });

  expect(cachedBlock).toBe(24);
});

test("mergeAsyncGeneratorsWithEventOrder()", async () => {
  const p1 = promiseWithResolvers<{ events: Event[]; checkpoint: string }>();
  const p2 = promiseWithResolvers<{ events: Event[]; checkpoint: string }>();
  const p3 = promiseWithResolvers<{ events: Event[]; checkpoint: string }>();
  const p4 = promiseWithResolvers<{ events: Event[]; checkpoint: string }>();

  async function* generator1() {
    yield await p1.promise;
    yield await p2.promise;
  }

  async function* generator2() {
    yield await p3.promise;
    yield await p4.promise;
  }

  const results: {
    events: Event[];
    checkpoints: { chainId: number; checkpoint: string }[];
  }[] = [];
  const generator = mergeAsyncGeneratorsWithEventOrder([
    generator1(),
    generator2(),
  ]);

  (async () => {
    for await (const result of generator) {
      results.push(result);
    }
  })();

  p1.resolve({
    events: [
      { checkpoint: "01", chainId: 1 },
      { checkpoint: "07", chainId: 1 },
    ] as Event[],
    checkpoint: "10",
  });
  p3.resolve({
    events: [
      { checkpoint: "02", chainId: 2 },
      { checkpoint: "05", chainId: 2 },
    ] as Event[],
    checkpoint: "06",
  });

  await new Promise((res) => setTimeout(res));

  p4.resolve({
    events: [
      { checkpoint: "08", chainId: 1 },
      { checkpoint: "11", chainId: 1 },
    ] as Event[],
    checkpoint: "20",
  });
  p2.resolve({
    events: [
      { checkpoint: "08", chainId: 2 },
      { checkpoint: "13", chainId: 2 },
    ] as Event[],
    checkpoint: "20",
  });

  await new Promise((res) => setTimeout(res));

  expect(results).toMatchInlineSnapshot(`
    [
      {
        "checkpoints": [
          {
            "chainId": 1,
            "checkpoint": "01",
          },
          {
            "chainId": 2,
            "checkpoint": "05",
          },
        ],
        "events": [
          {
            "chainId": 1,
            "checkpoint": "01",
          },
          {
            "chainId": 2,
            "checkpoint": "02",
          },
          {
            "chainId": 2,
            "checkpoint": "05",
          },
        ],
      },
      {
        "checkpoints": [
          {
            "chainId": 1,
            "checkpoint": "07",
          },
          {
            "chainId": 1,
            "checkpoint": "08",
          },
        ],
        "events": [
          {
            "chainId": 1,
            "checkpoint": "07",
          },
          {
            "chainId": 1,
            "checkpoint": "08",
          },
        ],
      },
      {
        "checkpoints": [
          {
            "chainId": 2,
            "checkpoint": "13",
          },
          {
            "chainId": 1,
            "checkpoint": "11",
          },
        ],
        "events": [
          {
            "chainId": 2,
            "checkpoint": "08",
          },
          {
            "chainId": 1,
            "checkpoint": "11",
          },
          {
            "chainId": 2,
            "checkpoint": "13",
          },
        ],
      },
    ]
  `);
});

test("createSync()", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);
  const chain = getChain();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources, rpcs } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  const sync = await createSync({
    common: context.common,
    indexingBuild: {
      sources,
      chains: [chain],
      rpcs,
      finalizedBlocks: [
        await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 0 }),
      ],
    },
    syncStore,
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
    ordering: "multichain",
  });

  expect(sync).toBeDefined();
});

test("getEvents() multichain", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const chain = getChain();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources, rpcs } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 1 });

  const sync = await createSync({
    syncStore,
    common: context.common,
    indexingBuild: {
      sources,
      chains: [chain],
      rpcs,
      finalizedBlocks: [
        await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 1 }),
      ],
    },
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
    ordering: "multichain",
  });

  const events = await drainAsyncGenerator(sync.getEvents());
  expect(events.flatMap(({ events }) => events)).toHaveLength(2);
  expect(events.flatMap(({ checkpoints }) => checkpoints)).toHaveLength(1);
});

test("getEvents() omnichain", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const chain = getChain();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources, rpcs } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 1 });

  const sync = await createSync({
    syncStore,
    common: context.common,
    indexingBuild: {
      sources,
      chains: [chain],
      rpcs,
      finalizedBlocks: [
        await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 1 }),
      ],
    },
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
    ordering: "omnichain",
  });

  const events = await drainAsyncGenerator(sync.getEvents());
  expect(events.flatMap(({ events }) => events)).toHaveLength(2);
  expect(events.flatMap(({ checkpoints }) => checkpoints)).toHaveLength(1);
});

test("getEvents() with crash recovery checkpoint", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);
  const chain = getChain();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources, rpcs } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 2 });

  const sync = await createSync({
    syncStore,

    common: context.common,
    indexingBuild: {
      sources,
      chains: [chain],
      rpcs,
      finalizedBlocks: [
        await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 2 }),
      ],
    },
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    crashRecoveryCheckpoint: [
      { chainId: 1, checkpoint: MAX_CHECKPOINT_STRING },
    ],
    ordering: "multichain",
  });

  const events = await drainAsyncGenerator(sync.getEvents());
  expect(events.flatMap(({ events }) => events)).toHaveLength(0);
});

// Note: this test is causing a flake on ci.
// We need a way to figure out how to make sure queues are drained
// when shutting down.
test.skip("startRealtime()", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const chain = getChain();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources, rpcs } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 2 });

  const sync = await createSync({
    syncStore,
    common: context.common,
    indexingBuild: {
      sources,
      chains: [chain],
      rpcs,
      finalizedBlocks: [
        await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 0 }),
      ],
    },
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
    ordering: "multichain",
  });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();
});

test("onEvent() multichain handles block", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const chain = getChain();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources, rpcs } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  const promise = promiseWithResolvers<void>();
  const events: Event[] = [];

  await testClient.mine({ blocks: 1 });

  const sync = await createSync({
    syncStore,
    common: context.common,
    indexingBuild: {
      sources,
      chains: [chain],
      rpcs,
      finalizedBlocks: [
        await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 0 }),
      ],
    },
    onRealtimeEvent: async (event) => {
      if (event.type === "block") {
        events.push(...event.events);
        promise.resolve();
      }
    },
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
    ordering: "multichain",
  });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;

  expect(events).toHaveLength(1);
});

test("onEvent() omnichain handles block", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources, chains, rpcs } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  const promise = promiseWithResolvers<void>();

  const sync = await createSync({
    common: context.common,
    indexingBuild: {
      sources,
      chains,
      rpcs,
      finalizedBlocks: [
        await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 0 }),
      ],
    },
    syncStore,
    onRealtimeEvent: async (event) => {
      if (event.type === "block") {
        promise.resolve();
      }
    },
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
    ordering: "omnichain",
  });

  await testClient.mine({ blocks: 1 });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;
});

test("onEvent() handles finalize", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const chain = getChain();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources, rpcs } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  const promise = promiseWithResolvers<void>();
  let checkpoint: string;

  chain.finalityBlockCount = 2;

  const sync = await createSync({
    syncStore,
    common: context.common,
    indexingBuild: {
      sources,
      chains: [chain],
      rpcs,
      finalizedBlocks: [
        await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 0 }),
      ],
    },
    onRealtimeEvent: async (event) => {
      if (event.type === "finalize") {
        checkpoint = event.checkpoint;
        promise.resolve();
      }
    },
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
    ordering: "multichain",
  });

  await testClient.mine({ blocks: 4 });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;

  expect(decodeCheckpoint(checkpoint!).blockNumber).toBe(2n);
});

test("onEvent() kills realtime when finalized", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const chain = getChain();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });

  // @ts-ignore
  config.blocks.Blocks.endBlock = 1;

  const { sources, rpcs } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  const promise = promiseWithResolvers<void>();
  let checkpoint: string;

  chain.finalityBlockCount = 0;

  const sync = await createSync({
    syncStore,
    common: context.common,
    indexingBuild: {
      sources,
      chains: [chain],
      rpcs,
      finalizedBlocks: [
        await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 0 }),
      ],
    },
    onRealtimeEvent: async (event) => {
      if (event.type === "finalize") {
        checkpoint = event.checkpoint;
        promise.resolve();
      }
    },
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
    ordering: "multichain",
  });

  await testClient.mine({ blocks: 4 });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;

  expect(decodeCheckpoint(checkpoint!).blockNumber).toBe(1n);
});

test.todo("onEvent() handles reorg");

test("onEvent() handles errors", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const chain = getChain();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources, rpcs } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  const promise = promiseWithResolvers<void>();

  const sync = await createSync({
    syncStore,
    common: context.common,
    indexingBuild: {
      sources,
      chains: [chain],
      rpcs,
      finalizedBlocks: [
        await _eth_getBlockByNumber(rpcs[0]!, { blockNumber: 0 }),
      ],
    },
    onRealtimeEvent: async () => {},
    onFatalError: () => {
      promise.resolve();
    },
    crashRecoveryCheckpoint: undefined,
    ordering: "multichain",
  });

  await testClient.mine({ blocks: 4 });

  await drainAsyncGenerator(sync.getEvents());

  const spy = vi.spyOn(syncStore, "insertTransactions");
  spy.mockRejectedValue(new Error());

  await sync.startRealtime();

  await promise.promise;
});

test("historical events match realtime events", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { config, rawIndexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address,
    includeTransactionReceipts: true,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  const rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 2,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [rpcBlock.transactions[0]!],
    chainId: 1,
  });

  const rpcLogs = await _eth_getLogs(rpc, {
    fromBlock: 2,
    toBlock: 2,
  });
  await syncStore.insertLogs({
    logs: [rpcLogs[0]!],
    chainId: 1,
  });

  const { blockData: historicalBlockData } = await syncStore.getEventBlockData({
    filters: [sources[0]!.filter],
    fromBlock: 0,
    toBlock: 10,
    chainId: 1,
    limit: 3,
  });

  const realtimeBlockData = [
    {
      block: syncBlockToInternal({ block: rpcBlock }),
      logs: rpcLogs.map((log) => syncLogToInternal({ log })),
      transactions: rpcBlock.transactions.map((transaction) =>
        syncTransactionToInternal({ transaction }),
      ),
      transactionReceipts: [],
      traces: [],
    },
  ];

  // Note: blocks and transactions are not asserted because they are non deterministic

  expect(historicalBlockData[0]!.logs).toMatchInlineSnapshot(`
    [
      {
        "address": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        "blockNumber": 2,
        "data": "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
        "logIndex": 0,
        "removed": false,
        "topic0": undefined,
        "topic1": undefined,
        "topic2": undefined,
        "topic3": undefined,
        "topics": [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          null,
        ],
        "transactionIndex": 0,
        Symbol(nodejs.util.inspect.custom): [Function],
      },
    ]
  `);

  expect(realtimeBlockData[0]!.logs).toMatchInlineSnapshot(`
    [
      {
        "address": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        "blockNumber": 2,
        "data": "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
        "logIndex": 0,
        "removed": false,
        "topics": [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        ],
        "transactionIndex": 0,
      },
    ]
  `);
});
