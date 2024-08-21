import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getRawRPCData, testClient } from "@/_test/utils.js";
import type { SyncTrace } from "@/types/sync.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import { _eth_getBlockByNumber } from "@/utils/rpc.js";
import { beforeEach, expect, test, vi } from "vitest";
import { type RealtimeSyncEvent, createRealtimeSync } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

// Helper function used to spoof "trace_filter" requests
// because they aren't supported by foundry.
const getRequestQueue = async (requestQueue: RequestQueue) => {
  const rpcData = await getRawRPCData();

  return {
    ...requestQueue,
    request: (request: any) => {
      if (request.method === "trace_block") {
        const blockNumber = request.params[0];
        const traces: SyncTrace[] =
          blockNumber === rpcData.block1.block.number
            ? rpcData.block1.traces
            : blockNumber === rpcData.block2.block.number
              ? rpcData.block2.traces
              : blockNumber === rpcData.block3.block.number
                ? rpcData.block3.traces
                : blockNumber === rpcData.block4.block.number
                  ? rpcData.block4.traces
                  : rpcData.block5.traces;

        return Promise.resolve(traces);
      } else return requestQueue.request(request);
    },
  } as RequestQueue;
};

test("createRealtimeSyncService()", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const realtimeSync = createRealtimeSync({
    common,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
    syncStore,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  expect(realtimeSync).toBeDefined();

  await cleanup();
});

test("start() handles block", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(requestQueues[0], {
    blockNumber: 4,
  });

  const realtimeSync = createRealtimeSync({
    common,
    syncStore,
    network: networks[0],
    requestQueue: await getRequestQueue(requestQueues[0]),
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start(finalizedBlock);
  await queue.onIdle();

  expect(realtimeSync.localChain).toHaveLength(1);

  await realtimeSync.kill();

  await cleanup();
});

test("start() no-op when receiving same block twice", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(requestQueues[0], {
    blockNumber: 4,
  });

  const realtimeSync = createRealtimeSync({
    common,
    syncStore,
    network: networks[0],
    requestQueue: await getRequestQueue(requestQueues[0]),
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start(finalizedBlock);
  await queue.onIdle();

  await _eth_getBlockByNumber(requestQueues[0], { blockNumber: 5 }).then(
    // @ts-ignore
    (block) => queue.add({ block }),
  );

  await queue.onIdle();

  expect(realtimeSync.localChain).toHaveLength(1);

  await realtimeSync.kill();

  await cleanup();
});

test("start() gets missing block", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(requestQueues[0], {
    blockNumber: 0,
  });

  const realtimeSync = createRealtimeSync({
    common,
    syncStore,
    network: networks[0],
    requestQueue: await getRequestQueue(requestQueues[0]),
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start(finalizedBlock);

  await queue.onIdle();

  expect(realtimeSync.localChain).toHaveLength(5);

  await realtimeSync.kill();

  await cleanup();
});

test("start() retries on error", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(requestQueues[0], {
    blockNumber: 0,
  });

  const requestQueue = await getRequestQueue(requestQueues[0]);

  const requestSpy = vi.spyOn(requestQueue, "request");

  const realtimeSync = createRealtimeSync({
    common,
    syncStore,
    network: networks[0],
    requestQueue,
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  requestSpy.mockRejectedValueOnce(new Error());

  const queue = await realtimeSync.start(finalizedBlock);

  await queue.onIdle();

  expect(realtimeSync.localChain).toHaveLength(0);

  await realtimeSync.kill();

  await cleanup();
});

test("kill()", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(requestQueues[0], {
    blockNumber: 3,
  });

  const realtimeSync = createRealtimeSync({
    common,
    syncStore,
    network: networks[0],
    requestQueue: await getRequestQueue(requestQueues[0]),
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  await realtimeSync.start(finalizedBlock);

  await realtimeSync.kill();

  expect(realtimeSync.localChain).toHaveLength(0);

  await cleanup();
});

test("handleBlock() block event", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const data: Extract<RealtimeSyncEvent, { type: "block" }>[] = [];

  const onEvent = vi.fn((_data) => data.push(_data));

  const finalizedBlock = await _eth_getBlockByNumber(requestQueues[0], {
    blockNumber: 0,
  });

  const realtimeSync = createRealtimeSync({
    common,
    syncStore,
    network: networks[0],
    requestQueue: await getRequestQueue(requestQueues[0]),
    sources,
    onEvent,
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start(finalizedBlock);
  await queue.onIdle();

  expect(realtimeSync.localChain).toHaveLength(5);

  expect(onEvent).toHaveBeenCalledTimes(5);
  expect(onEvent).toHaveBeenCalledWith({
    type: "block",
    block: expect.any(Object),
    logs: expect.any(Object),
    transactions: expect.any(Object),
    callTraces: expect.any(Object),
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

  expect(data[0]?.callTraces).toHaveLength(0);
  expect(data[1]?.callTraces).toHaveLength(0);
  expect(data[2]?.callTraces).toHaveLength(1);
  expect(data[3]?.callTraces).toHaveLength(1);
  expect(data[4]?.callTraces).toHaveLength(0);

  expect(data[0]?.transactions).toHaveLength(0);
  expect(data[1]?.transactions).toHaveLength(2);
  expect(data[2]?.transactions).toHaveLength(1);
  expect(data[3]?.transactions).toHaveLength(1);
  expect(data[4]?.transactions).toHaveLength(0);

  await realtimeSync.kill();

  await cleanup();
});

test("handleBlock() finalize event", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(requestQueues[0], {
    blockNumber: 0,
  });

  const data: Extract<RealtimeSyncEvent, { type: "finalize" }>[] = [];

  const onEvent = vi.fn((_data) => {
    if (_data.type === "finalize") data.push(_data);
  });

  const realtimeSync = createRealtimeSync({
    common,
    syncStore,
    network: networks[0],
    requestQueue: await getRequestQueue(requestQueues[0]),
    sources,
    onEvent,
    onFatalError: vi.fn(),
  });

  await testClient.mine({ blocks: 4 });

  const queue = await realtimeSync.start(finalizedBlock);
  await queue.onIdle();

  expect(onEvent).toHaveBeenCalledWith({
    type: "finalize",
    block: expect.any(Object),
  });

  expect(realtimeSync.localChain).toHaveLength(5);

  expect(data[0]?.block.number).toBe("0x4");

  await realtimeSync.kill();

  await cleanup();
});

test("handleReorg() finds common ancestor", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(requestQueues[0], {
    blockNumber: 0,
  });

  const onEvent = vi.fn();

  const realtimeSync = createRealtimeSync({
    common,
    syncStore,
    network: networks[0],
    requestQueue: await getRequestQueue(requestQueues[0]),
    sources,
    onEvent,
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start(finalizedBlock);

  await _eth_getBlockByNumber(requestQueues[0], { blockNumber: 3 }).then(
    // @ts-ignore
    (block) => queue.add({ block }),
  );
  await queue.onIdle();

  expect(onEvent).toHaveBeenCalledWith({
    type: "reorg",
    block: expect.any(Object),
  });

  expect(realtimeSync.localChain).toHaveLength(2);

  await realtimeSync.kill();

  await cleanup();
});

test("handleReorg() throws error for deep reorg", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(requestQueues[0], {
    blockNumber: 0,
  });

  const realtimeSync = createRealtimeSync({
    common,
    syncStore,
    network: networks[0],
    requestQueue: await getRequestQueue(requestQueues[0]),
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start(finalizedBlock);
  await queue.onIdle();

  const block = await _eth_getBlockByNumber(requestQueues[0], {
    blockNumber: 5,
  });

  // @ts-ignore
  await queue.add({
    block: {
      ...block,
      number: "0x6",
      hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      parentHash: realtimeSync.localChain[3]!.hash,
    },
  });

  expect(realtimeSync.localChain).toHaveLength(0);

  await realtimeSync.kill();

  await cleanup();
});
