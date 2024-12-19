import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import {
  createPair,
  deployErc20,
  deployFactory,
  mintErc20,
  swapPair,
  transferErc20,
  transferEth,
} from "@/_test/simulate.js";
import {
  getAccountsConfigAndIndexingFunctions,
  getBlocksConfigAndIndexingFunctions,
  getErc20ConfigAndIndexingFunctions,
  getNetwork,
  getPairWithFactoryConfigAndIndexingFunctions,
  testClient,
} from "@/_test/utils.js";
import { buildConfigAndIndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import type { LogFactory, LogFilter } from "@/sync/source.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import { _eth_getBlockByNumber } from "@/utils/rpc.js";
import {
  encodeFunctionData,
  encodeFunctionResult,
  parseEther,
  toHex,
} from "viem";
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

test("handleBlock() block event with log", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork({ finalityBlockCount: 2 });
  const requestQueue = createRequestQueue({
    network,
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
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const data: Extract<RealtimeSyncEvent, { type: "block" }>[] = [];

  const onEvent = vi.fn(async (_data) => {
    data.push(_data);
  });

  const finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
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

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);

  expect(onEvent).toHaveBeenCalledTimes(1);
  expect(onEvent).toHaveBeenCalledWith({
    type: "block",
    hasMatchedFilter: true,
    block: expect.any(Object),
    logs: expect.any(Object),
    factoryLogs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
  });

  expect(data[0]?.block.number).toBe("0x2");
  expect(data[0]?.logs).toHaveLength(1);
  expect(data[0]?.traces).toHaveLength(0);
  expect(data[0]?.transactions).toHaveLength(1);

  await realtimeSync.kill();

  await cleanup();
});

test("handleBlock() block event with log factory", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork({ finalityBlockCount: 2 });
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { address } = await deployFactory({ sender: ALICE });
  const { result: pair } = await createPair({
    factory: address,
    sender: ALICE,
  });
  await swapPair({
    pair,
    amount0Out: 1n,
    amount1Out: 1n,
    to: ALICE,
    sender: ALICE,
  });

  const { config, rawIndexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const filter = sources[0]!.filter as LogFilter<LogFactory>;

  const data: Extract<RealtimeSyncEvent, { type: "block" }>[] = [];

  const onEvent = vi.fn(async (_data) => {
    data.push(_data);
  });

  const finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
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
    initialChildAddresses: new Map([[filter.address, new Set()]]),
  });
  await queue.onIdle();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(2);

  expect(onEvent).toHaveBeenCalledTimes(2);
  expect(onEvent).toHaveBeenCalledWith({
    type: "block",
    hasMatchedFilter: true,
    block: expect.any(Object),
    logs: expect.any(Object),
    factoryLogs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
  });

  expect(data[0]?.block.number).toBe("0x2");
  expect(data[1]?.block.number).toBe("0x3");

  expect(data[0]?.logs).toHaveLength(0);
  expect(data[1]?.logs).toHaveLength(1);

  expect(data[0]?.factoryLogs).toHaveLength(1);
  expect(data[1]?.factoryLogs).toHaveLength(0);

  expect(data[0]?.traces).toHaveLength(0);
  expect(data[1]?.traces).toHaveLength(0);

  expect(data[0]?.transactions).toHaveLength(0);
  expect(data[1]?.transactions).toHaveLength(1);

  await realtimeSync.kill();

  await cleanup();
});

test("handleBlock() block event with block", async (context) => {
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

  await testClient.mine({ blocks: 1 });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map(),
  });
  await queue.onIdle();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);

  expect(onEvent).toHaveBeenCalledTimes(1);
  expect(onEvent).toHaveBeenCalledWith({
    type: "block",
    hasMatchedFilter: true,
    block: expect.any(Object),
    logs: expect.any(Object),
    factoryLogs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
  });

  expect(data[0]?.block.number).toBe("0x1");
  expect(data[0]?.logs).toHaveLength(0);
  expect(data[0]?.traces).toHaveLength(0);
  expect(data[0]?.transactions).toHaveLength(0);

  await realtimeSync.kill();

  await cleanup();
});

test("handleBlock() block event with transaction", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork({ finalityBlockCount: 2 });
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { config, rawIndexingFunctions } =
    getAccountsConfigAndIndexingFunctions({
      address: ALICE,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
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
    sources: sources.filter(({ filter }) => filter.type === "transaction"),
    onEvent,
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map(),
  });
  await queue.onIdle();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);

  expect(onEvent).toHaveBeenCalledTimes(1);
  expect(onEvent).toHaveBeenCalledWith({
    type: "block",
    hasMatchedFilter: true,
    block: expect.any(Object),
    logs: expect.any(Object),
    factoryLogs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
  });

  expect(data[0]?.block.number).toBe("0x1");
  expect(data[0]?.logs).toHaveLength(0);
  expect(data[0]?.traces).toHaveLength(0);
  expect(data[0]?.transactions).toHaveLength(1);
  expect(data[0]?.transactionReceipts).toHaveLength(1);

  await realtimeSync.kill();

  await cleanup();
});

test("handleBlock() block event with transfer", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork({ finalityBlockCount: 2 });
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { hash } = await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { config, rawIndexingFunctions } =
    getAccountsConfigAndIndexingFunctions({
      address: ALICE,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const request = async (request: any) => {
    if (request.method === "debug_traceBlockByHash") {
      return Promise.resolve([
        {
          txHash: hash,
          result: {
            type: "CALL",
            from: ALICE,
            to: BOB,
            gas: "0x0",
            gasUsed: "0x0",
            input: "0x0",
            output: "0x0",
            value: toHex(parseEther("1")),
          },
        },
      ]);
    }

    return requestQueue.request(request);
  };

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
    requestQueue: {
      ...requestQueue,
      // @ts-ignore
      request,
    },
    sources,
    onEvent,
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map(),
  });
  await queue.onIdle();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);

  expect(onEvent).toHaveBeenCalledTimes(1);
  expect(onEvent).toHaveBeenCalledWith({
    type: "block",
    hasMatchedFilter: true,
    block: expect.any(Object),
    logs: expect.any(Object),
    factoryLogs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
  });

  expect(data[0]?.block.number).toBe("0x1");
  expect(data[0]?.logs).toHaveLength(0);
  expect(data[0]?.traces).toHaveLength(1);
  expect(data[0]?.transactions).toHaveLength(1);
  expect(data[0]?.transactionReceipts).toHaveLength(1);

  await realtimeSync.kill();

  await cleanup();
});

test("handleBlock() block event with trace", async (context) => {
  const { common } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const network = getNetwork({ finalityBlockCount: 2 });
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  await transferErc20({
    erc20: address,
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const block2 = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });

  const block3 = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 3,
  });

  const { config, rawIndexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address,
    includeCallTraces: true,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const request = async (request: any) => {
    if (request.method === "debug_traceBlockByHash") {
      if (request.params[0] === block2.hash) {
        return Promise.resolve([
          {
            txHash: block2.transactions[0]!.hash,
            result: {
              type: "CREATE",
              from: ALICE,
              gas: "0x0",
              gasUsed: "0x0",
              input: "0x0",
              value: "0x0",
            },
          },
        ]);
      }

      if (request.params[0] === block3.hash) {
        return Promise.resolve([
          {
            txHash: block3.transactions[0]!.hash,
            result: {
              type: "CALL",
              from: ALICE,
              to: address,
              gas: "0x0",
              gasUsed: "0x0",
              input: encodeFunctionData({
                abi: erc20ABI,
                functionName: "transfer",
                args: [BOB, parseEther("1")],
              }),
              output: encodeFunctionResult({
                abi: erc20ABI,
                functionName: "transfer",
                result: true,
              }),
              value: "0x0",
            },
          },
        ]);
      }

      return Promise.resolve([]);
    }

    return requestQueue.request(request);
  };

  const data: Extract<RealtimeSyncEvent, { type: "block" }>[] = [];

  const onEvent = vi.fn(async (_data) => {
    data.push(_data);
  });

  const finalizedBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
  });

  const realtimeSync = createRealtimeSync({
    common,
    network,
    requestQueue: {
      ...requestQueue,
      // @ts-ignore
      request,
    },
    sources,
    onEvent,
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map(),
  });
  await queue.onIdle();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(2);

  expect(onEvent).toHaveBeenCalledTimes(2);
  expect(onEvent).toHaveBeenCalledWith({
    type: "block",
    hasMatchedFilter: true,
    block: expect.any(Object),
    logs: expect.any(Object),
    factoryLogs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
  });

  expect(data[0]?.block.number).toBe("0x2");
  expect(data[1]?.block.number).toBe("0x3");

  expect(data[0]?.logs).toHaveLength(1);
  expect(data[1]?.logs).toHaveLength(1);

  expect(data[0]?.traces).toHaveLength(0);
  expect(data[1]?.traces).toHaveLength(1);

  expect(data[0]?.transactions).toHaveLength(1);
  expect(data[1]?.transactions).toHaveLength(1);

  expect(data[0]?.transactionReceipts).toHaveLength(0);
  expect(data[1]?.transactionReceipts).toHaveLength(0);

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
