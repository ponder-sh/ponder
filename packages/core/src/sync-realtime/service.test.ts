import { erc20ABI, factoryABI, pairABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { testClient } from "@/_test/utils.js";
import { type SyncBlock, _eth_getBlockByNumber } from "@/sync/index.js";
import { maxCheckpoint } from "@/utils/checkpoint.js";
import { wait } from "@/utils/wait.js";
import { getAbiItem, getEventSelector } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import { syncBlockToLightBlock } from "./format.js";
import {
  create,
  handleBlock,
  handleReorg,
  start,
  validateLocalBlockchainState,
} from "./service.js";

beforeEach((context) => setupAnvil(context));
beforeEach((context) => setupIsolatedDatabase(context));

test("createRealtimeSyncService()", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x0", false],
  });

  const realtimeSyncService = create({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  expect(realtimeSyncService.finalizedBlock.number).toBe(0);
  expect(realtimeSyncService.localChain).toHaveLength(0);
  expect(realtimeSyncService.eventSelectors).toStrictEqual([
    getEventSelector(getAbiItem({ abi: erc20ABI, name: "Transfer" })),
    getEventSelector(getAbiItem({ abi: factoryABI, name: "PairCreated" })),
    getEventSelector(getAbiItem({ abi: pairABI, name: "Swap" })),
  ]);

  await cleanup();
});

test("start() handles block", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x3", false],
  });

  const realtimeSyncService = create({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const queue = await start(realtimeSyncService);
  await queue.onIdle();

  expect(realtimeSyncService.localChain).toHaveLength(1);

  await realtimeSyncService.kill();

  await cleanup();
});

test("start() no-op when receiving same block twice", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x3", false],
  });

  const realtimeSyncService = create({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const queue = await start(realtimeSyncService);

  await _eth_getBlockByNumber(realtimeSyncService, { blockNumber: 4 }).then(
    queue.add,
  );

  await queue.onIdle();

  expect(realtimeSyncService.localChain).toHaveLength(1);

  await realtimeSyncService.kill();

  await cleanup();
});

test("start() gets missing block", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x0", false],
  });

  const insertSpy = vi.spyOn(syncStore, "insertRealtimeBlock");

  const realtimeSyncService = create({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  const queue = await start(realtimeSyncService);

  await queue.onIdle();

  expect(realtimeSyncService.localChain).toHaveLength(4);
  expect(insertSpy).toHaveBeenCalledTimes(2);

  await realtimeSyncService.kill();

  await cleanup();
});

test("start() finds reorg with block number", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x0", false],
  });

  const onEvent = vi.fn();

  const realtimeSyncService = create({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent,
    onFatalError: vi.fn(),
  });

  const queue = await start(realtimeSyncService);

  await _eth_getBlockByNumber(realtimeSyncService, { blockNumber: 3 }).then(
    queue.add,
  );
  await queue.onIdle();

  expect(onEvent).toHaveBeenCalledWith({
    type: "reorg",
    chainId: expect.any(Number),
    safeCheckpoint: expect.any(Object),
  });

  await realtimeSyncService.kill();

  await cleanup();
});

test("start() finds reorg with block hash", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x0", false],
  });

  const onFatalError = vi.fn();

  const realtimeSyncService = create({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent: vi.fn(),
    onFatalError,
  });

  const queue = await start(realtimeSyncService);
  await queue.onIdle();

  await _eth_getBlockByNumber(realtimeSyncService, { blockNumber: 4 }).then(
    (block) => {
      queue.add({
        ...block,
        number: "0x5",
        parentHash: realtimeSyncService.localChain[2].block.hash,
        hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      });
    },
  );
  await queue.onIdle();

  expect(onFatalError).toHaveBeenCalled();

  await realtimeSyncService.kill();

  await cleanup();
});

test("start() retries on error", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x0", false],
  });

  const insertSpy = vi.spyOn(syncStore, "insertRealtimeBlock");

  const realtimeSyncService = create({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  insertSpy.mockRejectedValueOnce(new Error());

  const queue = await start(realtimeSyncService);

  await queue.onIdle();

  expect(realtimeSyncService.localChain).toHaveLength(3);
  expect(insertSpy).toHaveBeenCalledTimes(2);

  await realtimeSyncService.kill();

  await cleanup();
});

test("start() emits fatal error", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x3", false],
  });

  const onFatalError = vi.fn();
  const insertSpy = vi.spyOn(syncStore, "insertRealtimeBlock");

  const realtimeSyncService = create({
    common,
    syncStore,
    network: { ...networks[0], pollingInterval: 10 },
    requestQueue: requestQueues[0],
    sources,
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent: vi.fn(),
    onFatalError,
  });

  insertSpy.mockRejectedValue(new Error());

  const queue = await start(realtimeSyncService);

  await wait(100);

  await queue.onIdle();

  expect(onFatalError).toHaveBeenCalled();

  await realtimeSyncService.kill();

  await cleanup();
}, 20_000);

test("kill()", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x3", false],
  });

  const realtimeSyncService = create({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  start(realtimeSyncService);

  await realtimeSyncService.kill();

  expect(realtimeSyncService.localChain).toHaveLength(0);

  await realtimeSyncService.kill();

  await cleanup();
});

test("handleBlock() ingests block and logs", async (context) => {
  const { common, networks, requestQueues, sources, erc20, factory } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x0", false],
  });

  const onEvent = vi.fn();
  const requestSpy = vi.spyOn(requestQueues[0], "request");

  const realtimeSyncService = create({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent,
    onFatalError: vi.fn(),
  });

  for (let i = 1; i <= 4; i++) {
    await handleBlock(realtimeSyncService, {
      newHeadBlock: await _eth_getBlockByNumber(
        { requestQueue: requestQueues[0] },
        { blockNumber: i },
      ),
    });
  }

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  const transactions = await syncStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();

  expect(blocks).toHaveLength(2);
  expect(logs).toHaveLength(4);
  expect(transactions).toHaveLength(3);

  expect(transactions[0].to).toBe(erc20.address);
  expect(transactions[1].to).toBe(erc20.address);
  expect(transactions[2].to).toBe(factory.pair);

  expect(realtimeSyncService.localChain).toHaveLength(4);

  expect(onEvent).toHaveBeenCalledTimes(4);
  expect(onEvent).toHaveBeenCalledWith({
    type: "checkpoint",
    chainId: expect.any(Number),
    checkpoint: {
      ...maxCheckpoint,
      blockTimestamp: expect.any(Number),
      chainId: expect.any(Number),
      blockNumber: 4,
    },
  });

  expect(requestSpy).toHaveBeenCalledTimes(8);

  await realtimeSyncService.kill();

  await cleanup();
});

test("handleBlock() skips eth_getLogs request", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x0", false],
  });

  const onEvent = vi.fn();
  const requestSpy = vi.spyOn(requestQueues[0], "request");

  const realtimeSyncService = create({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources: [sources[0]],
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent,
    onFatalError: vi.fn(),
  });

  for (let i = 1; i <= 4; i++) {
    await handleBlock(realtimeSyncService, {
      newHeadBlock: await _eth_getBlockByNumber(
        { requestQueue: requestQueues[0] },
        { blockNumber: i },
      ),
    });
  }

  // 2 logs requests are skipped
  expect(requestSpy).toHaveBeenCalledTimes(6);

  await realtimeSyncService.kill();

  await cleanup();
});

test("handleBlock() finalizes range", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x0", false],
  });

  const onEvent = vi.fn();

  const realtimeSyncService = create({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent,
    onFatalError: vi.fn(),
  });

  await testClient.mine({ blocks: 4 });

  for (let i = 1; i <= 8; i++) {
    await handleBlock(realtimeSyncService, {
      newHeadBlock: await _eth_getBlockByNumber(
        { requestQueue: requestQueues[0] },
        { blockNumber: i },
      ),
    });
  }

  const logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: sources[0].chainId,
    logFilter: sources[0].criteria,
  });
  expect(logFilterIntervals).toMatchObject([[1, 4]]);

  const factoryLogFilterIntervals =
    await syncStore.getFactoryLogFilterIntervals({
      chainId: sources[1].chainId,
      factory: sources[1].criteria,
    });
  expect(factoryLogFilterIntervals).toMatchObject([[1, 4]]);

  expect(realtimeSyncService.localChain).toHaveLength(4);

  await realtimeSyncService.kill();

  await cleanup();
});

test("handleReorg() finds common ancestor", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x0", false],
  });

  const onEvent = vi.fn();

  const realtimeSyncService = create({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent,
    onFatalError: vi.fn(),
  });

  for (let i = 1; i <= 3; i++) {
    await handleBlock(realtimeSyncService, {
      newHeadBlock: await _eth_getBlockByNumber(
        { requestQueue: requestQueues[0] },
        { blockNumber: i },
      ),
    });
  }

  realtimeSyncService.localChain[2].block.hash = "0x0";

  await handleReorg(
    realtimeSyncService,
    await _eth_getBlockByNumber(
      { requestQueue: requestQueues[0] },
      { blockNumber: 4 },
    ),
  );

  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);

  expect(realtimeSyncService.localChain).toHaveLength(2);

  expect(onEvent).toHaveBeenCalledWith({
    type: "reorg",
    chainId: expect.any(Number),
    safeCheckpoint: {
      ...maxCheckpoint,
      blockTimestamp: expect.any(Number),
      chainId: expect.any(Number),
      blockNumber: 2,
    },
  });

  await realtimeSyncService.kill();

  await cleanup();
});

test("handleReorg() emits fatal error for deep reorg", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x0", false],
  });

  const onFatalError = vi.fn();

  const realtimeSyncService = create({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent: vi.fn(),
    onFatalError,
  });

  for (let i = 1; i <= 3; i++) {
    await handleBlock(realtimeSyncService, {
      newHeadBlock: await _eth_getBlockByNumber(
        { requestQueue: requestQueues[0] },
        { blockNumber: i },
      ),
    });
  }

  realtimeSyncService.finalizedBlock.hash = "0x1";
  for (let i = 0; i < 3; i++) {
    realtimeSyncService.localChain[i].block.hash = "0x0";
  }

  await handleReorg(
    realtimeSyncService,
    await _eth_getBlockByNumber(
      { requestQueue: requestQueues[0] },
      { blockNumber: 4 },
    ),
  );

  expect(realtimeSyncService.localChain).toHaveLength(0);

  expect(onFatalError).toHaveBeenCalled();

  await realtimeSyncService.kill();

  await cleanup();
});

test("validateLocalBlockchainState()", async (context) => {
  const { common, networks, requestQueues, sources } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const finalizedBlock = await requestQueues[0].request({
    method: "eth_getBlockByNumber",
    params: ["0x0", false],
  });

  const realtimeSyncService = create({
    common,
    syncStore,
    network: networks[0],
    requestQueue: requestQueues[0],
    sources,
    finalizedBlock: finalizedBlock as SyncBlock,
    onEvent: vi.fn(),
    onFatalError: vi.fn(),
  });

  for (let i = 1; i <= 4; i++) {
    await handleBlock(realtimeSyncService, {
      newHeadBlock: await _eth_getBlockByNumber(
        { requestQueue: requestQueues[0] },
        { blockNumber: i },
      ),
    });
  }

  realtimeSyncService.localChain[1].logs[1].logIndex = "0x0";

  const isInvalid = await validateLocalBlockchainState(
    realtimeSyncService,
    await _eth_getBlockByNumber(
      { requestQueue: requestQueues[0] },
      { blockNumber: 4 },
    ).then(syncBlockToLightBlock),
  );

  expect(isInvalid).toBe(true);

  await realtimeSyncService.kill();

  await cleanup();
});
