import { ALICE, BOB } from "@/_test/constants.js";
import {
  setupAnvil,
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
import type { LogFactory, LogFilter } from "@/internal/types.js";
import { _eth_getBlockByNumber } from "@/rpc/actions.js";
import { createRpc } from "@/rpc/index.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import { parseEther } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import { type RealtimeSyncEvent, createRealtimeSync } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("createRealtimeSync()", async (context) => {
  const { common } = context;
  await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await _eth_getBlockByNumber(rpc, { blockNumber: 0 });

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

test("sync() handles block", async (context) => {
  const { common } = context;
  await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({ chain, common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await _eth_getBlockByNumber(rpc, { blockNumber: 0 });

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  await testClient.mine({ blocks: 1 });
  const block = await _eth_getBlockByNumber(rpc, { blockNumber: 1 });

  const syncResult = await drainAsyncGenerator(realtimeSync.sync(block));

  expect(syncResult).toHaveLength(1);
  expect(syncResult[0]!.type).toBe("block");
  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);
});

test("sync() no-op when receiving same block twice", async (context) => {
  const { common } = context;
  await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({ chain, common });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await _eth_getBlockByNumber(rpc, { blockNumber: 0 });

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  await testClient.mine({ blocks: 1 });
  const block = await _eth_getBlockByNumber(rpc, { blockNumber: 1 });

  await drainAsyncGenerator(realtimeSync.sync(block));
  const syncResult = await drainAsyncGenerator(realtimeSync.sync(block));

  expect(syncResult).toHaveLength(0);

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);
});

test("sync() gets missing block", async (context) => {
  const { common } = context;
  await setupDatabaseServices(context);

  const chain = getChain({ finalityBlockCount: 2 });
  const rpc = createRpc({ common, chain });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await _eth_getBlockByNumber(rpc, { blockNumber: 0 });

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  await testClient.mine({ blocks: 2 });
  const block = await _eth_getBlockByNumber(rpc, { blockNumber: 2 });

  const syncResult = await drainAsyncGenerator(realtimeSync.sync(block));

  expect(syncResult).toHaveLength(2);

  expect(syncResult[0]!.type).toBe("block");
  expect(syncResult[1]!.type).toBe("block");

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(2);
});

test("sync() catches error", async (context) => {
  const { common } = context;
  await setupDatabaseServices(context);

  const chain = getChain({ finalityBlockCount: 2 });
  const rpc = createRpc({ common, chain });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await _eth_getBlockByNumber(rpc, { blockNumber: 0 });

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  await testClient.mine({ blocks: 1 });
  const block = await _eth_getBlockByNumber(rpc, { blockNumber: 1 });

  const requestSpy = vi.spyOn(rpc, "request");
  requestSpy.mockRejectedValueOnce(new Error());

  const syncResult = await drainAsyncGenerator(realtimeSync.sync(block));

  expect(syncResult).toHaveLength(0);

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(0);
});

test("handleBlock() block event with log", async (context) => {
  const { common } = context;
  await setupDatabaseServices(context);

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

  const finalizedBlock = await _eth_getBlockByNumber(rpc, { blockNumber: 1 });

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const block = await _eth_getBlockByNumber(rpc, { blockNumber: 2 });

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

test("handleBlock() block event with log factory", async (context) => {
  const { common } = context;
  await setupDatabaseServices(context);

  const chain = getChain({ finalityBlockCount: 2 });
  const rpc = createRpc({ common, chain });

  const { address } = await deployFactory({ sender: ALICE });
  const { address: pairAddress } = await createPair({
    factory: address,
    sender: ALICE,
  });
  await swapPair({
    pair: pairAddress,
    amount0Out: 1n,
    amount1Out: 1n,
    to: ALICE,
    sender: ALICE,
  });

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({
    address,
  });

  const filter = eventCallbacks[0]!.filter as LogFilter<LogFactory>;

  const finalizedBlock = await _eth_getBlockByNumber(rpc, { blockNumber: 1 });

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map([[filter.address.id, new Map()]]),
  });

  let block = await _eth_getBlockByNumber(rpc, { blockNumber: 2 });

  const syncResult1 = await drainAsyncGenerator(realtimeSync.sync(block));

  block = await _eth_getBlockByNumber(rpc, { blockNumber: 3 });

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

  expect(data[0]?.childAddresses).toMatchInlineSnapshot(`
    Map {
      {
        "address": "0x5fbdb2315678afecb367f032d93f642f64180aa3",
        "chainId": 1,
        "childAddressLocation": "topic1",
        "eventSelector": "0x17aa8d0e85db1d0531a8181b5bb84e1d4ed744db1cadd8814acd3d181ff30137",
        "fromBlock": undefined,
        "id": "log_0x5fbdb2315678afecb367f032d93f642f64180aa3_1_topic1_0x17aa8d0e85db1d0531a8181b5bb84e1d4ed744db1cadd8814acd3d181ff30137_undefined_undefined",
        "toBlock": undefined,
        "type": "log",
      } => Set {
        "0xa16e02e87b7454126e5e10d957a927a7f5b5d2be",
      },
    }
  `);
  expect(data[1]?.childAddresses).toMatchInlineSnapshot(`
    Map {
      {
        "address": "0x5fbdb2315678afecb367f032d93f642f64180aa3",
        "chainId": 1,
        "childAddressLocation": "topic1",
        "eventSelector": "0x17aa8d0e85db1d0531a8181b5bb84e1d4ed744db1cadd8814acd3d181ff30137",
        "fromBlock": undefined,
        "id": "log_0x5fbdb2315678afecb367f032d93f642f64180aa3_1_topic1_0x17aa8d0e85db1d0531a8181b5bb84e1d4ed744db1cadd8814acd3d181ff30137_undefined_undefined",
        "toBlock": undefined,
        "type": "log",
      } => Set {},
    }
  `);

  expect(data[0]?.traces).toHaveLength(0);
  expect(data[1]?.traces).toHaveLength(0);

  expect(data[0]?.transactions).toHaveLength(0);
  expect(data[1]?.transactions).toHaveLength(1);
});

test("handleBlock() block event with block", async (context) => {
  const { common } = context;
  await setupDatabaseServices(context);

  const chain = getChain({ finalityBlockCount: 2 });
  const rpc = createRpc({ common, chain });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await _eth_getBlockByNumber(rpc, { blockNumber: 0 });

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  await testClient.mine({ blocks: 1 });
  const block = await _eth_getBlockByNumber(rpc, { blockNumber: 1 });

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
  expect(data[0]?.transactions).toHaveLength(0);
});

test("handleBlock() block event with transaction", async (context) => {
  const { common } = context;
  await setupDatabaseServices(context);

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

  const finalizedBlock = await _eth_getBlockByNumber(rpc, { blockNumber: 0 });

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
  expect(data[0]?.transactions).toHaveLength(1);
  expect(data[0]?.transactionReceipts).toHaveLength(1);
});

test("handleBlock() block event with transfer", async (context) => {
  const { common } = context;
  await setupDatabaseServices(context);

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

  const finalizedBlock = await _eth_getBlockByNumber(rpc, { blockNumber: 0 });

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc: {
      // @ts-ignore
      request,
    },
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const block = await _eth_getBlockByNumber(rpc, { blockNumber: 1 });

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

test("handleBlock() block event with trace", async (context) => {
  const { common } = context;
  await setupDatabaseServices(context);

  const chain = getChain({ finalityBlockCount: 2 });
  const rpc = createRpc({ chain, common });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  const blockData = await transferErc20({
    erc20: address,
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const block2 = await _eth_getBlockByNumber(rpc, { blockNumber: 2 });

  const { eventCallbacks } = getErc20IndexingBuild({
    address,
    includeCallTraces: true,
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

      if (request.params[0] === blockData.block.hash) {
        return Promise.resolve([
          {
            txHash: blockData.trace.transactionHash,
            result: blockData.trace.trace,
          },
        ]);
      }

      return Promise.resolve([]);
    }

    return rpc.request(request);
  };

  const finalizedBlock = await _eth_getBlockByNumber(rpc, { blockNumber: 1 });

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc: {
      ...rpc,
      // @ts-ignore
      request,
    },
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  const syncResult1 = await drainAsyncGenerator(realtimeSync.sync(block2));
  const syncResult2 = await drainAsyncGenerator(
    realtimeSync.sync(blockData.block),
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

test("handleBlock() finalize event", async (context) => {
  const { common } = context;
  await setupDatabaseServices(context);

  const chain = getChain({ finalityBlockCount: 2 });
  const rpc = createRpc({
    chain,
    common,
  });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await _eth_getBlockByNumber(rpc, { blockNumber: 0 });

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  await testClient.mine({ blocks: 4 });

  let block = await _eth_getBlockByNumber(rpc, { blockNumber: 1 });

  await drainAsyncGenerator(realtimeSync.sync(block));

  block = await _eth_getBlockByNumber(rpc, { blockNumber: 2 });

  await drainAsyncGenerator(realtimeSync.sync(block));

  block = await _eth_getBlockByNumber(rpc, { blockNumber: 3 });

  await drainAsyncGenerator(realtimeSync.sync(block));

  block = await _eth_getBlockByNumber(rpc, { blockNumber: 4 });

  const syncResult = await drainAsyncGenerator(realtimeSync.sync(block));

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

test("handleReorg() finds common ancestor", async (context) => {
  const { common } = context;
  await setupDatabaseServices(context);

  const chain = getChain({ finalityBlockCount: 2 });
  const rpc = createRpc({
    chain,
    common,
  });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await _eth_getBlockByNumber(rpc, { blockNumber: 0 });

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  await testClient.mine({ blocks: 1 });
  let block = await _eth_getBlockByNumber(rpc, { blockNumber: 1 });

  await drainAsyncGenerator(realtimeSync.sync(block));

  await testClient.mine({ blocks: 1 });
  block = await _eth_getBlockByNumber(rpc, { blockNumber: 2 });

  await drainAsyncGenerator(realtimeSync.sync(block));

  await testClient.mine({ blocks: 1 });
  block = await _eth_getBlockByNumber(rpc, { blockNumber: 3 });

  await drainAsyncGenerator(realtimeSync.sync(block));

  block = await _eth_getBlockByNumber(rpc, { blockNumber: 2 });

  const syncResult = await drainAsyncGenerator(realtimeSync.sync(block));

  expect(syncResult).toHaveLength(1);
  expect(syncResult[0]).toStrictEqual({
    type: "reorg",
    block: expect.any(Object),
    reorgedBlocks: [expect.any(Object), expect.any(Object)],
  });

  expect(realtimeSync.unfinalizedBlocks).toHaveLength(1);
});

test("handleReorg() throws error for deep reorg", async (context) => {
  const { common } = context;
  await setupDatabaseServices(context);

  const chain = getChain({ finalityBlockCount: 2 });
  const rpc = createRpc({
    chain,
    common,
  });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const finalizedBlock = await _eth_getBlockByNumber(rpc, { blockNumber: 0 });

  const realtimeSync = createRealtimeSync({
    common,
    chain,
    rpc,
    eventCallbacks,
    syncProgress: { finalized: finalizedBlock },
    childAddresses: new Map(),
  });

  await testClient.mine({ blocks: 1 });
  let block = await _eth_getBlockByNumber(rpc, { blockNumber: 1 });

  await drainAsyncGenerator(realtimeSync.sync(block));

  await testClient.mine({ blocks: 1 });
  block = await _eth_getBlockByNumber(rpc, { blockNumber: 2 });

  await drainAsyncGenerator(realtimeSync.sync(block));

  await testClient.mine({ blocks: 1 });
  block = await _eth_getBlockByNumber(rpc, { blockNumber: 3 });

  await drainAsyncGenerator(realtimeSync.sync(block));

  block = await _eth_getBlockByNumber(rpc, { blockNumber: 3 });

  await drainAsyncGenerator(
    realtimeSync.sync({
      ...block,
      number: "0x4",
      hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      parentHash: realtimeSync.unfinalizedBlocks[1]!.hash,
    }),
  );

  // block 4 is not added to `unfinalizedBlocks`
  expect(realtimeSync.unfinalizedBlocks).toHaveLength(3);
});
