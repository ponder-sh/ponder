import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getRawRPCData, testClient } from "@/_test/utils.js";
import type { Rpc } from "@/rpc/index.js";
import type { SyncTrace } from "@/types/sync.js";
import { _eth_getBlockByNumber } from "@/utils/rpc.js";
import { beforeEach, expect, test, vi } from "vitest";
import { type RealtimeSyncEvent, createRealtimeSync } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

// Helper function used to spoof "trace_filter" requests
// because they aren't supported by foundry.
const getRpc = async (rpc: Rpc) => {
  const rpcData = await getRawRPCData();

  return {
    ...rpc,
    request: (request: any) => {
      if (request.method === "trace_block") {
        const blockNumber = request.params[0];
        const traces: SyncTrace[] =
          blockNumber === rpcData.block1.block.number
            ? rpcData.block1.callTraces
            : blockNumber === rpcData.block2.block.number
              ? rpcData.block2.callTraces
              : blockNumber === rpcData.block3.block.number
                ? rpcData.block3.callTraces
                : blockNumber === rpcData.block4.block.number
                  ? rpcData.block4.callTraces
                  : rpcData.block5.callTraces;

        return Promise.resolve(traces);
      } else return rpc.request(request);
    },
  } as Rpc;
};

test("createRealtimeSyncService()", async (context) => {
  const { common, networks, rpcs, sources } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const realtimeSync = createRealtimeSync({
    common,
    network: networks[0],
    rpc: rpcs[0],
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  expect(realtimeSync).toBeDefined();

  await cleanup();
});

test("start() handles block", async (context) => {
  const { common, networks, rpcs, sources } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(rpcs[0], {
    blockNumber: 4,
  });

  const realtimeSync = createRealtimeSync({
    common,
    network: networks[0],
    rpc: await getRpc(rpcs[0]),
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
  const { common, networks, rpcs, sources } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(rpcs[0], {
    blockNumber: 4,
  });

  const realtimeSync = createRealtimeSync({
    common,
    network: networks[0],
    rpc: await getRpc(rpcs[0]),
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map(),
  });
  await queue.onIdle();

  await _eth_getBlockByNumber(rpcs[0], { blockNumber: 5 }).then(
    // @ts-ignore
    (block) => queue.add({ block }),
  );

  await queue.onIdle();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);

  await realtimeSync.kill();

  await cleanup();
});

test("start() gets missing block", async (context) => {
  const { common, networks, rpcs, sources } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(rpcs[0], {
    blockNumber: 0,
  });

  const realtimeSync = createRealtimeSync({
    common,
    network: networks[0],
    rpc: await getRpc(rpcs[0]),
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map([
      [sources[1].filter.address, new Set()],
      [sources[2].filter.toAddress, new Set()],
    ]),
  });

  await queue.onIdle();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(5);

  await realtimeSync.kill();

  await cleanup();
});

test("start() retries on error", async (context) => {
  const { common, networks, rpcs, sources } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(rpcs[0], {
    blockNumber: 0,
  });

  const rpc = await getRpc(rpcs[0]);

  const requestSpy = vi.spyOn(rpc, "request");

  const realtimeSync = createRealtimeSync({
    common,
    network: networks[0],
    rpc,
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  requestSpy.mockRejectedValueOnce(new Error());

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map([
      [sources[1].filter.address, new Set()],
      [sources[2].filter.toAddress, new Set()],
    ]),
  });

  await queue.onIdle();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(0);

  await realtimeSync.kill();

  await cleanup();
});

test("kill()", async (context) => {
  const { common, networks, rpcs, sources } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(rpcs[0], {
    blockNumber: 3,
  });

  const realtimeSync = createRealtimeSync({
    common,
    network: networks[0],
    rpc: await getRpc(rpcs[0]),
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map([
      [sources[1].filter.address, new Set()],
      [sources[2].filter.toAddress, new Set()],
    ]),
  });

  await realtimeSync.kill();

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(0);

  await cleanup();
});

test("handleBlock() block event", async (context) => {
  const { common, networks, rpcs, sources } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const data: Extract<RealtimeSyncEvent, { type: "block" }>[] = [];

  const onEvent = vi.fn(async (_data) => {
    data.push(_data);
  });

  const finalizedBlock = await _eth_getBlockByNumber(rpcs[0], {
    blockNumber: 0,
  });

  const realtimeSync = createRealtimeSync({
    common,
    network: networks[0],
    rpc: await getRpc(rpcs[0]),
    sources,
    onEvent,
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map([
      [sources[1].filter.address, new Set()],
      [sources[2].filter.toAddress, new Set()],
    ]),
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
  const { common, networks, rpcs, sources } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(rpcs[0], {
    blockNumber: 0,
  });

  const data: Extract<RealtimeSyncEvent, { type: "finalize" }>[] = [];

  const onEvent = vi.fn(async (_data) => {
    if (_data.type === "finalize") data.push(_data);
  });

  const realtimeSync = createRealtimeSync({
    common,
    network: networks[0],
    rpc: await getRpc(rpcs[0]),
    sources,
    onEvent,
    onFatalError: vi.fn(),
  });

  await testClient.mine({ blocks: 4 });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map([
      [sources[1].filter.address, new Set()],
      [sources[2].filter.toAddress, new Set()],
    ]),
  });
  await queue.onIdle();

  expect(onEvent).toHaveBeenCalledWith({
    type: "finalize",
    block: expect.any(Object),
  });

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(5);

  expect(data[0]?.block.number).toBe("0x4");

  await realtimeSync.kill();

  await cleanup();
});

test("handleReorg() finds common ancestor", async (context) => {
  const { common, networks, rpcs, sources } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(rpcs[0], {
    blockNumber: 0,
  });

  const onEvent = vi.fn();

  const realtimeSync = createRealtimeSync({
    common,
    network: networks[0],
    rpc: await getRpc(rpcs[0]),
    sources,
    onEvent,
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map([
      [sources[1].filter.address, new Set()],
      [sources[2].filter.toAddress, new Set()],
    ]),
  });

  await _eth_getBlockByNumber(rpcs[0], { blockNumber: 3 }).then(
    // @ts-ignore
    (block) => queue.add({ block }),
  );
  await queue.onIdle();

  expect(onEvent).toHaveBeenCalledWith({
    type: "reorg",
    block: expect.any(Object),
    reorgedBlocks: [expect.any(Object), expect.any(Object), expect.any(Object)],
  });

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(2);

  await realtimeSync.kill();

  await cleanup();
});

test("handleReorg() throws error for deep reorg", async (context) => {
  const { common, networks, rpcs, sources } = context;
  const { cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await _eth_getBlockByNumber(rpcs[0], {
    blockNumber: 0,
  });

  const realtimeSync = createRealtimeSync({
    common,
    network: networks[0],
    rpc: await getRpc(rpcs[0]),
    sources,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const queue = await realtimeSync.start({
    syncProgress: { finalized: finalizedBlock },
    initialChildAddresses: new Map([
      [sources[1].filter.address, new Set()],
      [sources[2].filter.toAddress, new Set()],
    ]),
  });
  await queue.onIdle();

  const block = await _eth_getBlockByNumber(rpcs[0], {
    blockNumber: 5,
  });

  // @ts-ignore
  await queue.add({
    block: {
      ...block,
      number: "0x6",
      hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      parentHash: realtimeSync.unfinalizedBlocks[3]!.hash,
    },
  });

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(0);

  await realtimeSync.kill();

  await cleanup();
});
