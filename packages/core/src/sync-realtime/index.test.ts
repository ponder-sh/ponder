import {
  type Address,
  createWalletClient,
  getAbiItem,
  type Hex,
  hexToNumber,
  http,
  parseEther,
  RpcRequestError,
  toHex,
} from "viem";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  context,
  setupAnvil,
  setupChildAddresses,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import {
  createPair,
  deployErc20,
  deployFactory,
  mintErc20,
  simulateBlock,
  swapPair,
  transferErc20,
  transferEth,
} from "@/_test/simulate.js";
import {
  anvil,
  getAccountsIndexingBuild,
  getBlocksIndexingBuild,
  getChain,
  getErc20IndexingBuild,
  getPairWithFactoryIndexingBuild,
  testClient,
} from "@/_test/utils.js";
import { buildLogFactory } from "@/build/factory.js";
import type {
  EventCallback,
  LogFactory,
  LogFilter,
  SyncBlockHeader,
  SyncLog,
  TraceFilter,
} from "@/internal/types.js";
import { eth_getBlockByNumber } from "@/rpc/actions.js";
import { createRpc } from "@/rpc/index.js";
import { getFactoryFragmentIds } from "@/runtime/fragments.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { zeroLogsBloom } from "./bloom.js";
import { createRealtimeSync, type RealtimeSyncEvent } from "./index.js";

const staleLogsBloom = `0x${"0".repeat(511)}1` as Hex;

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("createRealtimeSync()", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  expect(realtimeSync).toBeDefined();
});

test("sync() handles block", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain();
  const rpc = createRpc({ chain, common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const blockData = await simulateBlock();

  const syncResult = await drainAsyncGenerator(
    realtimeSync.sync(blockData.block),
  );

  expect(syncResult).toHaveLength(1);
  expect(syncResult[0]!.type).toBe("block");
  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);
});

test("sync() no-op when receiving same block twice", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain();
  const rpc = createRpc({ chain, common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });
  const blockData = await simulateBlock();

  await drainAsyncGenerator(realtimeSync.sync(blockData.block));
  const syncResult = await drainAsyncGenerator(
    realtimeSync.sync(blockData.block),
  );

  expect(syncResult).toHaveLength(0);

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);
});

test("sync() gets missing block", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  await simulateBlock();
  const blockData = await simulateBlock();

  const syncResult = await drainAsyncGenerator(
    realtimeSync.sync(blockData.block),
  );

  expect(syncResult).toHaveLength(2);

  expect(syncResult[0]!.type).toBe("block");
  expect(syncResult[1]!.type).toBe("block");

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(2);
});

test("sync() catches error", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  const { eventCallbacks } = getErc20IndexingBuild({ address });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const blockData = await simulateBlock();

  const requestSpy = vi.spyOn(rpc, "request");
  requestSpy.mockRejectedValueOnce(new Error());

  const syncResult = await drainAsyncGenerator(
    realtimeSync.sync(blockData.block),
  );

  expect(syncResult).toHaveLength(0);

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(0);
});

test("handleBlock() block event with log", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({
    address,
  });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const block = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const syncResult = await drainAsyncGenerator(realtimeSync.sync(block));

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);

  expect(syncResult).toHaveLength(1);
  expect(syncResult[0]).toStrictEqual({
    type: "block",
    blockCallback: undefined,
    hasMatchedFilter: true,
    block: expect.any(Object),
    logs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
    childAddresses: expect.any(Object),
  });

  expect(
    (syncResult[0] as Extract<RealtimeSyncEvent, { type: "block" }>)?.block
      .number,
  ).toBe("0x2");
  expect(
    (syncResult[0] as Extract<RealtimeSyncEvent, { type: "block" }>)?.logs,
  ).toHaveLength(1);
  expect(
    (syncResult[0] as Extract<RealtimeSyncEvent, { type: "block" }>)?.traces,
  ).toHaveLength(0);
  expect(
    (syncResult[0] as Extract<RealtimeSyncEvent, { type: "block" }>)
      ?.transactions,
  ).toHaveLength(1);
});

test("sync() requests logs with address and topics", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const filter = eventCallbacks[0]!.filter as LogFilter;

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);
  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const block = await eth_getBlockByNumber(rpc, ["0x2", true]);
  const requestSpy = vi.spyOn(rpc, "request");

  await drainAsyncGenerator(realtimeSync.sync(block));

  const logsRequests = requestSpy.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === "eth_getLogs");
  expect(logsRequests).toHaveLength(1);
  expect(logsRequests[0]!.params).toStrictEqual([
    {
      blockHash: block.hash,
      address: [filter.address],
      topics: [[filter.topic0]],
    },
  ]);
});

test("sync() requests factory logs for trace filters with a factory address", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  const { address } = await deployFactory({ sender: ALICE });
  await createPair({ factory: address, sender: ALICE });

  const {
    eventCallbacks: [traceEventCallback],
  } = getPairWithFactoryIndexingBuild({ address, includeCallTraces: true });
  const filter = traceEventCallback.filter as TraceFilter<
    undefined,
    LogFactory
  >;

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);
  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks: [traceEventCallback],
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map([[filter.toAddress.id, new Map()]]),
  });

  const block = await eth_getBlockByNumber(rpc, ["0x2", true]);
  const syncResult = await drainAsyncGenerator(realtimeSync.sync(block));

  expect(
    (syncResult[0] as Extract<RealtimeSyncEvent, { type: "block" }>)
      .childAddresses,
  ).toStrictEqual(
    new Map([
      [
        getFactoryFragmentIds(filter.toAddress)[0]!,
        new Set(["0xa16e02e87b7454126e5e10d957a927a7f5b5d2be"]),
      ],
    ]),
  );
});

test("sync() skips log request when bloom does not match on standard chains", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  const { eventCallbacks } = getErc20IndexingBuild({ address });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);
  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const { block } = await simulateBlock();
  const requestSpy = vi.spyOn(rpc, "request");

  await drainAsyncGenerator(
    realtimeSync.sync({ ...block, logsBloom: staleLogsBloom }),
  );

  expect(
    requestSpy.mock.calls.some(([request]) => request.method === "eth_getLogs"),
  ).toBe(false);
});

test("sync() requests logs despite bloom mismatch on async-execution chains", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = { ...getChain({ reorgWindow: 2 }), id: 43114 };
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);
  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const block = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const syncResult = await drainAsyncGenerator(
    realtimeSync.sync({
      ...block,
      logsBloom: staleLogsBloom,
    }),
  );

  expect(syncResult).toHaveLength(1);
  expect(
    (syncResult[0] as Extract<RealtimeSyncEvent, { type: "block" }>)?.logs,
  ).toHaveLength(1);
});

test("sync() handles async-execution block with no logs and non-empty bloom", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = { ...getChain({ reorgWindow: 2 }), id: 43114 };
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  const { eventCallbacks } = getErc20IndexingBuild({ address });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);
  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const { block } = await simulateBlock();

  await drainAsyncGenerator(
    realtimeSync.sync({
      ...block,
      logsBloom: staleLogsBloom,
    }),
  );

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);
});

test("sync() requests logs for async-execution block headers", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = { ...getChain({ reorgWindow: 2 }), id: 43114 };
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);
  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const block = await eth_getBlockByNumber(rpc, ["0x2", true]);
  const requestSpy = vi.spyOn(rpc, "request");

  const syncResult = await drainAsyncGenerator(
    realtimeSync.sync({
      ...block,
      transactions: undefined,
      logsBloom: staleLogsBloom,
    } as SyncBlockHeader),
  );

  const methods = requestSpy.mock.calls.map(([request]) => request.method);
  expect(methods).toContain("eth_getBlockByHash");
  expect(methods).toContain("eth_getLogs");
  expect(syncResult).toHaveLength(1);
  expect(
    (syncResult[0] as Extract<RealtimeSyncEvent, { type: "block" }>)?.logs,
  ).toHaveLength(1);
});

test.each([143, 10143, 43114, 43113])(
  "sync() skips logs bloom warning on async-execution chain %i",
  async (chainId) => {
    const { common } = context;
    await setupDatabaseServices();

    const chain = { ...getChain({ reorgWindow: 2 }), id: chainId };
    const rpc = createRpc({ common, chain });

    const { address } = await deployErc20({ sender: ALICE });
    await mintErc20({
      erc20: address,
      to: ALICE,
      amount: parseEther("1"),
      sender: ALICE,
    });

    const { eventCallbacks } = getErc20IndexingBuild({ address });

    const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);
    const block = await eth_getBlockByNumber(rpc, ["0x2", true]);
    const warnSpy = vi.spyOn(common.logger, "warn");

    const isBloomWarning = () =>
      warnSpy.mock.calls.some(
        ([log]) =>
          log.msg ===
          "Detected inconsistent RPC responses. Log not found in block.logsBloom.",
      );

    await drainAsyncGenerator(
      createRealtimeSync({
        common,
        chain,
        rpc,
        eventCallbacks,
        syncProgress: { finalized: finalizedBlock },
        childAddresses: new Map(),
      }).sync({
        ...block,
        logsBloom: zeroLogsBloom,
      }),
    );

    expect(isBloomWarning()).toBe(false);

    await drainAsyncGenerator(
      createRealtimeSync({
        common,
        chain: { ...chain, id: 1 },
        rpc,
        eventCallbacks,
        syncProgress: { finalized: finalizedBlock },
        childAddresses: new Map(),
      }).sync({ ...block, logsBloom: zeroLogsBloom }),
    );

    expect(isBloomWarning()).toBe(true);
  },
);

test("sync() skips logs bloom warning for unmatched logs", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  // Note: The filter does not match the mint log.
  const { eventCallbacks } = getErc20IndexingBuild({ address: BOB });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);
  const block = await eth_getBlockByNumber(rpc, ["0x2", true]);
  const warnSpy = vi.spyOn(common.logger, "warn");

  await drainAsyncGenerator(
    createRealtimeSync({
      common,
      chain,
      rpc,
      eventCallbacks,
      syncProgress: { finalized: finalizedBlock },
      childAddresses: new Map(),
    }).sync({ ...block, logsBloom: zeroLogsBloom }),
  );

  expect(
    warnSpy.mock.calls.some(
      ([log]) =>
        log.msg ===
        "Detected inconsistent RPC responses. Log not found in block.logsBloom.",
    ),
  ).toBe(false);
});

test("sync() logs bloom warning for factory logs", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  const { address } = await deployFactory({ sender: ALICE });
  await createPair({ factory: address, sender: ALICE });

  // Note: The factory matches the pair creation log, but the filter does not.
  const { eventCallbacks } = getPairWithFactoryIndexingBuild({ address });
  const filter = eventCallbacks[0]!.filter as LogFilter<LogFactory>;

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);
  const block = await eth_getBlockByNumber(rpc, ["0x2", true]);
  const warnSpy = vi.spyOn(common.logger, "warn");

  await drainAsyncGenerator(
    createRealtimeSync({
      common,
      chain,
      rpc,
      eventCallbacks,
      syncProgress: { finalized: finalizedBlock },
      childAddresses: new Map([[filter.address.id, new Map()]]),
    }).sync({ ...block, logsBloom: zeroLogsBloom }),
  );

  expect(
    warnSpy.mock.calls.some(
      ([log]) =>
        log.msg ===
        "Detected inconsistent RPC responses. Log not found in block.logsBloom.",
    ),
  ).toBe(true);
});

test("handleBlock() block event with log factory", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  const { address } = await deployFactory({ sender: ALICE });
  const { address: pair } = await createPair({
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

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({
    address,
  });

  const filter = eventCallbacks[0]!.filter as LogFilter<LogFactory>;

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map([[filter.address.id, new Map()]]),
  });

  let block = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const syncResult1 = await drainAsyncGenerator(realtimeSync.sync(block));

  block = await eth_getBlockByNumber(rpc, ["0x3", true]);

  const syncResult2 = await drainAsyncGenerator(realtimeSync.sync(block));

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(2);

  expect(syncResult1).toHaveLength(1);
  expect(syncResult2).toHaveLength(1);

  const data = [...syncResult1, ...syncResult2] as Extract<
    RealtimeSyncEvent,
    { type: "block" }
  >[];

  expect(data[0]).toStrictEqual({
    type: "block",
    blockCallback: undefined,
    hasMatchedFilter: false,
    block: expect.any(Object),
    logs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
    childAddresses: expect.any(Object),
  });

  expect(data[1]).toStrictEqual({
    type: "block",
    blockCallback: undefined,
    hasMatchedFilter: true,
    block: expect.any(Object),
    logs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
    childAddresses: expect.any(Object),
  });

  expect(data[0]?.block.number).toBe("0x2");
  expect(data[1]?.block.number).toBe("0x3");

  expect(data[0]?.logs).toHaveLength(0);
  expect(data[1]?.logs).toHaveLength(1);

  expect(data[0]?.childAddresses).toStrictEqual(
    new Map([
      [
        getFactoryFragmentIds(filter.address)[0]!,
        new Set(["0xa16e02e87b7454126e5e10d957a927a7f5b5d2be"]),
      ],
    ]),
  );
  expect(data[1]?.childAddresses).toStrictEqual(new Map());

  expect(data[0]?.traces).toHaveLength(0);
  expect(data[1]?.traces).toHaveLength(0);

  expect(data[0]?.transactions).toHaveLength(0);
  expect(data[1]?.transactions).toHaveLength(1);
});

test("handleBlock() block event with factories shared by callbacks", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  const { block: finalizedBlock } = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  const { block } = await transferErc20({
    erc20: address,
    to: BOB,
    amount: 1n,
    sender: ALICE,
  });

  const event = getAbiItem({ abi: erc20ABI, name: "Transfer" });
  const fromFactory = buildLogFactory({
    address,
    event,
    parameter: "from",
    chainId: chain.id,
    sourceId: "From",
    fromBlock: undefined,
    toBlock: undefined,
  });
  const toFactory = buildLogFactory({
    address,
    event,
    parameter: "to",
    chainId: chain.id,
    sourceId: "To",
    fromBlock: undefined,
    toBlock: undefined,
  });

  const { eventCallbacks: templateCallbacks } = getErc20IndexingBuild({
    address,
  });
  const templateCallback = templateCallbacks[0];
  const templateFilter = templateCallback.filter as LogFilter;
  const fromCallback = {
    ...templateCallback,
    filter: { ...templateFilter, address: fromFactory },
  } satisfies EventCallback;
  const eventCallbacks = [
    fromCallback,
    { ...fromCallback, name: `${fromCallback.name}:duplicate` },
    {
      ...templateCallback,
      filter: { ...templateFilter, address: toFactory },
    },
  ] satisfies EventCallback[];

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: setupChildAddresses(eventCallbacks),
  });

  const [blockEvent] = (await drainAsyncGenerator(
    realtimeSync.sync(block),
  )) as Extract<RealtimeSyncEvent, { type: "block" }>[];

  expect(
    blockEvent?.childAddresses.get(getFactoryFragmentIds(fromFactory)[0]!),
  ).toEqual(new Set([ALICE.toLowerCase()]));
  expect(
    blockEvent?.childAddresses.get(getFactoryFragmentIds(toFactory)[0]!),
  ).toEqual(new Set([BOB.toLowerCase()]));
});

test("handleBlock() block event with log factory and no address", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  const { address } = await deployFactory({ sender: ALICE });
  const { address: pair } = await createPair({
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

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({
    address,
  });

  const filter = eventCallbacks[0]!.filter as LogFilter<LogFactory>;

  filter.address.address = undefined;

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map([[filter.address.id, new Map()]]),
  });

  let block = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const syncResult1 = await drainAsyncGenerator(realtimeSync.sync(block));

  block = await eth_getBlockByNumber(rpc, ["0x3", true]);

  const syncResult2 = await drainAsyncGenerator(realtimeSync.sync(block));

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(2);

  expect(syncResult1).toHaveLength(1);
  expect(syncResult2).toHaveLength(1);

  const data = [...syncResult1, ...syncResult2] as Extract<
    RealtimeSyncEvent,
    { type: "block" }
  >[];

  expect(data[0]).toStrictEqual({
    type: "block",
    blockCallback: undefined,
    hasMatchedFilter: false,
    block: expect.any(Object),
    logs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
    childAddresses: expect.any(Object),
  });

  expect(data[1]).toStrictEqual({
    type: "block",
    blockCallback: undefined,
    hasMatchedFilter: true,
    block: expect.any(Object),
    logs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
    childAddresses: expect.any(Object),
  });

  expect(data[0]?.block.number).toBe("0x2");
  expect(data[1]?.block.number).toBe("0x3");

  expect(data[0]?.logs).toHaveLength(0);
  expect(data[1]?.logs).toHaveLength(1);

  expect(data[0]?.childAddresses).toStrictEqual(
    new Map([
      [
        getFactoryFragmentIds(filter.address)[0]!,
        new Set(["0xa16e02e87b7454126e5e10d957a927a7f5b5d2be"]),
      ],
    ]),
  );
  expect(data[1]?.childAddresses).toStrictEqual(new Map());

  expect(data[0]?.traces).toHaveLength(0);
  expect(data[1]?.traces).toHaveLength(0);

  expect(data[0]?.transactions).toHaveLength(0);
  expect(data[1]?.transactions).toHaveLength(1);
});

test("handleBlock() block event with log factory error", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  const { address } = await deployFactory({ sender: ALICE });
  const { address: pair } = await createPair({
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

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({
    address,
  });

  const filter = eventCallbacks[0]!.filter as LogFilter<LogFactory>;

  filter.address.address = undefined;
  // Invalid child address location causes extracting child address to throw an error
  filter.address.childAddressLocation = "topic3";

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map([[filter.address.id, new Map()]]),
  });

  let block = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const syncResult1 = await drainAsyncGenerator(realtimeSync.sync(block));

  block = await eth_getBlockByNumber(rpc, ["0x3", true]);

  const syncResult2 = await drainAsyncGenerator(realtimeSync.sync(block));

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(2);

  expect(syncResult1).toHaveLength(1);
  expect(syncResult2).toHaveLength(1);

  const data = [...syncResult1, ...syncResult2] as Extract<
    RealtimeSyncEvent,
    { type: "block" }
  >[];

  expect(data[0]).toStrictEqual({
    type: "block",
    blockCallback: undefined,
    hasMatchedFilter: false,
    block: expect.any(Object),
    logs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
    childAddresses: expect.any(Object),
  });

  expect(data[1]).toStrictEqual({
    type: "block",
    blockCallback: undefined,
    hasMatchedFilter: false,
    block: expect.any(Object),
    logs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
    childAddresses: expect.any(Object),
  });

  expect(data[0]?.block.number).toBe("0x2");
  expect(data[1]?.block.number).toBe("0x3");

  expect(data[0]?.logs).toHaveLength(0);
  expect(data[1]?.logs).toHaveLength(0);

  expect(data[0]?.traces).toHaveLength(0);
  expect(data[1]?.traces).toHaveLength(0);

  expect(data[0]?.transactions).toHaveLength(0);
  expect(data[1]?.transactions).toHaveLength(0);
});

test("handleBlock() block event with block", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const blockData = await simulateBlock();

  const syncResult = await drainAsyncGenerator(
    realtimeSync.sync(blockData.block),
  );

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);

  expect(syncResult).toHaveLength(1);
  expect(syncResult[0]).toStrictEqual({
    type: "block",
    blockCallback: undefined,
    hasMatchedFilter: true,
    block: expect.any(Object),
    logs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
    childAddresses: expect.any(Object),
  });

  const data = syncResult as Extract<RealtimeSyncEvent, { type: "block" }>[];
  expect(data[0]?.block.number).toBe("0x1");
  expect(data[0]?.logs).toHaveLength(0);
  expect(data[0]?.traces).toHaveLength(0);
  expect(data[0]?.transactions).toHaveLength(0);
});

test("handleBlock() block event with transaction", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getAccountsIndexingBuild({
    address: ALICE,
  });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks: eventCallbacks.filter(
      ({ filter }) => filter.type === "transaction",
    ),
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const block = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const syncResult = await drainAsyncGenerator(realtimeSync.sync(block));

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);

  expect(syncResult).toHaveLength(1);
  expect(syncResult[0]).toStrictEqual({
    type: "block",
    blockCallback: undefined,
    hasMatchedFilter: true,
    block: expect.any(Object),
    logs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
    childAddresses: expect.any(Object),
  });

  const data = syncResult as Extract<RealtimeSyncEvent, { type: "block" }>[];
  expect(data[0]?.block.number).toBe("0x1");
  expect(data[0]?.logs).toHaveLength(0);
  expect(data[0]?.traces).toHaveLength(0);
  expect(data[0]?.transactions).toHaveLength(1);
  expect(data[0]?.transactionReceipts).toHaveLength(1);
  expect(data[0]?.block.transactions).toBe(data[0]?.transactions);
});

test("handleBlock() block event with transfer", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ common, chain });

  await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getAccountsIndexingBuild({
    address: ALICE,
  });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const block = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const syncResult = await drainAsyncGenerator(realtimeSync.sync(block));

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);

  expect(syncResult).toHaveLength(1);
  expect(syncResult[0]).toStrictEqual({
    type: "block",
    blockCallback: undefined,
    hasMatchedFilter: true,
    block: expect.any(Object),
    logs: expect.any(Object),
    transactions: expect.any(Object),
    traces: expect.any(Object),
    transactionReceipts: expect.any(Object),
    childAddresses: expect.any(Object),
  });

  const data = syncResult as Extract<RealtimeSyncEvent, { type: "block" }>[];
  expect(data[0]?.block.number).toBe("0x1");
  expect(data[0]?.logs).toHaveLength(0);
  expect(data[0]?.traces).toHaveLength(1);
  expect(data[0]?.transactions).toHaveLength(1);
  expect(data[0]?.transactionReceipts).toHaveLength(1);
});

test("handleBlock() block event with trace", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 2 });
  const rpc = createRpc({ chain, common });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData2 = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  const blockData3 = await transferErc20({
    erc20: address,
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({
    address,
    includeCallTraces: true,
  });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const syncResult1 = await drainAsyncGenerator(
    realtimeSync.sync(blockData2.block),
  );
  const syncResult2 = await drainAsyncGenerator(
    realtimeSync.sync(blockData3.block),
  );

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(2);

  expect(syncResult1).toHaveLength(1);
  expect(syncResult2).toHaveLength(1);

  const data = [...syncResult1, ...syncResult2] as Extract<
    RealtimeSyncEvent,
    { type: "block" }
  >[];

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
});

test("handleBlock() finalize event", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 0 });
  const rpc = createRpc({
    chain,
    common,
  });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  let blockData = await simulateBlock();
  await drainAsyncGenerator(realtimeSync.sync(blockData.block));

  blockData = await simulateBlock();
  await drainAsyncGenerator(realtimeSync.sync(blockData.block));

  blockData = await simulateBlock();
  await drainAsyncGenerator(realtimeSync.sync(blockData.block));

  blockData = await simulateBlock();
  const syncResult = await drainAsyncGenerator(
    realtimeSync.sync(blockData.block),
  );

  expect(syncResult).toHaveLength(2);
  expect(syncResult[1]).toStrictEqual({
    type: "finalize",
    block: expect.any(Object),
  });

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(0);

  expect(
    (syncResult[1] as Extract<RealtimeSyncEvent, { type: "finalize" }>).block
      .number,
  ).toBe("0x4");
});

test("handleReorg() finds common ancestor", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10 });
  const rpc = createRpc({
    chain,
    common,
  });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const blockData1 = await simulateBlock();
  await drainAsyncGenerator(realtimeSync.sync(blockData1.block));

  const blockData2 = await simulateBlock();
  await drainAsyncGenerator(realtimeSync.sync(blockData2.block));

  const blockData3 = await simulateBlock();
  await drainAsyncGenerator(realtimeSync.sync(blockData3.block));

  const syncResult = await drainAsyncGenerator(
    realtimeSync.sync(blockData2.block),
  );

  expect(syncResult).toHaveLength(1);
  expect(syncResult[0]).toStrictEqual({
    type: "reorg",
    block: expect.any(Object),
    reorgedBlocks: [expect.any(Object), expect.any(Object)],
  });

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);
});

test("handleReorg() removes child addresses with more than one parent", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10 });
  const rpc = createRpc({ common, chain });

  const { address: parentX } = await deployErc20({ sender: ALICE });
  const { address: parentY } = await deployErc20({ sender: ALICE });
  const { block: finalizedBlock } = await simulateBlock();

  const { block: block1 } = await simulateBlock();
  const { block: block2 } = await mintErc20({
    erc20: parentX,
    to: BOB,
    amount: 1n,
    sender: ALICE,
  });
  const { block: block3 } = await mintErc20({
    erc20: parentY,
    to: BOB,
    amount: 1n,
    sender: ALICE,
  });
  const { block: block4 } = await simulateBlock();

  const factory = buildLogFactory({
    address: [parentX, parentY],
    event: getAbiItem({ abi: erc20ABI, name: "Transfer" }),
    parameter: "to",
    chainId: chain.id,
    sourceId: "To",
    fromBlock: undefined,
    toBlock: undefined,
  });

  const { eventCallbacks: templateCallbacks } = getErc20IndexingBuild({
    address: parentX,
  });
  const eventCallbacks = [
    {
      ...templateCallbacks[0],
      filter: {
        ...(templateCallbacks[0].filter as LogFilter),
        address: factory,
      },
    },
  ] satisfies EventCallback[];

  const childAddresses = setupChildAddresses(eventCallbacks);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses,
  });

  const data = (await drainAsyncGenerator(
    realtimeSync.sync(block4),
  )) as Extract<RealtimeSyncEvent, { type: "block" }>[];

  const [fragmentX, fragmentY] = getFactoryFragmentIds(factory);
  const child = BOB.toLowerCase() as Address;

  // Note: Each parent records the child address, so that it is stored for each parent.

  expect(data.map((event) => event.childAddresses)).toStrictEqual([
    new Map(),
    new Map([[fragmentX, new Set([child])]]),
    new Map([[fragmentY, new Set([child])]]),
    new Map(),
  ]);
  expect(childAddresses.get(factory.id)).toStrictEqual(
    new Map([[child, hexToNumber(block2.number)]]),
  );

  // Reorg the block where the second parent emitted the child address.
  await drainAsyncGenerator(realtimeSync.sync(block3));

  expect(childAddresses.get(factory.id)).toStrictEqual(
    new Map([[child, hexToNumber(block2.number)]]),
  );

  // Reorg the block where the child address was first found.
  await drainAsyncGenerator(realtimeSync.sync(block1));

  expect(childAddresses.get(factory.id)).toStrictEqual(new Map());
  expect(realtimeSync.unfinalizedBlocks).toHaveLength(0);
});

test("handleReorg() throws error for deep reorg", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10 });
  const rpc = createRpc({
    chain,
    common,
  });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const blockData1 = await simulateBlock();
  await drainAsyncGenerator(realtimeSync.sync(blockData1.block));

  const blockData2 = await simulateBlock();
  await drainAsyncGenerator(realtimeSync.sync(blockData2.block));

  const blockData3 = await simulateBlock();
  await drainAsyncGenerator(realtimeSync.sync(blockData3.block));

  const requestSpy = vi.spyOn(rpc, "request");
  const warnSpy = vi.spyOn(common.logger, "warn");

  await drainAsyncGenerator(
    realtimeSync.sync({
      ...blockData3.block,
      number: "0x4",
      hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      parentHash: realtimeSync.unfinalizedBlocks[1]!.hash,
    }),
  );

  // Note: Block filters do not require logs.
  expect(
    requestSpy.mock.calls.some(([request]) => request.method === "eth_getLogs"),
  ).toBe(false);
  expect(warnSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      error: expect.objectContaining({
        message: expect.stringContaining("Encountered unrecoverable"),
      }),
    }),
  );

  // block 4 is not added to `unfinalizedBlocks`
  expect(realtimeSync.unfinalizedBlocks).toHaveLength(3);
});

test("sync() range scan emits matched blocks and advances to head", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    reorgWindow: 10,
    experimentalRangeScan: true,
  });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });

  // Finalize at block 2 (deploy + mint).
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  // Block 3: matched transfer. Block 4: empty.
  await transferErc20({ erc20: address, to: BOB, amount: 1n, sender: ALICE });
  await simulateBlock();

  const head = await eth_getBlockByNumber(rpc, ["0x4", true]);

  const requestSpy = vi.spyOn(rpc, "request");
  const syncResult = await drainAsyncGenerator(realtimeSync.sync(head));

  const data = syncResult as Extract<RealtimeSyncEvent, { type: "block" }>[];

  // One matched block (3) plus the empty head (4).
  expect(syncResult).toHaveLength(2);
  expect(data[0]!.hasMatchedFilter).toBe(true);
  expect(data[0]!.block.number).toBe("0x3");
  expect(data[0]!.logs).toHaveLength(1);
  expect(data[1]!.hasMatchedFilter).toBe(false);
  expect(data[1]!.block.number).toBe("0x4");
  expect(data[1]!.logs).toHaveLength(0);

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(2);

  // A single ranged `eth_getLogs` is used, no per-block `eth_getBlockByNumber`,
  // and only the matched block is fetched by hash.
  const methods = requestSpy.mock.calls.map(
    (call) => (call[0] as { method: string }).method,
  );
  expect(methods.filter((m) => m === "eth_getLogs")).toHaveLength(1);
  expect(methods.filter((m) => m === "eth_getBlockByNumber")).toHaveLength(0);
  expect(methods.filter((m) => m === "eth_getBlockByHash")).toHaveLength(1);
});

test("sync() range scan detects reorg of matched block", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    reorgWindow: 10,
    experimentalRangeScan: true,
  });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });

  // Finalize at block 2 (deploy + mint).
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  // Snapshot the chain at block 2, then create a matched block 3.
  const snapshotId = await testClient.snapshot();
  await transferErc20({ erc20: address, to: BOB, amount: 1n, sender: ALICE });

  const head3 = await eth_getBlockByNumber(rpc, ["0x3", true]);
  const syncResult1 = await drainAsyncGenerator(realtimeSync.sync(head3));

  expect(syncResult1.filter((event) => event.type === "block")).toHaveLength(1);
  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);

  // Reorg: revert to block 2 and mine a different (empty) block 3'.
  await testClient.revert({ id: snapshotId });
  await testClient.mine({ blocks: 1 });

  const head3Prime = await eth_getBlockByNumber(rpc, ["0x3", true]);
  const syncResult2 = await drainAsyncGenerator(realtimeSync.sync(head3Prime));

  const reorg = syncResult2.find((event) => event.type === "reorg") as Extract<
    RealtimeSyncEvent,
    { type: "reorg" }
  >;

  // The matched block 3 reorged out; the common ancestor is the finalized block.
  expect(reorg).toBeDefined();
  expect(reorg.block.number).toBe("0x2");
  expect(reorg.reorgedBlocks).toHaveLength(1);

  // The new empty head 3' is ingested in its place.
  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);
  expect(realtimeSync.unfinalizedBlocks[0]!.hash).toBe(head3Prime.hash);
});

test("sync() range scan detects reorg that adds events to an empty block", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    reorgWindow: 10,
    experimentalRangeScan: true,
  });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });

  // Finalize at block 2 (deploy + mint).
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  // Snapshot the chain at block 2, then mine an empty block 3. The head is
  // emitted as an empty block, advancing the local tip past block 3.
  const snapshotId = await testClient.snapshot();
  await simulateBlock();

  const head3 = await eth_getBlockByNumber(rpc, ["0x3", true]);
  const syncResult1 = await drainAsyncGenerator(realtimeSync.sync(head3));

  expect(syncResult1).toHaveLength(1);
  expect(
    (syncResult1[0] as Extract<RealtimeSyncEvent, { type: "block" }>)
      .hasMatchedFilter,
  ).toBe(false);

  // Reorg: revert to block 2 and mine a different block 3' that *does* contain
  // a matched transfer.
  await testClient.revert({ id: snapshotId });
  await transferErc20({ erc20: address, to: BOB, amount: 1n, sender: ALICE });

  const head3Prime = await eth_getBlockByNumber(rpc, ["0x3", true]);
  const syncResult2 = await drainAsyncGenerator(realtimeSync.sync(head3Prime));

  const reorg = syncResult2.find((event) => event.type === "reorg") as Extract<
    RealtimeSyncEvent,
    { type: "reorg" }
  >;

  // The empty block 3 reorged out, back to the finalized block.
  expect(reorg).toBeDefined();
  expect(reorg.block.number).toBe("0x2");

  // The events introduced by the reorg must not be dropped.
  const blocks = syncResult2.filter(
    (event) => event.type === "block",
  ) as Extract<RealtimeSyncEvent, { type: "block" }>[];

  expect(blocks).toHaveLength(1);
  expect(blocks[0]!.hasMatchedFilter).toBe(true);
  expect(blocks[0]!.block.number).toBe("0x3");
  expect(blocks[0]!.block.hash).toBe(head3Prime.hash);
  expect(blocks[0]!.logs).toHaveLength(1);

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);
  expect(realtimeSync.unfinalizedBlocks[0]!.hash).toBe(head3Prime.hash);
});

test("sync() range scan does not re-emit already scanned blocks", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    reorgWindow: 10,
    experimentalRangeScan: true,
  });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });

  // Finalize at block 2 (deploy + mint).
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  // Block 3: matched transfer.
  await transferErc20({ erc20: address, to: BOB, amount: 1n, sender: ALICE });

  const head3 = await eth_getBlockByNumber(rpc, ["0x3", true]);
  await drainAsyncGenerator(realtimeSync.sync(head3));

  // Block 4: empty. Block 3 is still inside the scanned window, so it is
  // returned by the ranged `eth_getLogs` again, but it must not be re-fetched,
  // re-emitted, or mistaken for a reorg.
  await simulateBlock();

  const head4 = await eth_getBlockByNumber(rpc, ["0x4", true]);

  const requestSpy = vi.spyOn(rpc, "request");
  const syncResult = await drainAsyncGenerator(realtimeSync.sync(head4));

  expect(syncResult.filter((event) => event.type === "reorg")).toHaveLength(0);

  const blocks = syncResult.filter(
    (event) => event.type === "block",
  ) as Extract<RealtimeSyncEvent, { type: "block" }>[];

  expect(blocks).toHaveLength(1);
  expect(blocks[0]!.hasMatchedFilter).toBe(false);
  expect(blocks[0]!.block.number).toBe("0x4");

  const methods = requestSpy.mock.calls.map(
    (call) => (call[0] as { method: string }).method,
  );
  expect(methods.filter((m) => m === "eth_getBlockByHash")).toHaveLength(0);
});

test("sync() range scan constrains eth_getLogs by address and topic", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    reorgWindow: 10,
    experimentalRangeScan: true,
  });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });

  // Finalize at block 2 (deploy + mint).
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  await transferErc20({ erc20: address, to: BOB, amount: 1n, sender: ALICE });

  const head = await eth_getBlockByNumber(rpc, ["0x3", true]);

  const requestSpy = vi.spyOn(rpc, "request");
  await drainAsyncGenerator(realtimeSync.sync(head));

  const getLogsRequests = requestSpy.mock.calls
    .map((call) => call[0] as { method: string; params: unknown[] })
    .filter((body) => body.method === "eth_getLogs");

  expect(getLogsRequests).toHaveLength(1);

  const params = getLogsRequests[0]!.params[0] as {
    address: `0x${string}`[];
    topics: `0x${string}`[][];
    fromBlock: `0x${string}`;
    toBlock: `0x${string}`;
  };

  // The request is constrained to the union of the filters' address and
  // `topic0`, not an unfiltered chain-wide scan.
  expect(params.address).toStrictEqual([address.toLowerCase()]);
  expect(params.topics).toStrictEqual([
    [(eventCallbacks[0].filter as LogFilter).topic0.toLowerCase()],
  ]);
  expect(params.fromBlock).toBe("0x3");
  expect(params.toBlock).toBe("0x3");
});

test("sync() range scan splits eth_getLogs when the range is too wide", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    reorgWindow: 10,
    experimentalRangeScan: true,
  });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });

  // Finalize at block 2 (deploy + mint).
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  // Block 3: matched. Block 4: empty. Block 5: matched.
  await transferErc20({ erc20: address, to: BOB, amount: 1n, sender: ALICE });
  await simulateBlock();
  await transferErc20({ erc20: address, to: BOB, amount: 1n, sender: ALICE });

  const head5 = await eth_getBlockByNumber(rpc, ["0x5", true]);

  // Reject the first (three block wide) request the way a provider with a
  // block range cap would.
  const originalRequest = rpc.request.bind(rpc);
  let hasRejected = false;

  const requestSpy = vi
    .spyOn(rpc, "request")
    .mockImplementation(async (body, context) => {
      if (body.method === "eth_getLogs" && hasRejected === false) {
        hasRejected = true;
        throw new RpcRequestError({
          body,
          error: { code: -32000, message: "Max range: 1" },
          url: "http://localhost:8545",
        });
      }
      return originalRequest(body, context);
    });

  const syncResult = await drainAsyncGenerator(realtimeSync.sync(head5));

  const blocks = syncResult.filter(
    (event) => event.type === "block",
  ) as Extract<RealtimeSyncEvent, { type: "block" }>[];

  // Both matched blocks are ingested despite the rejected request.
  expect(blocks).toHaveLength(2);
  expect(blocks[0]!.block.number).toBe("0x3");
  expect(blocks[0]!.logs).toHaveLength(1);
  expect(blocks[1]!.block.number).toBe("0x5");
  expect(blocks[1]!.logs).toHaveLength(1);

  // The rejected request is retried as one request per block.
  const getLogsRanges = () =>
    requestSpy.mock.calls
      .map(
        (call) => call[0] as { method: string; params: { toBlock: string }[] },
      )
      .filter((body) => body.method === "eth_getLogs")
      .map((body) => body.params[0]!.toBlock);

  expect(getLogsRanges()).toStrictEqual(["0x5", "0x3", "0x4", "0x5"]);

  // The narrowed range is remembered, so the next poll doesn't repeat the
  // failing request.
  requestSpy.mockClear();
  await simulateBlock();

  const head6 = await eth_getBlockByNumber(rpc, ["0x6", true]);
  await drainAsyncGenerator(realtimeSync.sync(head6));

  expect(getLogsRanges()).toStrictEqual(["0x3", "0x4", "0x5", "0x6"]);
});

test("sync() range scan warns when the polling interval is too short", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    reorgWindow: 10,
    experimentalRangeScan: true,
  });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const warnSpy = vi.spyOn(common.logger, "warn");

  // One block per poll, which is not enough for the scan to pay off.
  for (let i = 0; i < 12; i++) {
    const { block } = await simulateBlock();
    await drainAsyncGenerator(realtimeSync.sync(block));
  }

  const warnings = warnSpy.mock.calls.filter((call) =>
    (call[0] as { msg: string }).msg.includes(
      "is not reducing RPC usage on this chain",
    ),
  );

  // Warns exactly once, not on every poll.
  expect(warnings).toHaveLength(1);

  const details = warnings[0]![0] as {
    blocks_per_poll: number;
    requests_per_poll: number;
  };

  expect(details.blocks_per_poll).toBe(1);
  expect(details.requests_per_poll).toBe(1);
});

test("sync() range scan does not warn when enough blocks elapse per poll", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    reorgWindow: 10,
    experimentalRangeScan: true,
  });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const warnSpy = vi.spyOn(common.logger, "warn");

  // Five blocks per poll.
  for (let i = 0; i < 12; i++) {
    await testClient.mine({ blocks: 5 });
    const block = await eth_getBlockByNumber(rpc, ["latest", true]);
    await drainAsyncGenerator(realtimeSync.sync(block));
  }

  const warnings = warnSpy.mock.calls.filter((call) =>
    (call[0] as { msg: string }).msg.includes(
      "is not reducing RPC usage on this chain",
    ),
  );

  expect(warnings).toHaveLength(0);
});

test("sync() range scan finalize event", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    reorgWindow: 10,
    experimentalRangeScan: true,
  });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  // Block 3 is matched, block 4 is empty. Both are within the 10 second reorg
  // window of head 4.
  await transferErc20({ erc20: address, to: BOB, amount: 1n, sender: ALICE });
  await simulateBlock();

  const head4 = await eth_getBlockByNumber(rpc, ["0x4", true]);
  const syncResult1 = await drainAsyncGenerator(realtimeSync.sync(head4));

  expect(syncResult1.filter((event) => event.type === "finalize")).toHaveLength(
    0,
  );
  expect(realtimeSync.unfinalizedBlocks.map((block) => block.number)).toEqual([
    "0x3",
    "0x4",
  ]);

  // Block 5 is 20 seconds later, so blocks 3 and 4 leave the reorg window.
  await testClient.increaseTime({ seconds: 20 });
  await simulateBlock();

  const head5 = await eth_getBlockByNumber(rpc, ["0x5", true]);
  const syncResult2 = await drainAsyncGenerator(realtimeSync.sync(head5));

  const finalize = syncResult2.find(
    (event) => event.type === "finalize",
  ) as Extract<RealtimeSyncEvent, { type: "finalize" }>;

  // Finalizes to the newest local block outside the reorg window, the head of
  // the previous poll, and prunes the finalized blocks from the local chain.
  expect(finalize).toBeDefined();
  expect(finalize.block.number).toBe("0x4");
  expect(realtimeSync.unfinalizedBlocks.map((block) => block.number)).toEqual([
    "0x5",
  ]);

  // The next scan starts after the finalized block.
  await simulateBlock();
  const requestSpy = vi.spyOn(rpc, "request");
  const head6 = await eth_getBlockByNumber(rpc, ["0x6", true]);
  await drainAsyncGenerator(realtimeSync.sync(head6));

  const getLogsRequest = requestSpy.mock.calls
    .map((call) => call[0] as { method: string; params: { fromBlock: Hex }[] })
    .find((body) => body.method === "eth_getLogs");
  expect(getLogsRequest!.params[0]!.fromBlock).toBe("0x5");
});

test("sync() range scan throws for reorg beyond the finalized block", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    reorgWindow: 10,
    experimentalRangeScan: true,
  });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });

  // Snapshot at block 1, before the block that will be finalized.
  const snapshotId = await testClient.snapshot();

  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  // Reorg the finalized block itself out from under the local chain, so the
  // new head cannot descend from it.
  await testClient.revert({ id: snapshotId });
  await testClient.mine({ blocks: 2 });

  const head3 = await eth_getBlockByNumber(rpc, ["0x3", true]);
  const block2Prime = await eth_getBlockByNumber(rpc, ["0x2", true]);

  expect(block2Prime.hash).not.toBe(finalizedBlock.hash);

  const warnSpy = vi.spyOn(common.logger, "warn");
  const syncResult = await drainAsyncGenerator(realtimeSync.sync(head3));

  // The error is caught by `sync()`, so assert on the log it emits first.
  expect(
    warnSpy.mock.calls.some((call) =>
      (call[0] as { msg: string }).msg.includes(
        "Encountered unrecoverable reorg",
      ),
    ),
  ).toBe(true);

  expect(syncResult).toHaveLength(0);
  expect(realtimeSync.unfinalizedBlocks).toHaveLength(0);
});

test("sync() range scan batches large address sets", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    reorgWindow: 10,
    experimentalRangeScan: true,
  });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });

  // 51 addresses, so the scan must split into two requests.
  const filler = Array.from(
    { length: 50 },
    (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
  );
  (eventCallbacks[0].filter as LogFilter).address = [address, ...filler];

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  await transferErc20({ erc20: address, to: BOB, amount: 1n, sender: ALICE });

  const head = await eth_getBlockByNumber(rpc, ["0x3", true]);

  const requestSpy = vi.spyOn(rpc, "request");
  const syncResult = await drainAsyncGenerator(realtimeSync.sync(head));

  const addressBatches = requestSpy.mock.calls
    .map(
      (call) =>
        call[0] as unknown as {
          method: string;
          params: { address: `0x${string}`[] }[];
        },
    )
    .filter((body) => body.method === "eth_getLogs")
    .map((body) => body.params[0]!.address.length);

  expect(addressBatches).toStrictEqual([50, 1]);

  // The event is still emitted, from whichever batch matched.
  const blocks = syncResult.filter(
    (event) => event.type === "block",
  ) as Extract<RealtimeSyncEvent, { type: "block" }>[];

  expect(blocks).toHaveLength(1);
  expect(blocks[0]!.logs).toHaveLength(1);
});

test("sync() ignores range scan when a block filter is present", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    reorgWindow: 10,
    experimentalRangeScan: true,
  });
  const rpc = createRpc({ common, chain });

  // Block filters are unsupported on the range-scan path, so the chain falls
  // back to the default per-block sync.
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const blockData = await simulateBlock();
  const syncResult = await drainAsyncGenerator(
    realtimeSync.sync(blockData.block),
  );

  // The default path matches the block filter on the (otherwise empty) block.
  expect(syncResult).toHaveLength(1);
  expect(
    (syncResult[0] as Extract<RealtimeSyncEvent, { type: "block" }>)
      .hasMatchedFilter,
  ).toBe(true);
});

test("sync() range scan matches factory children created in the same scan", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });

  const { address } = await deployFactory({ sender: ALICE });
  const { address: pair } = await createPair({
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

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({ address });
  const filter = eventCallbacks[0]!.filter as LogFilter<LogFactory>;
  const childAddresses = new Map([[filter.address.id, new Map()]]);

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses,
  });

  const head = await eth_getBlockByNumber(rpc, ["0x3", true]);

  const requestSpy = vi.spyOn(rpc, "request");
  const data = (await drainAsyncGenerator(realtimeSync.sync(head))) as Extract<
    RealtimeSyncEvent,
    { type: "block" }
  >[];

  // Block 2 creates the pair. Block 3 is the pair's swap, and the head.
  expect(
    data.map((event) => [
      event.block.number,
      event.hasMatchedFilter,
      event.logs.length,
    ]),
  ).toStrictEqual([
    ["0x2", false, 0],
    ["0x3", true, 1],
  ]);
  expect(data[0]!.childAddresses).toStrictEqual(
    new Map([
      [
        getFactoryFragmentIds(filter.address)[0]!,
        new Set([pair.toLowerCase()]),
      ],
    ]),
  );
  expect(childAddresses.get(filter.address.id)).toStrictEqual(
    new Map([[pair.toLowerCase(), 2]]),
  );

  // One `eth_getLogs` without an address. Only the block that creates the pair
  // is fetched: the head already has its transactions.
  const requests = requestSpy.mock.calls.map(
    (call) => call[0] as { method: string; params: { address?: unknown }[] },
  );
  const getLogsRequests = requests.filter(
    (body) => body.method === "eth_getLogs",
  );
  expect(getLogsRequests).toHaveLength(1);
  expect(getLogsRequests[0]!.params[0]!.address).toBeUndefined();
  expect(
    requests.filter((body) => body.method === "eth_getBlockByHash"),
  ).toHaveLength(1);
});

test("sync() range scan matches factory children created in an earlier poll", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });

  const { address } = await deployFactory({ sender: ALICE });
  const { address: pair } = await createPair({
    factory: address,
    sender: ALICE,
  });

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({ address });
  const filter = eventCallbacks[0]!.filter as LogFilter<LogFactory>;
  const childAddresses = new Map([[filter.address.id, new Map()]]);

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses,
  });

  const head2 = await eth_getBlockByNumber(rpc, ["0x2", true]);
  const data1 = (await drainAsyncGenerator(
    realtimeSync.sync(head2),
  )) as Extract<RealtimeSyncEvent, { type: "block" }>[];

  expect(data1.map((event) => event.block.number)).toStrictEqual(["0x2"]);
  expect(childAddresses.get(filter.address.id)).toStrictEqual(
    new Map([[pair.toLowerCase(), 2]]),
  );

  await swapPair({
    pair,
    amount0Out: 1n,
    amount1Out: 1n,
    to: ALICE,
    sender: ALICE,
  });

  const head3 = await eth_getBlockByNumber(rpc, ["0x3", true]);
  const data2 = (await drainAsyncGenerator(
    realtimeSync.sync(head3),
  )) as Extract<RealtimeSyncEvent, { type: "block" }>[];

  expect(
    data2.map((event) => [event.block.number, event.hasMatchedFilter]),
  ).toStrictEqual([["0x3", true]]);
  expect(data2[0]!.logs).toHaveLength(1);
});

test("sync() range scan skips factory event signatures from other contracts", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });

  const { address } = await deployFactory({ sender: ALICE });
  const { address: otherFactory } = await deployFactory({ sender: ALICE });
  const { address: otherPair } = await createPair({
    factory: otherFactory,
    sender: ALICE,
  });
  await swapPair({
    pair: otherPair,
    amount0Out: 1n,
    amount1Out: 1n,
    to: ALICE,
    sender: ALICE,
  });

  // Only the first factory is indexed.
  const { eventCallbacks } = getPairWithFactoryIndexingBuild({ address });
  const filter = eventCallbacks[0]!.filter as LogFilter<LogFactory>;
  const childAddresses = new Map([[filter.address.id, new Map()]]);

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses,
  });

  const head = await eth_getBlockByNumber(rpc, ["0x4", true]);

  const requestSpy = vi.spyOn(rpc, "request");
  const data = (await drainAsyncGenerator(realtimeSync.sync(head))) as Extract<
    RealtimeSyncEvent,
    { type: "block" }
  >[];

  // The other pair's swap is returned by the scan, but matches no source, so
  // its block isn't fetched. Only the head is emitted.
  expect(
    data.map((event) => [event.block.number, event.hasMatchedFilter]),
  ).toStrictEqual([["0x4", false]]);
  expect(childAddresses.get(filter.address.id)).toStrictEqual(new Map());
  expect(
    requestSpy.mock.calls.filter(
      (call) => (call[0] as { method: string }).method === "eth_getBlockByHash",
    ),
  ).toHaveLength(0);
});

test("sync() range scan removes factory children when their creation is reorged", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });

  const { address } = await deployFactory({ sender: ALICE });
  const snapshotId = await testClient.snapshot();

  const { address: pair } = await createPair({
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

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({ address });
  const filter = eventCallbacks[0]!.filter as LogFilter<LogFactory>;
  const childAddresses = new Map([[filter.address.id, new Map()]]);

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses,
  });

  const head3 = await eth_getBlockByNumber(rpc, ["0x3", true]);
  await drainAsyncGenerator(realtimeSync.sync(head3));

  expect(childAddresses.get(filter.address.id)).toStrictEqual(
    new Map([[pair.toLowerCase(), 2]]),
  );

  // Replace blocks 2 and 3 with empty blocks.
  await testClient.revert({ id: snapshotId });
  await testClient.mine({ blocks: 3 });

  const head4 = await eth_getBlockByNumber(rpc, ["0x4", true]);
  const syncResult = await drainAsyncGenerator(realtimeSync.sync(head4));

  expect(syncResult.map((event) => event.type)).toStrictEqual([
    "reorg",
    "block",
  ]);
  const reorg = syncResult[0] as Extract<RealtimeSyncEvent, { type: "reorg" }>;
  expect(reorg.block.number).toBe("0x1");
  expect(reorg.reorgedBlocks.map((block) => block.number)).toStrictEqual([
    "0x2",
    "0x3",
  ]);
  expect(childAddresses.get(filter.address.id)).toStrictEqual(new Map());
  expect(realtimeSync.unfinalizedBlocks.map((block) => block.number)).toEqual([
    "0x4",
  ]);
});

test("sync() range scan switches to separate requests when the merged request returns many unrelated logs", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });

  const { address } = await deployFactory({ sender: ALICE });
  const { address: pair } = await createPair({
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

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({ address });
  const filter = eventCallbacks[0]!.filter as LogFilter<LogFactory>;

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map([[filter.address.id, new Map()]]),
  });

  // The first scan also returns the factory's event from 1,001 other
  // contracts, as a chain where that signature is common would.
  const originalRequest = rpc.request.bind(rpc);
  let isFirstGetLogs = true;
  const requestSpy = vi
    .spyOn(rpc, "request")
    .mockImplementation(async (body, context) => {
      const response = await originalRequest(body, context);
      if (body.method !== "eth_getLogs" || isFirstGetLogs === false) {
        return response;
      }
      isFirstGetLogs = false;
      const logs = response as SyncLog[];
      const factoryLog = logs.find(
        (log) => log.topics[0] === filter.address.eventSelector,
      )!;
      const unrelatedLogs = Array.from({ length: 1_001 }, (_, i) => ({
        ...factoryLog,
        address: `0x${(i + 1).toString(16).padStart(40, "0")}` as Address,
        logIndex: toHex(1_000 + i),
      }));
      return [...logs, ...unrelatedLogs] as typeof response;
    });

  const head3 = await eth_getBlockByNumber(rpc, ["0x3", true]);
  const data = (await drainAsyncGenerator(realtimeSync.sync(head3))) as Extract<
    RealtimeSyncEvent,
    { type: "block" }
  >[];

  // The unrelated logs match no source.
  expect(
    data.map((event) => [event.block.number, event.logs.length]),
  ).toStrictEqual([
    ["0x2", 0],
    ["0x3", 1],
  ]);

  requestSpy.mockClear();
  await simulateBlock();
  const head4 = await eth_getBlockByNumber(rpc, ["0x4", true]);
  await drainAsyncGenerator(realtimeSync.sync(head4));

  // The next scan requests the factory by address, and the children's events
  // without an address.
  const getLogsParams = requestSpy.mock.calls
    .map(
      (call) =>
        call[0] as {
          method: string;
          params: { address?: Address[]; topics: Hex[][] }[];
        },
    )
    .filter((body) => body.method === "eth_getLogs")
    .map((body) => body.params[0]!);

  expect(getLogsParams.map((params) => params.address)).toStrictEqual([
    [address.toLowerCase()],
    undefined,
  ]);
  expect(getLogsParams.map((params) => params.topics)).toStrictEqual([
    [[filter.address.eventSelector]],
    [[filter.topic0]],
  ]);
});

test("sync() range scan retries when eth_getLogs and the head disagree", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  await transferErc20({ erc20: address, to: BOB, amount: 1n, sender: ALICE });
  const head = await eth_getBlockByNumber(rpc, ["0x3", true]);

  // The scan reports the head block at another hash, as a provider would
  // during a reorg between the two requests.
  const originalRequest = rpc.request.bind(rpc);
  vi.spyOn(rpc, "request").mockImplementation(async (body, context) => {
    const response = await originalRequest(body, context);
    if (body.method !== "eth_getLogs") return response;
    return (response as SyncLog[]).map((log) => ({
      ...log,
      blockHash: `0x${"1".repeat(64)}` as Hex,
    })) as typeof response;
  });

  const warnSpy = vi.spyOn(common.logger, "warn");
  const syncResult = await drainAsyncGenerator(realtimeSync.sync(head));

  expect(syncResult).toHaveLength(0);
  expect(realtimeSync.unfinalizedBlocks).toHaveLength(0);
  expect(warnSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      error: expect.objectContaining({
        message: expect.stringContaining("Inconsistent RPC responses"),
      }),
    }),
  );
});

test("createRealtimeSync() has no log trigger without range scan", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain();
  const rpc = createRpc({ common, chain });
  const { address } = await deployErc20({ sender: ALICE });
  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  expect(realtimeSync.logTrigger).toBeUndefined();
});

test("createRealtimeSync() range scan log trigger subscribes static sources by address", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });
  const { address } = await deployErc20({ sender: ALICE });
  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const filter = eventCallbacks[0]!.filter as LogFilter;
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  expect(realtimeSync.logTrigger!.filters).toStrictEqual([
    { address: [address.toLowerCase()], topics: [[filter.topic0]] },
  ]);
  // A third of the reorg window, and at least `pollingInterval`.
  expect(realtimeSync.logTrigger!.heartbeatInterval).toBe(3_333);

  // `heartbeatInterval` replaces the default.
  const configured = createRealtimeSync({
    common,
    chain: { ...chain, heartbeatInterval: 600_000 },
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });
  expect(configured.logTrigger!.heartbeatInterval).toBe(600_000);
});

test("createRealtimeSync() range scan log trigger matches sources and known children", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });

  const { address } = await deployFactory({ sender: ALICE });
  const { address: pair } = await createPair({
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

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({ address });
  const filter = eventCallbacks[0]!.filter as LogFilter<LogFactory>;
  const childAddresses = new Map([[filter.address.id, new Map()]]);
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses,
  });
  const logTrigger = realtimeSync.logTrigger!;

  // The factory by address, its children by signature alone.
  expect(logTrigger.filters).toStrictEqual([
    {
      address: [address.toLowerCase()],
      topics: [[filter.address.eventSelector]],
    },
    { topics: [[filter.topic0]] },
  ]);

  const [factoryLog] = await rpc.request({
    method: "eth_getLogs",
    params: [{ fromBlock: "0x2", toBlock: "0x2", address }],
  });
  const swapLog = (
    await rpc.request({
      method: "eth_getLogs",
      params: [{ fromBlock: "0x3", toBlock: "0x3", address: pair }],
    })
  ).find((log) => log.topics[0] === filter.topic0)!;
  const otherSwapLog = { ...swapLog, address: BOB.toLowerCase() as Address };

  expect(logTrigger.isTrigger(factoryLog as SyncLog)).toBe(true);
  // The child isn't known until a scan reconciles its creation.
  expect(logTrigger.isTrigger(swapLog as SyncLog)).toBe(false);
  expect(logTrigger.isScanned(factoryLog as SyncLog)).toBe(false);

  const head2 = await eth_getBlockByNumber(rpc, ["0x2", true]);
  await drainAsyncGenerator(realtimeSync.sync(head2));

  expect(logTrigger.isTrigger(swapLog as SyncLog)).toBe(true);
  expect(logTrigger.isTrigger(otherSwapLog as SyncLog)).toBe(false);
  expect(logTrigger.isScanned(factoryLog as SyncLog)).toBe(true);
  expect(logTrigger.isScanned(swapLog as SyncLog)).toBe(false);
});

test("sync() range scan rejects a scan that misses a notified log until eth_getLogs returns it", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  const { log } = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });
  realtimeSync.logTrigger!.expect(log);

  // The node answering `eth_getLogs` hasn't seen the notified block yet.
  const originalRequest = rpc.request.bind(rpc);
  const requestSpy = vi
    .spyOn(rpc, "request")
    .mockImplementation(async (body, context) => {
      if (body.method === "eth_getLogs") return [] as never;
      return originalRequest(body, context);
    });

  const head = await eth_getBlockByNumber(rpc, ["0x2", true]);
  const warnSpy = vi.spyOn(common.logger, "warn");
  const rejected = await drainAsyncGenerator(realtimeSync.sync(head));

  expect(rejected).toHaveLength(0);
  expect(realtimeSync.unfinalizedBlocks).toHaveLength(0);
  expect(warnSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      error: expect.objectContaining({
        message: expect.stringContaining("has a notified log"),
      }),
    }),
  );

  // The next scan, at the same head, returns it: no reorg needed.
  requestSpy.mockRestore();
  const accepted = (await drainAsyncGenerator(
    realtimeSync.sync(head),
  )) as Extract<RealtimeSyncEvent, { type: "block" }>[];

  expect(accepted.map((event) => event.type)).toStrictEqual(["block"]);
  expect(accepted[0]!.logs).toHaveLength(1);
  expect(realtimeSync.logTrigger!.isScanned(log)).toBe(true);
});

test("sync() range scan accepts a scan that misses a notified log after three rejections", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  const { log } = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });
  realtimeSync.logTrigger!.expect(log);

  // As if the notified block was reorged out.
  const originalRequest = rpc.request.bind(rpc);
  vi.spyOn(rpc, "request").mockImplementation(async (body, context) => {
    if (body.method === "eth_getLogs") return [] as never;
    return originalRequest(body, context);
  });

  const head = await eth_getBlockByNumber(rpc, ["0x2", true]);
  for (let i = 0; i < 3; i++) {
    await drainAsyncGenerator(realtimeSync.sync(head));
    expect(realtimeSync.unfinalizedBlocks).toHaveLength(0);
  }

  await drainAsyncGenerator(realtimeSync.sync(head));
  expect(
    realtimeSync.unfinalizedBlocks.map((block) => block.hash),
  ).toStrictEqual([head.hash]);
});

test("createRealtimeSync() gives up on the latest block after failing for 10 minutes", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });
  const { address } = await deployErc20({ sender: ALICE });
  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  // Attempts a heartbeat apart: many fewer than 10 minutes of `pollingInterval`.
  let now = 1_000_000;
  const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
  onTestFinished(() => {
    dateSpy.mockRestore();
  });
  const error = new Error("unavailable");
  for (let i = 0; i < 10; i++) {
    expect(() => realtimeSync.onError(error)).not.toThrow();
    now += 60_000;
  }
  now += 1;
  expect(() => realtimeSync.onError(error)).toThrow(error);
});

test("sync() range scan drops the expectation of a removed notified log", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  const { log } = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });
  realtimeSync.logTrigger!.expect(log);
  // A reorg removed the log before any scan reached its block.
  realtimeSync.logTrigger!.expect({ ...log, removed: true });

  const originalRequest = rpc.request.bind(rpc);
  vi.spyOn(rpc, "request").mockImplementation(async (body, context) => {
    if (body.method === "eth_getLogs") return [] as never;
    return originalRequest(body, context);
  });

  const head = await eth_getBlockByNumber(rpc, ["0x2", true]);
  await drainAsyncGenerator(realtimeSync.sync(head));
  expect(
    realtimeSync.unfinalizedBlocks.map((block) => block.hash),
  ).toStrictEqual([head.hash]);
});

test("sync() range scan re-ingests a block when a later scan returns more of its logs", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });

  const { address: tokenA } = await deployErc20({ sender: ALICE });
  const { address: tokenB } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: tokenA,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  await mintErc20({
    erc20: tokenB,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address: tokenA });

  // 51 addresses: tokenA in the first request, tokenB alone in the second.
  const filler = Array.from(
    { length: 49 },
    (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}` as Address,
  );
  (eventCallbacks[0].filter as LogFilter).address = [
    toLowerCase(tokenA),
    ...filler,
    toLowerCase(tokenB),
  ];

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["latest", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  // One block with a transfer from each token.
  const walletClient = createWalletClient({
    chain: anvil,
    transport: http(),
    account: ALICE,
  });
  for (const erc20 of [tokenA, tokenB]) {
    await walletClient.writeContract({
      abi: erc20ABI,
      functionName: "transfer",
      address: erc20,
      args: [BOB, 1n],
    });
  }
  const { block: head1 } = await simulateBlock();

  // First poll: the node answering the first request is a block behind, and
  // returns no logs for the head.
  const originalRequest = rpc.request.bind(rpc);
  let isLagging = true;
  vi.spyOn(rpc, "request").mockImplementation(async (body, context) => {
    const response = await originalRequest(body, context);
    if (body.method !== "eth_getLogs" || isLagging === false) return response;
    const address = (body.params as { address?: Address[] }[])[0]!.address;
    if (address?.includes(toLowerCase(tokenA)) !== true) return response;
    return (response as SyncLog[]).filter(
      (log) => log.blockNumber !== head1.number,
    ) as typeof response;
  });

  const poll1 = await drainAsyncGenerator(realtimeSync.sync(head1));
  expect(poll1.map((event) => event.type)).toStrictEqual(["block"]);
  expect(
    (poll1[0] as Extract<RealtimeSyncEvent, { type: "block" }>).logs,
  ).toHaveLength(1);

  // Second poll: every node has caught up. The block is rewound and emitted
  // again with both logs.
  isLagging = false;
  const { block: head2 } = await simulateBlock();
  const poll2 = await drainAsyncGenerator(realtimeSync.sync(head2));

  expect(poll2.map((event) => event.type)).toStrictEqual([
    "reorg",
    "block",
    "block",
  ]);
  expect(
    (poll2[0] as Extract<RealtimeSyncEvent, { type: "reorg" }>).block.hash,
  ).toBe(finalizedBlock.hash);

  const reingested = poll2[1] as Extract<RealtimeSyncEvent, { type: "block" }>;
  expect(reingested.block.hash).toBe(head1.hash);
  expect(reingested.logs.map((log) => toLowerCase(log.address))).toStrictEqual([
    toLowerCase(tokenA),
    toLowerCase(tokenB),
  ]);

  // A later scan that returns fewer logs than were ingested doesn't rewind.
  isLagging = true;
  const { block: head3 } = await simulateBlock();
  const poll3 = await drainAsyncGenerator(realtimeSync.sync(head3));
  expect(poll3.map((event) => event.type)).toStrictEqual(["block"]);
});

test("sync() range scan grows a narrowed block range back", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 100, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  // Reject the first request with an error that halves the range without
  // stating a limit.
  const originalRequest = rpc.request.bind(rpc);
  let hasRejected = false;
  const requestSpy = vi
    .spyOn(rpc, "request")
    .mockImplementation(async (body, context) => {
      if (body.method === "eth_getLogs" && hasRejected === false) {
        hasRejected = true;
        throw new RpcRequestError({
          body,
          error: { code: -32000, message: "backend response too large" },
          url: "http://localhost:8545",
        });
      }
      return originalRequest(body, context);
    });

  const getLogsRanges = () =>
    requestSpy.mock.calls
      .map(
        (call) =>
          call[0] as {
            method: string;
            params: { fromBlock: Hex; toBlock: Hex }[];
          },
      )
      .filter((body) => body.method === "eth_getLogs")
      .map((body) => [body.params[0]!.fromBlock, body.params[0]!.toBlock]);

  // Poll 1 narrows the range to two blocks: [3, 4] and [5, 5].
  await simulateBlock();
  await simulateBlock();
  const { block: head5 } = await simulateBlock();
  await drainAsyncGenerator(realtimeSync.sync(head5));

  // Poll 2 uses two-block requests and grows the range to three blocks.
  requestSpy.mockClear();
  const { block: head6 } = await simulateBlock();
  await drainAsyncGenerator(realtimeSync.sync(head6));
  expect(getLogsRanges()).toStrictEqual([
    ["0x3", "0x4"],
    ["0x5", "0x6"],
  ]);

  // Poll 3 uses three-block requests.
  requestSpy.mockClear();
  const { block: head7 } = await simulateBlock();
  await drainAsyncGenerator(realtimeSync.sync(head7));
  expect(getLogsRanges()).toStrictEqual([
    ["0x3", "0x5"],
    ["0x6", "0x7"],
  ]);
});

test("sync() range scan matches factory children after a failed poll", async () => {
  const { common } = context;
  await setupDatabaseServices();

  // One `eth_getLogs` request per block, so that the requests of one scan can
  // be answered by different nodes.
  const chain = {
    ...getChain({ reorgWindow: 100, experimentalRangeScan: true }),
    ethGetLogsBlockRange: 1,
  };
  const rpc = createRpc({ common, chain });

  // Block 1: factory. Block 2: pair A. Block 3: swap on pair A.
  // Block 4: pair B. Block 5: empty head.
  const { address } = await deployFactory({ sender: ALICE });
  const { address: pairA } = await createPair({
    factory: address,
    sender: ALICE,
  });
  await swapPair({
    pair: pairA,
    amount0Out: 1n,
    amount1Out: 1n,
    to: ALICE,
    sender: ALICE,
  });
  await createPair({ factory: address, sender: ALICE });
  const { block: head5 } = await simulateBlock();

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({ address });
  const filter = eventCallbacks[0]!.filter as LogFilter<LogFactory>;

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map([[filter.address.id, new Map()]]),
  });

  // Poll 1: the node answering the request for block 2 is behind and misses
  // pair A's creation, so the swap in block 3 matches nothing. Fetching block 4
  // fails, so the poll fails.
  const originalRequest = rpc.request.bind(rpc);
  let isFaulty = true;
  vi.spyOn(rpc, "request").mockImplementation(async (body, context) => {
    if (isFaulty && body.method === "eth_getBlockByHash") {
      throw new Error("Simulated block fetch failure");
    }
    const response = await originalRequest(body, context);
    if (isFaulty && body.method === "eth_getLogs") {
      const params = (body.params as { fromBlock: Hex }[])[0]!;
      if (params.fromBlock === "0x2") return [] as typeof response;
    }
    return response;
  });

  const poll1 = await drainAsyncGenerator(realtimeSync.sync(head5));
  expect(poll1).toHaveLength(0);

  // Poll 2: every node has caught up. Pair A's creation makes the swap match.
  isFaulty = false;
  const { block: head6 } = await simulateBlock();
  const poll2 = await drainAsyncGenerator(realtimeSync.sync(head6));

  const blocks = poll2.filter((event) => event.type === "block") as Extract<
    RealtimeSyncEvent,
    { type: "block" }
  >[];

  expect(blocks.map((event) => event.block.number)).toStrictEqual([
    "0x2",
    "0x3",
    "0x4",
    "0x6",
  ]);
  expect(blocks[1]!.logs).toHaveLength(1);
  expect(toLowerCase(blocks[1]!.logs[0]!.address)).toBe(toLowerCase(pairA));
});

test("sync() range scan matches factory children after a reorg and a failed poll", async () => {
  const { common } = context;
  await setupDatabaseServices();

  // One `eth_getLogs` request per block, so that the requests of one scan can
  // be answered by different nodes.
  const chain = {
    ...getChain({ reorgWindow: 100, experimentalRangeScan: true }),
    ethGetLogsBlockRange: 1,
  };
  const rpc = createRpc({ common, chain });

  // Block 1: factory. Block 2: pair A. Block 3: swap on pair A.
  const { address } = await deployFactory({ sender: ALICE });
  const { address: pairA } = await createPair({
    factory: address,
    sender: ALICE,
  });
  await swapPair({
    pair: pairA,
    amount0Out: 1n,
    amount1Out: 1n,
    to: ALICE,
    sender: ALICE,
  });
  const snapshotId = await testClient.snapshot();

  // Block 4: empty head.
  const { block: head4 } = await simulateBlock();

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({ address });
  const filter = eventCallbacks[0]!.filter as LogFilter<LogFactory>;

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map([[filter.address.id, new Map()]]),
  });

  const originalRequest = rpc.request.bind(rpc);
  let isLagging = true;
  let isFetchFailing = false;
  vi.spyOn(rpc, "request").mockImplementation(async (body, context) => {
    if (isFetchFailing && body.method === "eth_getBlockByHash") {
      throw new Error("Simulated block fetch failure");
    }
    const response = await originalRequest(body, context);
    if (isLagging && body.method === "eth_getLogs") {
      const params = (body.params as { fromBlock: Hex }[])[0]!;
      if (params.fromBlock === "0x2") return [] as typeof response;
    }
    return response;
  });

  // Poll 1 succeeds. The node answering the request for block 2 is behind and
  // misses pair A's creation, so the swap in block 3 matches nothing.
  await drainAsyncGenerator(realtimeSync.sync(head4));

  // A reorg replaces block 4 with a block that creates pair B.
  await testClient.revert({ id: snapshotId });
  await createPair({ factory: address, sender: ALICE });
  const { block: head5 } = await simulateBlock();

  // Poll 2 rewinds the local chain to the finalized block, below block 3, and
  // then fails to fetch the new block 4.
  isFetchFailing = true;
  const poll2 = await drainAsyncGenerator(realtimeSync.sync(head5));
  expect(poll2.map((event) => event.type)).toStrictEqual(["reorg"]);

  // Poll 3: every node has caught up and nothing fails. Pair A's creation
  // makes the swap match.
  isLagging = false;
  isFetchFailing = false;
  const { block: head6 } = await simulateBlock();
  const poll3 = await drainAsyncGenerator(realtimeSync.sync(head6));

  const blocks = poll3.filter((event) => event.type === "block") as Extract<
    RealtimeSyncEvent,
    { type: "block" }
  >[];

  expect(blocks.map((event) => event.block.number)).toStrictEqual([
    "0x2",
    "0x3",
    "0x4",
    "0x6",
  ]);
  expect(blocks[1]!.logs).toHaveLength(1);
  expect(toLowerCase(blocks[1]!.logs[0]!.address)).toBe(toLowerCase(pairA));
});

/** A range-scanning realtime sync of an ERC-20 with one transfer. */
const setupRangeScanCostSync = async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    reorgWindow: 10,
    experimentalRangeScan: true,
  });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const warnSpy = vi.spyOn(common.logger, "warn");
  const getCostWarnings = () =>
    warnSpy.mock.calls.filter((call) =>
      (call[0] as { msg: string }).msg.includes(
        "is not reducing RPC usage on this chain",
      ),
    );

  /** Mine `blocks` blocks without logs, then scan the head with `logsBloom`. */
  const poll = async (blocks: number, logsBloom: Hex) => {
    await testClient.mine({ blocks });
    const block = await eth_getBlockByNumber(rpc, ["latest", true]);
    await drainAsyncGenerator(realtimeSync.sync({ ...block, logsBloom }));
  };

  return { realtimeSync, getCostWarnings, poll };
};

// Note: a full bloom matches every filter; a single set bit matches none here.
const fullLogsBloom = `0x${"ff".repeat(256)}` as Hex;
const unrelatedLogsBloom = `0x${"00".repeat(255)}01` as Hex;

test("sync() range scan counts bloom matches in the per-block estimate", async () => {
  const { getCostWarnings, poll } = await setupRangeScanCostSync();

  // Two blocks per poll whose blooms match the filter, without matching logs:
  // the per-block sync would request their logs, so the scan is cheaper.
  for (let i = 0; i < 12; i++) await poll(2, fullLogsBloom);

  expect(getCostWarnings()).toHaveLength(0);
});

test("sync() range scan warns when heads' blooms match no filter", async () => {
  const { getCostWarnings, poll } = await setupRangeScanCostSync();

  // The same two blocks per poll, with blooms that match no filter: the
  // per-block sync would fetch only the blocks.
  for (let i = 0; i < 12; i++) await poll(2, unrelatedLogsBloom);

  expect(getCostWarnings()).toHaveLength(1);
});

test("sync() range scan samples only polls made while log notifications are down", async () => {
  const { realtimeSync, getCostWarnings, poll } =
    await setupRangeScanCostSync();

  // Scans driven by notifications and the heartbeat are never sampled.
  realtimeSync.logTrigger!.setPolling(false);
  for (let i = 0; i < 12; i++) await poll(2, unrelatedLogsBloom);
  expect(getCostWarnings()).toHaveLength(0);

  // Polls made while the subscription is down are.
  realtimeSync.logTrigger!.setPolling(true);
  for (let i = 0; i < 12; i++) await poll(2, unrelatedLogsBloom);
  expect(getCostWarnings()).toHaveLength(1);
});

test("sync() range scan finalizes all but its reorg window when a scan spans more than it", async () => {
  const { common } = context;
  await setupDatabaseServices();

  // Note: as on a chain whose `pollingInterval`, or heartbeat with log
  // notifications, is longer than its reorg window.
  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x2", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  // Blocks 3 and 4 hold a transfer each, 20 s apart, and head 5 is 20 s
  // after block 4: one scan covers 40 s against a 10 s window.
  const { log } = await transferErc20({
    erc20: address,
    to: BOB,
    amount: 1n,
    sender: ALICE,
  });
  await testClient.increaseTime({ seconds: 20 });
  await transferErc20({ erc20: address, to: BOB, amount: 1n, sender: ALICE });
  await testClient.increaseTime({ seconds: 20 });
  await simulateBlock();

  const head5 = await eth_getBlockByNumber(rpc, ["0x5", true]);
  const events = await drainAsyncGenerator(realtimeSync.sync(head5));

  // Both transfers are indexed, then everything outside the window of head 5
  // is finalized at once.
  const blocks = events.filter((event) => event.type === "block") as Extract<
    RealtimeSyncEvent,
    { type: "block" }
  >[];
  expect(
    blocks.map((event) => [event.block.number, event.logs.length]),
  ).toStrictEqual([
    ["0x3", 1],
    ["0x4", 1],
    ["0x5", 0],
  ]);
  const finalize = events.find((event) => event.type === "finalize") as Extract<
    RealtimeSyncEvent,
    { type: "finalize" }
  >;
  expect(finalize.block.number).toBe("0x4");
  expect(realtimeSync.unfinalizedBlocks.map((block) => block.number)).toEqual([
    "0x5",
  ]);

  // A notification for a block that is now finalized arrives late: it is
  // scanned already, and its expectation never rejects a scan. The next scan
  // starts after the finalized block.
  realtimeSync.logTrigger!.expect(log);
  expect(realtimeSync.logTrigger!.isScanned(log)).toBe(true);
  await simulateBlock();
  const warnSpy = vi.spyOn(common.logger, "warn");
  const head6 = await eth_getBlockByNumber(rpc, ["0x6", true]);
  await drainAsyncGenerator(realtimeSync.sync(head6));
  expect(warnSpy).not.toHaveBeenCalled();
  expect(realtimeSync.unfinalizedBlocks.map((block) => block.number)).toEqual([
    "0x5",
    "0x6",
  ]);
});

test("createRealtimeSync() range scan log trigger reports a failed scan until one succeeds", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ reorgWindow: 10, experimentalRangeScan: true });
  const rpc = createRpc({ common, chain });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({ address });
  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });
  expect(realtimeSync.logTrigger!.hasFailed()).toBe(false);

  const originalRequest = rpc.request.bind(rpc);
  const requestSpy = vi
    .spyOn(rpc, "request")
    .mockImplementation(async (body, context) => {
      if (body.method === "eth_getLogs") throw new Error("unavailable");
      return originalRequest(body, context);
    });

  const head = await eth_getBlockByNumber(rpc, ["0x2", true]);
  await drainAsyncGenerator(realtimeSync.sync(head));
  expect(realtimeSync.logTrigger!.hasFailed()).toBe(true);

  requestSpy.mockRestore();
  await drainAsyncGenerator(realtimeSync.sync(head));
  expect(realtimeSync.logTrigger!.hasFailed()).toBe(false);
});
