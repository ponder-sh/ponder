import { getAbiItem, type Hex, parseEther, RpcRequestError } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
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
  getAccountsIndexingBuild,
  getBlocksIndexingBuild,
  getChain,
  getErc20IndexingBuild,
  getPairWithFactoryIndexingBuild,
  testClient,
} from "@/_test/utils.js";
import { buildLogFactory } from "@/build/factory.js";
import type { EventCallback, LogFactory, LogFilter } from "@/internal/types.js";
import { eth_getBlockByNumber } from "@/rpc/actions.js";
import { createRpc } from "@/rpc/index.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
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

  const chain = getChain({ finalityBlockCount: 2 });
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

  const chain = getChain({ finalityBlockCount: 2 });
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

  const chain = getChain({ finalityBlockCount: 2 });
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

test("sync() skips log request when bloom does not match on standard chains", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ finalityBlockCount: 2 });
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

  const chain = { ...getChain({ finalityBlockCount: 2 }), id: 143 };
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
  ).toBe(true);
});

test("handleBlock() block event with log factory", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ finalityBlockCount: 2 });
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

  expect(data[0]?.childAddresses).toMatchObject(
    new Map([
      [
        {
          address: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
          chainId: 1,
          childAddressLocation: "topic1",
          eventSelector:
            "0x17aa8d0e85db1d0531a8181b5bb84e1d4ed744db1cadd8814acd3d181ff30137",
          fromBlock: undefined,
          id: "log_0x5fbdb2315678afecb367f032d93f642f64180aa3_1_topic1_0x17aa8d0e85db1d0531a8181b5bb84e1d4ed744db1cadd8814acd3d181ff30137_undefined_undefined",
          sourceId: "Pair",
          toBlock: undefined,
          type: "log",
        },
        new Set(["0xa16e02e87b7454126e5e10d957a927a7f5b5d2be"]),
      ],
    ]),
  );
  expect(data[1]?.childAddresses).toMatchObject(
    new Map([
      [
        {
          address: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
          chainId: 1,
          childAddressLocation: "topic1",
          eventSelector:
            "0x17aa8d0e85db1d0531a8181b5bb84e1d4ed744db1cadd8814acd3d181ff30137",
          fromBlock: undefined,
          id: "log_0x5fbdb2315678afecb367f032d93f642f64180aa3_1_topic1_0x17aa8d0e85db1d0531a8181b5bb84e1d4ed744db1cadd8814acd3d181ff30137_undefined_undefined",
          sourceId: "Pair",
          toBlock: undefined,
          type: "log",
        },
        new Set(),
      ],
    ]),
  );

  expect(data[0]?.traces).toHaveLength(0);
  expect(data[1]?.traces).toHaveLength(0);

  expect(data[0]?.transactions).toHaveLength(0);
  expect(data[1]?.transactions).toHaveLength(1);
});

test("handleBlock() block event with factories shared by callbacks", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ finalityBlockCount: 2 });
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

  expect(blockEvent?.childAddresses.get(fromFactory)).toEqual(
    new Set([ALICE.toLowerCase()]),
  );
  expect(blockEvent?.childAddresses.get(toFactory)).toEqual(
    new Set([BOB.toLowerCase()]),
  );
});

test("handleBlock() block event with log factory and no address", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ finalityBlockCount: 2 });
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

  expect(data[0]?.childAddresses.size).toBe(1);

  expect(data[0]?.childAddresses).toMatchObject(
    new Map([
      [
        {
          address: undefined,
          chainId: 1,
          childAddressLocation: "topic1",
          eventSelector:
            "0x17aa8d0e85db1d0531a8181b5bb84e1d4ed744db1cadd8814acd3d181ff30137",
          fromBlock: undefined,
          id: "log_0x5fbdb2315678afecb367f032d93f642f64180aa3_1_topic1_0x17aa8d0e85db1d0531a8181b5bb84e1d4ed744db1cadd8814acd3d181ff30137_undefined_undefined",
          sourceId: "Pair",
          toBlock: undefined,
          type: "log",
        },
        new Set(["0xa16e02e87b7454126e5e10d957a927a7f5b5d2be"]),
      ],
    ]),
  );
  expect(data[1]?.childAddresses).toMatchObject(
    new Map([
      [
        {
          address: undefined,
          chainId: 1,
          childAddressLocation: "topic1",
          eventSelector:
            "0x17aa8d0e85db1d0531a8181b5bb84e1d4ed744db1cadd8814acd3d181ff30137",
          fromBlock: undefined,
          id: "log_0x5fbdb2315678afecb367f032d93f642f64180aa3_1_topic1_0x17aa8d0e85db1d0531a8181b5bb84e1d4ed744db1cadd8814acd3d181ff30137_undefined_undefined",
          sourceId: "Pair",
          toBlock: undefined,
          type: "log",
        },
        new Set(),
      ],
    ]),
  );

  expect(data[0]?.traces).toHaveLength(0);
  expect(data[1]?.traces).toHaveLength(0);

  expect(data[0]?.transactions).toHaveLength(0);
  expect(data[1]?.transactions).toHaveLength(1);
});

test("handleBlock() block event with log factory error", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ finalityBlockCount: 2 });
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

  const chain = getChain({ finalityBlockCount: 2 });
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

  const chain = getChain({ finalityBlockCount: 2 });
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

  const chain = getChain({ finalityBlockCount: 2 });
  const rpc = createRpc({ common, chain });

  const blockData = await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getAccountsIndexingBuild({
    address: ALICE,
  });

  const request = async (request: any) => {
    if (request.method === "debug_traceBlockByHash") {
      return Promise.resolve([
        {
          txHash: blockData.trace.transactionHash,
          result: blockData.trace.trace,
        },
      ]);
    }

    return rpc.request(request);
  };

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc: {
      // @ts-expect-error
      request,
    },
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

  const chain = getChain({ finalityBlockCount: 2 });
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

  const request = async (request: any) => {
    if (request.method === "debug_traceBlockByHash") {
      if (request.params[0] === blockData2.block.hash) {
        return Promise.resolve([
          {
            txHash: blockData2.transaction.hash,
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

      if (request.params[0] === blockData3.block.hash) {
        return Promise.resolve([
          {
            txHash: blockData3.trace.transactionHash,
            result: blockData3.trace.trace,
          },
        ]);
      }

      return Promise.resolve([]);
    }

    return rpc.request(request);
  };

  const finalizedBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc: {
      ...rpc,
      // @ts-expect-error
      request,
    },
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

  const chain = getChain({ finalityBlockCount: 2 });
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

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(2);

  expect(
    (syncResult[1] as Extract<RealtimeSyncEvent, { type: "finalize" }>).block
      .number,
  ).toBe("0x2");
});

test("handleReorg() finds common ancestor", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ finalityBlockCount: 2 });
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

test("handleReorg() throws error for deep reorg", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({ finalityBlockCount: 2 });
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

  await drainAsyncGenerator(
    realtimeSync.sync({
      ...blockData3.block,
      number: "0x4",
      hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      parentHash: realtimeSync.unfinalizedBlocks[1]!.hash,
    }),
  );

  // block 4 is not added to `unfinalizedBlocks`
  expect(realtimeSync.unfinalizedBlocks).toHaveLength(3);
});

test("sync() range scan emits matched blocks and advances to head", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    finalityBlockCount: 2,
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
    finalityBlockCount: 2,
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
    finalityBlockCount: 2,
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
    finalityBlockCount: 2,
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
    finalityBlockCount: 2,
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
  expect(params.address).toStrictEqual([address]);
  expect(params.topics).toStrictEqual([
    [(eventCallbacks[0].filter as LogFilter).topic0],
  ]);
  expect(params.fromBlock).toBe("0x3");
  expect(params.toBlock).toBe("0x3");
});

test("sync() range scan splits eth_getLogs when the range is too wide", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    finalityBlockCount: 2,
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
    // @ts-ignore
    .mockImplementation(async (body, context) => {
      if (body.method === "eth_getLogs" && hasRejected === false) {
        hasRejected = true;
        throw new RpcRequestError({
          body,
          error: { code: -32000, message: "Max range: 1" },
          url: "http://localhost:8545",
        });
      }
      // @ts-ignore
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
    finalityBlockCount: 2,
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
      "unlikely to reduce RPC usage at this 'pollingInterval'",
    ),
  );

  // Warns exactly once, not on every poll.
  expect(warnings).toHaveLength(1);
  expect((warnings[0]![0] as { blocks_per_poll: number }).blocks_per_poll).toBe(
    1,
  );
});

test("sync() range scan does not warn when enough blocks elapse per poll", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    finalityBlockCount: 2,
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
      "unlikely to reduce RPC usage at this 'pollingInterval'",
    ),
  );

  expect(warnings).toHaveLength(0);
});

test("sync() ignores range scan when a block filter is present", async () => {
  const { common } = context;
  await setupDatabaseServices();

  const chain = getChain({
    finalityBlockCount: 2,
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
