import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { setupAnvil } from "@/_test/setup.js";
import {
  getBlocksConfigAndIndexingFunctions,
  getNetwork,
  testClient,
} from "@/_test/utils.js";
import { buildConfigAndIndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import type {
  BlockFilter,
  Filter,
  Fragment,
  RawEvent,
} from "@/internal/types.js";
import { createHistoricalSync } from "@/sync-historical/index.js";
import { createRealtimeSync } from "@/sync-realtime/index.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import type { Interval } from "@/utils/interval.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import { _eth_getBlockByNumber } from "@/utils/rpc.js";
import { beforeEach, expect, test, vi } from "vitest";
import { getFragments } from "./fragments.js";
import {
  getCachedBlock,
  getChainCheckpoint,
  getLocalEventGenerator,
  getLocalSyncGenerator,
  getLocalSyncProgress,
  getRealtimeSyncEventHandler,
  splitEvents,
} from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("splitEvents()", async () => {
  const events = [
    {
      chainId: 1,
      checkpoint: "0",
      block: {
        hash: "0x1",
        timestamp: 1,
        number: 1n,
      },
      sourceIndex: 0,
    },
    {
      chainId: 1,
      checkpoint: "0",
      block: {
        hash: "0x2",
        timestamp: 2,
        number: 2n,
      },
      sourceIndex: 0,
    },
  ] as unknown as RawEvent[];

  const result = splitEvents(events);

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "checkpoint": "000000000100000000000000010000000000000001999999999999999999999999999999999",
        "events": [
          {
            "block": {
              "hash": "0x1",
              "number": 1n,
              "timestamp": 1,
            },
            "chainId": 1,
            "checkpoint": "0",
            "sourceIndex": 0,
          },
        ],
      },
      {
        "checkpoint": "000000000200000000000000010000000000000002999999999999999999999999999999999",
        "events": [
          {
            "block": {
              "hash": "0x2",
              "number": 2n,
              "timestamp": 2,
            },
            "chainId": 1,
            "checkpoint": "0",
            "sourceIndex": 0,
          },
        ],
      },
    ]
  `);
});

test("getRealtimeSyncEventHandler() handles block", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const network = getNetwork();
  const requestQueue = createRequestQueue({ network, common: context.common });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
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
    network,
    requestQueue,
    intervalsCache,
  });

  const realtimeSync = createRealtimeSync({
    common: context.common,
    network,
    sources,
    requestQueue,
    onEvent: async () => {},
    onFatalError: () => {},
  });

  const onRealtimeSyncEvent = getRealtimeSyncEventHandler({
    common: context.common,
    network,
    sources,
    syncStore,
    syncProgress,
    realtimeSync,
  });

  const block = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
  });

  const event = await onRealtimeSyncEvent({
    type: "block",
    hasMatchedFilter: false,
    block,
    logs: [],
    factoryLogs: [],
    traces: [],
    transactions: [],
    transactionReceipts: [],
  });

  expect(event.type).toBe("block");

  await cleanup();
});

test("getRealtimeSyncEventHandler() handles finalize", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const network = getNetwork();
  const requestQueue = createRequestQueue({ network, common: context.common });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
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

  // finalized block: 0

  await testClient.mine({ blocks: 1 });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    network,
    requestQueue,
    intervalsCache,
  });

  const realtimeSync = createRealtimeSync({
    common: context.common,
    network,
    sources,
    requestQueue,
    onEvent: async () => {},
    onFatalError: () => {},
  });

  const onRealtimeSyncEvent = getRealtimeSyncEventHandler({
    common: context.common,
    network,
    sources,
    syncStore,
    syncProgress,
    realtimeSync,
  });

  const block = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
  });

  await onRealtimeSyncEvent({
    type: "block",
    hasMatchedFilter: true,
    block,
    logs: [],
    factoryLogs: [],
    traces: [],
    transactions: [],
    transactionReceipts: [],
  });

  const event = await onRealtimeSyncEvent({
    type: "finalize",
    block,
  });

  expect(event.type).toBe("finalize");

  const blocks = await database.qb.sync
    .selectFrom("blocks")
    .selectAll()
    .execute();

  expect(blocks).toHaveLength(1);

  const intervals = await database.qb.sync
    .selectFrom("intervals")
    .selectAll()
    .execute();

  expect(intervals).toMatchInlineSnapshot(`
    [
      {
        "blocks": "{[0,2]}",
        "chain_id": 1,
        "fragment_id": "block_1_1_0",
      },
    ]
  `);

  await cleanup();
});

test("getRealtimeSyncEventHandler() kills realtime when finalized", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const network = getNetwork();
  const requestQueue = createRequestQueue({ network, common: context.common });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });

  // @ts-ignore
  config.blocks.Blocks.endBlock = 1;

  const { sources } = await buildConfigAndIndexingFunctions({
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

  // finalized block: 0

  await testClient.mine({ blocks: 1 });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    network,
    requestQueue,
    intervalsCache,
  });

  const realtimeSync = createRealtimeSync({
    common: context.common,
    network,
    sources,
    requestQueue,
    onEvent: async () => {},
    onFatalError: () => {},
  });

  const onRealtimeSyncEvent = getRealtimeSyncEventHandler({
    common: context.common,
    network,
    sources,
    syncStore,
    syncProgress,
    realtimeSync,
  });

  const block = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
  });

  await onRealtimeSyncEvent({
    type: "block",
    hasMatchedFilter: false,
    block,
    logs: [],
    factoryLogs: [],
    traces: [],
    transactions: [],
    transactionReceipts: [],
  });

  const spy = vi.spyOn(realtimeSync, "kill");

  await onRealtimeSyncEvent({
    type: "finalize",
    block,
  });

  expect(spy).toHaveBeenCalled();

  await cleanup();
});

test("getRealtimeSyncEventHandler() handles reorg", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const network = getNetwork();
  const requestQueue = createRequestQueue({ network, common: context.common });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
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

  // finalized block: 0

  await testClient.mine({ blocks: 1 });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    network,
    requestQueue,
    intervalsCache,
  });

  const realtimeSync = createRealtimeSync({
    common: context.common,
    network,
    sources,
    requestQueue,
    onEvent: async () => {},
    onFatalError: () => {},
  });

  const onRealtimeSyncEvent = getRealtimeSyncEventHandler({
    common: context.common,
    network,
    sources,
    syncStore,
    syncProgress,
    realtimeSync,
  });

  const block = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
  });

  await onRealtimeSyncEvent({
    type: "block",
    hasMatchedFilter: true,
    block,
    logs: [],
    factoryLogs: [],
    traces: [],
    transactions: [],
    transactionReceipts: [],
  });

  const event = await onRealtimeSyncEvent({
    type: "reorg",
    block,
    reorgedBlocks: [block],
  });

  expect(event.type).toBe("reorg");

  await cleanup();
});

test("getLocalEventGenerator()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  network.finalityBlockCount = 0;

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    syncStore,
    sources,
    requestQueue: createRequestQueue({ network, common: context.common }),
    onFatalError: () => {},
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    network,
    requestQueue: createRequestQueue({ network, common: context.common }),
    intervalsCache: historicalSync.intervalsCache,
  });

  const syncGenerator = getLocalSyncGenerator({
    common: context.common,
    network,
    syncProgress,
    historicalSync,
  });

  const eventGenerator = getLocalEventGenerator({
    syncStore,
    sources,
    localSyncGenerator: syncGenerator,
    from: getChainCheckpoint({ syncProgress, network, tag: "start" })!,
    to: getChainCheckpoint({ syncProgress, network, tag: "finalized" })!,
    limit: 100,
  });

  const events = await drainAsyncGenerator(eventGenerator);
  expect(events).toHaveLength(1);

  await cleanup();
});

test("getLocalEventGenerator() pagination", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  network.finalityBlockCount = 0;

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    syncStore,
    sources,
    requestQueue: createRequestQueue({ network, common: context.common }),
    onFatalError: () => {},
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    network,
    requestQueue: createRequestQueue({ network, common: context.common }),
    intervalsCache: historicalSync.intervalsCache,
  });

  const syncGenerator = getLocalSyncGenerator({
    common: context.common,
    network,
    syncProgress,
    historicalSync,
  });

  const eventGenerator = getLocalEventGenerator({
    syncStore,
    sources,
    localSyncGenerator: syncGenerator,
    from: getChainCheckpoint({ syncProgress, network, tag: "start" })!,
    to: getChainCheckpoint({ syncProgress, network, tag: "finalized" })!,
    limit: 1,
  });

  const events = await drainAsyncGenerator(eventGenerator);
  expect(events.length).toBeGreaterThan(1);

  await cleanup();
});

test("getLocalSyncGenerator()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  network.finalityBlockCount = 0;

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    syncStore,
    sources,
    requestQueue: createRequestQueue({ network, common: context.common }),
    onFatalError: () => {},
  });

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    network,
    requestQueue: createRequestQueue({ network, common: context.common }),
    intervalsCache: historicalSync.intervalsCache,
  });

  const syncGenerator = getLocalSyncGenerator({
    common: context.common,
    network,
    syncProgress,
    historicalSync,
  });

  await drainAsyncGenerator(syncGenerator);

  const intervals = await database.qb.sync
    .selectFrom("intervals")
    .selectAll()
    .execute();

  expect(intervals).toMatchInlineSnapshot(`
    [
      {
        "blocks": "{[0,2]}",
        "chain_id": 1,
        "fragment_id": "block_1_1_0",
      },
    ]
  `);

  await cleanup();
});

test("getLocalSyncGenerator() with partial cache", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);
  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  network.finalityBlockCount = 0;

  let historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    syncStore,
    sources,
    requestQueue: createRequestQueue({ network, common: context.common }),
    onFatalError: () => {},
  });

  let syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    network,
    requestQueue: createRequestQueue({ network, common: context.common }),
    intervalsCache: historicalSync.intervalsCache,
  });

  let syncGenerator = getLocalSyncGenerator({
    common: context.common,
    network,
    syncProgress,
    historicalSync,
  });

  await drainAsyncGenerator(syncGenerator);

  await testClient.mine({ blocks: 1 });

  historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    syncStore,
    sources,
    requestQueue: createRequestQueue({ network, common: context.common }),
    onFatalError: () => {},
  });

  syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    network,
    requestQueue: createRequestQueue({ network, common: context.common }),
    intervalsCache: historicalSync.intervalsCache,
  });

  syncGenerator = getLocalSyncGenerator({
    common: context.common,
    network,
    syncProgress,
    historicalSync,
  });

  await drainAsyncGenerator(syncGenerator);

  const intervals = await database.qb.sync
    .selectFrom("intervals")
    .selectAll()
    .execute();

  expect(intervals).toMatchInlineSnapshot(`
    [
      {
        "blocks": "{[0,3]}",
        "chain_id": 1,
        "fragment_id": "block_1_1_0",
      },
    ]
  `);

  await cleanup();
});

test("getLocalSyncGenerator() with full cache", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const network = getNetwork();
  const requestQueue = createRequestQueue({ network, common: context.common });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  network.finalityBlockCount = 0;

  let historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    syncStore,
    sources,
    requestQueue,
    onFatalError: () => {},
  });

  let syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    network,
    requestQueue: createRequestQueue({ network, common: context.common }),
    intervalsCache: historicalSync.intervalsCache,
  });

  let syncGenerator = getLocalSyncGenerator({
    common: context.common,
    network,
    syncProgress,
    historicalSync,
  });

  await drainAsyncGenerator(syncGenerator);

  historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    syncStore,
    sources,
    requestQueue: createRequestQueue({ network, common: context.common }),
    onFatalError: () => {},
  });

  syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    network,
    requestQueue: createRequestQueue({ network, common: context.common }),
    intervalsCache: historicalSync.intervalsCache,
  });

  syncGenerator = getLocalSyncGenerator({
    common: context.common,
    network,
    syncProgress,
    historicalSync,
  });

  const insertSpy = vi.spyOn(syncStore, "insertIntervals");
  const requestSpy = vi.spyOn(requestQueue, "request");

  const checkpoints = await drainAsyncGenerator(syncGenerator);
  expect(checkpoints).toHaveLength(1);

  expect(insertSpy).toHaveBeenCalledTimes(0);
  expect(requestSpy).toHaveBeenCalledTimes(0);

  await cleanup();
});

test("getLocalSyncProgress()", async (context) => {
  const network = getNetwork();
  const requestQueue = createRequestQueue({ network, common: context.common });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
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
    network,
    requestQueue,
    intervalsCache,
  });

  expect(syncProgress.finalized.number).toBe("0x0");
  expect(syncProgress.start.number).toBe("0x0");
  expect(syncProgress.end).toBe(undefined);
  expect(syncProgress.current).toBe(undefined);
});

test("getLocalSyncProgress() future end block", async (context) => {
  const network = getNetwork();
  const requestQueue = createRequestQueue({ network, common: context.common });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });

  // @ts-ignore
  config.blocks.Blocks.endBlock = 12;

  const { sources } = await buildConfigAndIndexingFunctions({
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
    network,
    requestQueue,
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
