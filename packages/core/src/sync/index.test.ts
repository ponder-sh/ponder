import { ALICE } from "@/_test/constants.js";
import {
  setupChain,
  setupCleanup,
  setupCommon,
  setupDatabase,
  setupPonder,
} from "@/_test/setup.js";
import { setupAnvil } from "@/_test/setup.js";
import { deployErc20, mintErc20 } from "@/_test/simulate.js";
import {
  getBlocksConfigAndIndexingFunctions,
  getErc20ConfigAndIndexingFunctions,
  testClient,
} from "@/_test/utils.js";
import type { BlockFilter, Event, Filter, Fragment } from "@/internal/types.js";
import { createHistoricalSync } from "@/sync-historical/index.js";
import { createSyncStore } from "@/sync-store/index.js";
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
beforeEach(setupDatabase);
beforeEach(setupCleanup);

test("splitEvents()", async (context) => {
  const chain = setupChain(context);
  const events = [
    {
      checkpoint: "0",
      chain,
      event: {
        block: {
          hash: "0x1",
          timestamp: 1,
          number: 1n,
        },
      },
    },
    {
      checkpoint: "0",
      chain,
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

  expect(result).toHaveLength(2);
  expect(result[0]!.events).toHaveLength(1);
  expect(result[1]!.events).toHaveLength(1);
  expect(result[0]!.events[0]!.checkpoint).toBe("0");
  expect(result[1]!.events[0]!.checkpoint).toBe("0");
  expect(result[0]!.events[0]!.event).toMatchInlineSnapshot(`
    {
      "block": {
        "hash": "0x1",
        "number": 1n,
        "timestamp": 1,
      },
    }
  `);
  expect(result[1]!.events[0]!.event).toMatchInlineSnapshot(`
    {
      "block": {
        "hash": "0x2",
        "number": 2n,
        "timestamp": 2,
      },
    }
  `);
});

test("getPerChainOnRealtimeSyncEvent() handles block", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >();
  for (const { filter } of app.indexingBuild.eventCallbacks) {
    for (const { fragment } of getFragments(filter)) {
      intervalsCache.set(filter, [{ fragment, intervals: [] }]);
    }
  }

  await testClient.mine({ blocks: 1 });

  const syncProgress = await getLocalSyncProgress(app, {
    intervalsCache,
  });

  const onRealtimeSyncEvent = getPerChainOnRealtimeSyncEvent(app, {
    syncProgress,
  });

  const block = await _eth_getBlockByNumber(app.indexingBuild.chain.rpc, {
    blockNumber: 1,
  });

  const event = await onRealtimeSyncEvent({
    type: "block",
    hasMatchedFilter: false,
    block,
    logs: [],
    traces: [],
    transactions: [],
    transactionReceipts: [],
    childAddresses: new Map(),
  });

  expect(event.type).toBe("block");
});

test("getPerChainOnRealtimeSyncEvent() handles finalize", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >();
  for (const { filter } of app.indexingBuild.eventCallbacks) {
    for (const { fragment } of getFragments(filter)) {
      intervalsCache.set(filter, [{ fragment, intervals: [] }]);
    }
  }

  // finalized block: 0

  await testClient.mine({ blocks: 1 });

  const syncProgress = await getLocalSyncProgress(app, {
    intervalsCache,
  });

  const onRealtimeSyncEvent = getPerChainOnRealtimeSyncEvent(app, {
    syncProgress,
  });

  const block = await _eth_getBlockByNumber(app.indexingBuild.chain.rpc, {
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

  const event = await onRealtimeSyncEvent({
    type: "finalize",
    block,
  });

  expect(event.type).toBe("finalize");

  const blocks = await app.database.qb.sync
    .selectFrom("blocks")
    .selectAll()
    .execute();

  expect(blocks).toHaveLength(1);

  const intervals = await app.database.qb.sync
    .selectFrom("intervals")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(1);
  expect(intervals[0]!.blocks).toBe("{[0,2]}");
});

test("getPerChainOnRealtimeSyncEvent() handles reorg", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >();
  for (const { filter } of app.indexingBuild.eventCallbacks) {
    for (const { fragment } of getFragments(filter)) {
      intervalsCache.set(filter, [{ fragment, intervals: [] }]);
    }
  }

  // finalized block: 0

  await testClient.mine({ blocks: 1 });

  const syncProgress = await getLocalSyncProgress(app, {
    intervalsCache,
  });

  const onRealtimeSyncEvent = getPerChainOnRealtimeSyncEvent(app, {
    syncProgress,
  });

  const block = await _eth_getBlockByNumber(app.indexingBuild.chain.rpc, {
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

  const event = await onRealtimeSyncEvent({
    type: "reorg",
    block,
    reorgedBlocks: [block],
  });

  expect(event.type).toBe("reorg");
});

test("getLocalEventGenerator()", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  app.indexingBuild.chain.finalityBlockCount = 0;

  const historicalSync = await createHistoricalSync(app, {
    onFatalError: () => {},
  });

  const syncProgress = await getLocalSyncProgress(app, {
    intervalsCache: historicalSync.intervalsCache,
  });

  const syncGenerator = getLocalSyncGenerator(app, {
    syncProgress,
    historicalSync,
  });

  const eventGenerator = getLocalEventGenerator(app, {
    localSyncGenerator: syncGenerator,
    from: getChainCheckpoint({
      syncProgress,
      chain: app.indexingBuild.chain,
      tag: "start",
    })!,
    to: getChainCheckpoint({
      syncProgress,
      chain: app.indexingBuild.chain,
      tag: "finalized",
    })!,
    limit: 100,
  });

  const events = await drainAsyncGenerator(eventGenerator);
  expect(events).toHaveLength(1);
});

test("getLocalEventGenerator() pagination", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  app.indexingBuild.chain.finalityBlockCount = 0;

  const historicalSync = await createHistoricalSync(app, {
    onFatalError: () => {},
  });

  const syncProgress = await getLocalSyncProgress(app, {
    intervalsCache: historicalSync.intervalsCache,
  });

  const syncGenerator = getLocalSyncGenerator(app, {
    syncProgress,
    historicalSync,
  });

  const eventGenerator = getLocalEventGenerator(app, {
    localSyncGenerator: syncGenerator,
    from: getChainCheckpoint({
      syncProgress,
      chain: app.indexingBuild.chain,
      tag: "start",
    })!,
    to: getChainCheckpoint({
      syncProgress,
      chain: app.indexingBuild.chain,
      tag: "finalized",
    })!,
    limit: 1,
  });

  const events = await drainAsyncGenerator(eventGenerator);
  expect(events.length).toBeGreaterThan(1);
});

test("getLocalSyncGenerator()", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  app.indexingBuild.chain.finalityBlockCount = 0;

  const historicalSync = await createHistoricalSync(app, {
    onFatalError: () => {},
  });

  const syncProgress = await getLocalSyncProgress(app, {
    intervalsCache: historicalSync.intervalsCache,
  });

  const syncGenerator = getLocalSyncGenerator(app, {
    syncProgress,
    historicalSync,
  });

  await drainAsyncGenerator(syncGenerator);

  const intervals = await app.database.qb.sync
    .selectFrom("intervals")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(1);
  expect(intervals[0]!.blocks).toBe("{[0,2]}");
});

test("getLocalSyncGenerator() with partial cache", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  app.indexingBuild.chain.finalityBlockCount = 0;

  let historicalSync = await createHistoricalSync(app, {
    onFatalError: () => {},
  });

  let syncProgress = await getLocalSyncProgress(app, {
    intervalsCache: historicalSync.intervalsCache,
  });

  let syncGenerator = getLocalSyncGenerator(app, {
    syncProgress,
    historicalSync,
  });

  await drainAsyncGenerator(syncGenerator);

  await testClient.mine({ blocks: 1 });

  historicalSync = await createHistoricalSync(app, {
    onFatalError: () => {},
  });

  syncProgress = await getLocalSyncProgress(app, {
    intervalsCache: historicalSync.intervalsCache,
  });

  syncGenerator = getLocalSyncGenerator(app, {
    syncProgress,
    historicalSync,
  });

  await drainAsyncGenerator(syncGenerator);

  const intervals = await app.database.qb.sync
    .selectFrom("intervals")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(1);
  expect(intervals[0]!.blocks).toBe("{[0,3]}");
});

test("getLocalSyncGenerator() with full cache", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  app.indexingBuild.chain.finalityBlockCount = 0;

  let historicalSync = await createHistoricalSync(app, {
    onFatalError: () => {},
  });

  let syncProgress = await getLocalSyncProgress(app, {
    intervalsCache: historicalSync.intervalsCache,
  });

  let syncGenerator = getLocalSyncGenerator(app, {
    syncProgress,
    historicalSync,
  });

  await drainAsyncGenerator(syncGenerator);

  historicalSync = await createHistoricalSync(app, {
    onFatalError: () => {},
  });

  syncProgress = await getLocalSyncProgress(app, {
    intervalsCache: historicalSync.intervalsCache,
  });

  syncGenerator = getLocalSyncGenerator(app, {
    syncProgress,
    historicalSync,
  });

  // const insertSpy = vi.spyOn(syncStore, "insertIntervals");
  const requestSpy = vi.spyOn(app.indexingBuild.chain.rpc, "request");

  const checkpoints = await drainAsyncGenerator(syncGenerator);
  expect(checkpoints).toHaveLength(1);

  // expect(insertSpy).toHaveBeenCalledTimes(0);
  expect(requestSpy).toHaveBeenCalledTimes(0);
});

test("getLocalSyncProgress()", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >();
  for (const { filter } of app.indexingBuild.eventCallbacks) {
    for (const { fragment } of getFragments(filter)) {
      intervalsCache.set(filter, [{ fragment, intervals: [] }]);
    }
  }

  const syncProgress = await getLocalSyncProgress(app, {
    intervalsCache,
  });

  expect(syncProgress.finalized.number).toBe("0x0");
  expect(syncProgress.start.number).toBe("0x0");
  expect(syncProgress.end).toBe(undefined);
  expect(syncProgress.current).toBe(undefined);
});

test("getLocalSyncProgress() future end block", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });

  // @ts-ignore
  config.blocks.Blocks.endBlock = 12;

  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const intervalsCache = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >();
  for (const { filter } of app.indexingBuild.eventCallbacks) {
    for (const { fragment } of getFragments(filter)) {
      intervalsCache.set(filter, [{ fragment, intervals: [] }]);
    }
  }

  const syncProgress = await getLocalSyncProgress(app, {
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

test("mergeAsyncGeneratorsWithEventOrder()", async (context) => {
  const chain = setupChain(context);

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
      { checkpoint: "01", chain },
      { checkpoint: "07", chain },
    ] as unknown as Event[],
    checkpoint: "10",
  });
  p3.resolve({
    events: [
      { checkpoint: "02", chain },
      { checkpoint: "05", chain },
    ] as unknown as Event[],
    checkpoint: "06",
  });

  await new Promise((res) => setTimeout(res));

  p4.resolve({
    events: [
      { checkpoint: "08", chain },
      { checkpoint: "11", chain },
    ] as unknown as Event[],
    checkpoint: "20",
  });
  p2.resolve({
    events: [
      { checkpoint: "08", chain },
      { checkpoint: "13", chain },
    ] as unknown as Event[],
    checkpoint: "20",
  });

  await new Promise((res) => setTimeout(res));

  expect(results.map((r) => r.checkpoints)).toMatchInlineSnapshot(`
    [
      [
        {
          "chainId": 1,
          "checkpoint": "01",
        },
        {
          "chainId": 1,
          "checkpoint": "05",
        },
      ],
      [
        {
          "chainId": 1,
          "checkpoint": "07",
        },
        {
          "chainId": 1,
          "checkpoint": "08",
        },
      ],
      [
        {
          "chainId": 1,
          "checkpoint": "13",
        },
        {
          "chainId": 1,
          "checkpoint": "11",
        },
      ],
    ]
  `);
});

test("createSync()", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions });

  const sync = await createSync(app, {
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
  });

  expect(sync).toBeDefined();
});

test("getEvents() multichain", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  config.ordering = "multichain";
  const app = await setupPonder(context, { config, indexingFunctions });

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  app.indexingBuild[0]!.chain.finalityBlockCount = 0;

  const sync = await createSync(app, {
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
  });

  const events = await drainAsyncGenerator(sync.getEvents()).then((events) =>
    events.flatMap((e) => e.events),
  );

  expect(events).toBeDefined();
  expect(events).toHaveLength(2);
});

test("getEvents() omnichain", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  config.ordering = "omnichain";
  const app = await setupPonder(context, { config, indexingFunctions });

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  app.indexingBuild[0]!.chain.finalityBlockCount = 0;

  const sync = await createSync(app, {
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
  });

  const events = await drainAsyncGenerator(sync.getEvents()).then((events) =>
    events.flatMap((e) => e.events),
  );

  expect(events).toBeDefined();
  expect(events).toHaveLength(2);
});

test("getEvents() mulitchain updates status", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  config.ordering = "multichain";
  const app = await setupPonder(context, { config, indexingFunctions });

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  app.indexingBuild[0]!.chain.finalityBlockCount = 0;

  const sync = await createSync(app, {
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
  });

  const checkpoints = await drainAsyncGenerator(sync.getEvents()).then(
    (events) => events.flatMap((e) => e.checkpoints),
  );

  expect(checkpoints).toMatchInlineSnapshot(`
    [
      {
        "chainId": 1,
        "checkpoint": "174586702500000000000000010000000000000002999999999999999999999999999999999",
      },
    ]
  `);
});

test("getEvents() omnichain updates status", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  config.ordering = "omnichain";
  const app = await setupPonder(context, { config, indexingFunctions });

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  app.indexingBuild[0]!.chain.finalityBlockCount = 0;

  const sync = await createSync(app, {
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
  });

  const checkpoints = await drainAsyncGenerator(sync.getEvents()).then(
    (events) => events.flatMap((e) => e.checkpoints),
  );

  expect(checkpoints).toMatchInlineSnapshot(`
    [
      {
        "chainId": 1,
        "checkpoint": "174586702500000000000000010000000000000002999999999999999999999999999999999",
      },
    ]
  `);
});

test("getEvents() with initial checkpoint", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  config.ordering = "multichain";
  const app = await setupPonder(context, { config, indexingFunctions });

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  app.indexingBuild[0]!.chain.finalityBlockCount = 0;

  const sync = await createSync(app, {
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    crashRecoveryCheckpoint: [
      {
        chainId: 1,
        checkpoint: MAX_CHECKPOINT_STRING,
      },
    ],
  });

  const events = await drainAsyncGenerator(sync.getEvents()).then((events) =>
    events.flatMap((e) => e.events),
  );

  expect(events).toBeDefined();
  expect(events).toHaveLength(0);
});

// Note: this test is causing a flake on ci.
// We need a way to figure out how to make sure queues are drained
// when shutting down.
test.skip("startRealtime()", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions });
  config.ordering = "multichain";

  await testClient.mine({ blocks: 2 });

  const sync = await createSync(app, {
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
  });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  const checkpoints = await drainAsyncGenerator(sync.getEvents()).then(
    (events) => events.flatMap((e) => e.checkpoints),
  );

  expect(checkpoints).toMatchInlineSnapshot(`
    [
      {
        "chainId": 1,
        "checkpoint": "174586702500000000000000010000000000000002999999999999999999999999999999999",
      },
    ]
  `);
});

test("onEvent() multichain handles block", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  config.ordering = "multichain";
  const app = await setupPonder(context, { config, indexingFunctions });
  const promise = promiseWithResolvers<void>();
  const events: Event[] = [];

  await testClient.mine({ blocks: 1 });

  const sync = await createSync(app, {
    onRealtimeEvent: async (event) => {
      if (event.type === "block") {
        events.push(...event.events);
        promise.resolve();
      }
    },
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
  });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;

  expect(events).toHaveLength(1);
});

test("onEvent() omnichain handles block", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  config.ordering = "omnichain";
  const app = await setupPonder(context, { config, indexingFunctions });

  // finalized block: 0

  const promise = promiseWithResolvers<void>();

  const sync = await createSync(app, {
    onRealtimeEvent: async (event) => {
      if (event.type === "block") {
        promise.resolve();
      }
    },
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
  });

  await testClient.mine({ blocks: 1 });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;
});

test("onEvent() handles finalize", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  config.ordering = "multichain";
  const app = await setupPonder(context, { config, indexingFunctions });

  const promise = promiseWithResolvers<void>();
  let checkpoint: string;

  // finalized block: 0

  app.indexingBuild[0]!.chain.finalityBlockCount = 2;

  const sync = await createSync(app, {
    onRealtimeEvent: async (event) => {
      if (event.type === "finalize") {
        checkpoint = event.checkpoint;
        promise.resolve();
      }
    },
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
  });

  await testClient.mine({ blocks: 4 });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;

  expect(decodeCheckpoint(checkpoint!).blockNumber).toBe(2n);
});

test("onEvent() kills realtime when finalized", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  config.ordering = "multichain";

  // @ts-ignore
  config.blocks.Blocks.endBlock = 1;

  const app = await setupPonder(context, { config, indexingFunctions });

  const promise = promiseWithResolvers<void>();
  let checkpoint: string;

  // finalized block: 0

  app.indexingBuild[0]!.chain.finalityBlockCount = 0;

  const sync = await createSync(app, {
    onRealtimeEvent: async (event) => {
      if (event.type === "finalize") {
        checkpoint = event.checkpoint;
        promise.resolve();
      }
    },
    onFatalError: () => {},
    crashRecoveryCheckpoint: undefined,
  });

  await testClient.mine({ blocks: 4 });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;

  expect(decodeCheckpoint(checkpoint!).blockNumber).toBe(1n);
});

test.todo("onEvent() handles reorg");

test.skip("onEvent() handles errors", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  config.ordering = "multichain";
  const app = await setupPonder(context, { config, indexingFunctions });

  const promise = promiseWithResolvers<void>();

  // finalized block: 0

  const sync = await createSync(app, {
    onRealtimeEvent: async () => {},
    onFatalError: () => {
      promise.resolve();
    },
    crashRecoveryCheckpoint: undefined,
  });

  await testClient.mine({ blocks: 4 });

  await drainAsyncGenerator(sync.getEvents());

  // const spy = vi.spyOn(syncStore, "insertTransactions");
  // spy.mockRejectedValue(new Error());

  await sync.startRealtime();

  await promise.promise;
});

test("historical events match realtime events", async (context) => {
  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { config, indexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address,
    includeTransactionReceipts: true,
  });
  const app = await setupPonder(context, { config, indexingFunctions });
  const syncStore = createSyncStore(app);

  const rpcBlock = await _eth_getBlockByNumber(
    app.indexingBuild[0]!.chain.rpc,
    {
      blockNumber: 2,
    },
  );
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [rpcBlock.transactions[0]!],
    chainId: 1,
  });

  const rpcLogs = await _eth_getLogs(app.indexingBuild[0]!.chain.rpc, {
    fromBlock: 2,
    toBlock: 2,
  });
  await syncStore.insertLogs({
    logs: [rpcLogs[0]!],
    chainId: 1,
  });

  const { blockData: historicalBlockData } = await syncStore.getEventBlockData({
    filters: [app.indexingBuild[0]!.eventCallbacks[0]!.filter],
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
