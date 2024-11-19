import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import {
  getBlocksConfigAndIndexingFunctions,
  getNetwork,
  testClient,
} from "@/_test/utils.js";
import { buildConfigAndIndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import { _eth_getBlockByNumber } from "@/utils/rpc.js";
import { beforeEach, expect, test, vi } from "vitest";
import { type RealtimeSyncEvent, createRealtimeSync } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("createRealtimeSyncService()", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const realtimeSync = createRealtimeSync({
    common,
    network,
    requestQueue,
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  expect(realtimeSync).toBeDefined();

  await cleanup();
});

test("start() handles block", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 0,
  });

  await testClient.mine({ blocks: 1 });

  const realtimeSync = createRealtimeSync({
    common,
    network,
    requestQueue,
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map(),
  });
  await queue.onIdle();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);

  await realtimeSync.kill();

  await cleanup();
});

test("start() no-op when receiving same block twice", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 0,
  });

  await testClient.mine({ blocks: 1 });

  const realtimeSync = createRealtimeSync({
    common,
    network,
    requestQueue,
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map(),
  });
  await queue.onIdle();

  await _eth_getBlockByNumber(requestQueue, { blockNumber: 1 }).then(
    // @ts-ignore
    (block) => queue.add({ block }),
  );

  await queue.onIdle();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);

  await realtimeSync.kill();

  await cleanup();
});

test("start() gets missing block", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork({ finalityBlockCount: 2 });
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 0,
  });

  await testClient.mine({ blocks: 2 });

  const realtimeSync = createRealtimeSync({
    common,
    network,
    requestQueue,
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map(),
  });

  await queue.onIdle();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(2);

  await realtimeSync.kill();

  await cleanup();
});

test("start() retries on error", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork({ finalityBlockCount: 2 });
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 0,
  });

  await testClient.mine({ blocks: 1 });

  const requestSpy = vi.spyOn(requestQueue, "request");

  const realtimeSync = createRealtimeSync({
    common,
    network,
    requestQueue,
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  requestSpy.mockRejectedValueOnce(new Error());

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map(),
  });

  await queue.onIdle();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(0);

  await realtimeSync.kill();

  await cleanup();
});

test("kill()", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork({ finalityBlockCount: 2 });
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 0,
  });

  await testClient.mine({ blocks: 2 });

  const realtimeSync = createRealtimeSync({
    common,
    network,
    requestQueue,
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map(),
  });

  await realtimeSync.kill();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(0);

  await cleanup();
});

test.todo("handleBlock() block event", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork({ finalityBlockCount: 2 });
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const data: Extract<RealtimeSyncEvent, { type: "block" }>[] = [];

  const onEvent = vi.fn(async (_data) => {
    data.push(_data);
  });

  const finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 0,
  });

  const realtimeSync = createRealtimeSync({
    common,
    network,
    requestQueue,
    sources,
    onEvent,
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map(),
  });
  await queue.onIdle();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(5);

  expect(onEvent).toHaveBeenCalledTimes(5);
  expect(onEvent).toHaveBeenCalledWith({
    type: "block",
    filters: expect.any(Object),
    block: expect.any(Object),
    logs: expect.any(Object),
    factoryLogs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
  });

  expect(data[0]?.block.number).toBe("0x1");
  expect(data[1]?.block.number).toBe("0x2");
  expect(data[2]?.block.number).toBe("0x3");
  expect(data[3]?.block.number).toBe("0x4");
  expect(data[4]?.block.number).toBe("0x5");

  expect(data[0]?.logs).toHaveLength(0);
  expect(data[1]?.logs).toHaveLength(2);
  expect(data[2]?.logs).toHaveLength(0);
  expect(data[3]?.logs).toHaveLength(1);
  expect(data[4]?.logs).toHaveLength(0);

  expect(data[0]?.traces).toHaveLength(0);
  expect(data[1]?.traces).toHaveLength(0);
  expect(data[2]?.traces).toHaveLength(1);
  expect(data[3]?.traces).toHaveLength(1);
  expect(data[4]?.traces).toHaveLength(0);

  expect(data[0]?.transactions).toHaveLength(0);
  expect(data[1]?.transactions).toHaveLength(2);
  expect(data[2]?.transactions).toHaveLength(1);
  expect(data[3]?.transactions).toHaveLength(1);
  expect(data[4]?.transactions).toHaveLength(0);

  await realtimeSync.kill();

  await cleanup();
});

test("handleBlock() finalize event", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork({ finalityBlockCount: 2 });
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 0,
  });

  const data: Extract<RealtimeSyncEvent, { type: "finalize" }>[] = [];

  const onEvent = vi.fn(async (_data) => {
    if (_data.type === "finalize") data.push(_data);
  });

  const realtimeSync = createRealtimeSync({
    common,
    network,
    requestQueue,
    sources,
    onEvent,
    onFatalError: vi.fn(),
  });

  await testClient.mine({ blocks: 4 });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map(),
  });
  await queue.onIdle();

  expect(onEvent).toHaveBeenCalledWith({
    type: "finalize",
    block: expect.any(Object),
  });

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(2);

  expect(data[0]?.block.number).toBe("0x2");

  await realtimeSync.kill();

  await cleanup();
});

test("handleReorg() finds common ancestor", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork({ finalityBlockCount: 2 });
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const onEvent = vi.fn();

  const finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 0,
  });

  const realtimeSync = createRealtimeSync({
    common,
    network,
    requestQueue,
    sources,
    onEvent,
    onFatalError: vi.fn(),
  });

  await testClient.mine({ blocks: 3 });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map(),
  });

  await _eth_getBlockByNumber(requestQueue, { blockNumber: 2 }).then(
    // @ts-ignore
    (block) => queue.add({ block }),
  );
  await queue.onIdle();

  expect(onEvent).toHaveBeenCalledWith({
    type: "reorg",
    block: expect.any(Object),
    reorgedBlocks: [expect.any(Object), expect.any(Object)],
  });

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);

  await realtimeSync.kill();

  await cleanup();
});

test("handleReorg() throws error for deep reorg", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork({ finalityBlockCount: 2 });
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 0,
  });

  const realtimeSync = createRealtimeSync({
    common,
    network,
    requestQueue,
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  await testClient.mine({ blocks: 3 });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map(),
  });
  await queue.onIdle();

  const block = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 3,
  });

  // @ts-ignore
  await queue.add({
    block: {
      ...block,
      number: "0x4",
      hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      parentHash: realtimeSync.unfinalizedBlocks[1]!.hash,
    },
  });

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(0);

  await realtimeSync.kill();

  await cleanup();
});
