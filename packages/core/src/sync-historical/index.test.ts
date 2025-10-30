import { ALICE, BOB } from "@/_test/constants.js";
import {
  setupAnvil,
  setupCachedIntervals,
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
} from "@/_test/utils.js";
import { createRpc } from "@/rpc/index.js";
import { getCachedIntervals, getRequiredIntervals } from "@/runtime/index.js";
import * as ponderSyncSchema from "@/sync-store/schema.js";
import { zeroAddress } from "viem";
import { parseEther } from "viem/utils";
import { beforeEach, expect, test, vi } from "vitest";
import { createHistoricalSync } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("createHistoricalSync()", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { sources } = getBlocksIndexingBuild({
    interval: 1,
  });

  const historicalSync = createHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddresses: setupChildAddresses(sources),
  });

  expect(historicalSync).toBeDefined();
});

test("sync() with log filter", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { sources } = getErc20IndexingBuild({
    address,
  });

  const historicalSync = createHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddresses: setupChildAddresses(sources),
  });

  const requiredIntervals = getRequiredIntervals({
    interval: [1, 2],
    sources,
    cachedIntervals: setupCachedIntervals(sources),
  });
  const logs = await historicalSync.syncBlockRangeData({
    interval: [1, 2],
    requiredIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval: [1, 2],
    requiredIntervals,
    logs,
    syncStore,
  });
  await syncStore.insertIntervals({
    intervals: requiredIntervals,
    chainId: chain.id,
  });

  const dbLogs = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.logs).execute(),
  );

  expect(dbLogs).toHaveLength(1);

  const dbIntervals = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(dbIntervals).toHaveLength(1);
});

test("sync() with log filter and transaction receipts", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { sources } = getErc20IndexingBuild({
    address,
    includeTransactionReceipts: true,
  });

  const historicalSync = createHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddresses: setupChildAddresses(sources),
  });

  const requiredIntervals = getRequiredIntervals({
    interval: [1, 2],
    sources,
    cachedIntervals: setupCachedIntervals(sources),
  });
  const logs = await historicalSync.syncBlockRangeData({
    interval: [1, 2],
    requiredIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval: [1, 2],
    requiredIntervals,
    logs,
    syncStore,
  });
  await syncStore.insertIntervals({
    intervals: requiredIntervals,
    chainId: chain.id,
  });

  const transactionReceipts = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.transactionReceipts).execute(),
  );

  expect(transactionReceipts).toHaveLength(1);

  const intervals = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);
});

test("sync() with block filter", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { sources } = getBlocksIndexingBuild({
    interval: 1,
  });

  await simulateBlock();
  await simulateBlock();
  await simulateBlock();

  const historicalSync = createHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddresses: setupChildAddresses(sources),
  });

  const requiredIntervals = getRequiredIntervals({
    interval: [1, 3],
    sources,
    cachedIntervals: setupCachedIntervals(sources),
  });
  const logs = await historicalSync.syncBlockRangeData({
    interval: [1, 3],
    requiredIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval: [1, 3],
    requiredIntervals,
    logs,
    syncStore,
  });
  await syncStore.insertIntervals({
    intervals: requiredIntervals,
    chainId: chain.id,
  });

  const blocks = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.blocks).execute(),
  );

  expect(blocks).toHaveLength(3);

  const intervals = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);
});

test("sync() with log factory", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

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

  const { sources } = getPairWithFactoryIndexingBuild({
    address,
  });

  const historicalSync = await createHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddresses: setupChildAddresses(sources),
  });

  const requiredIntervals = getRequiredIntervals({
    interval: [1, 3],
    sources,
    cachedIntervals: setupCachedIntervals(sources),
  });
  const logs = await historicalSync.syncBlockRangeData({
    interval: [1, 3],
    requiredIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval: [1, 3],
    requiredIntervals,
    logs,
    syncStore,
  });
  await syncStore.insertIntervals({
    intervals: requiredIntervals,
    chainId: chain.id,
  });

  const dbLogs = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.logs).execute(),
  );
  const factories = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.factories).execute(),
  );

  expect(dbLogs).toHaveLength(1);
  expect(factories).toHaveLength(1);

  const intervals = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);
});

test("sync() with trace filter", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

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

  const { sources } = getErc20IndexingBuild({
    address,
    includeCallTraces: true,
  });

  const request = async (request: any) => {
    if (request.method === "debug_traceBlockByNumber") {
      if (request.params[0] === "0x1") return Promise.resolve([]);
      if (request.params[0] === "0x2") return Promise.resolve([]);
      if (request.params[0] === "0x3") {
        return Promise.resolve([
          {
            txHash: blockData.trace.transactionHash,
            result: blockData.trace.trace,
          },
        ]);
      }
    }

    return rpc.request(request);
  };

  const historicalSync = createHistoricalSync({
    common: context.common,
    chain,
    rpc: {
      ...rpc,
      // @ts-ignore
      request,
    },
    childAddresses: setupChildAddresses(sources),
  });

  const requiredIntervals = getRequiredIntervals({
    interval: [1, 3],
    sources: sources.filter(({ filter }) => filter.type === "trace"),
    cachedIntervals: setupCachedIntervals(sources),
  });
  const logs = await historicalSync.syncBlockRangeData({
    interval: [1, 3],
    requiredIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval: [1, 3],
    requiredIntervals,
    logs,
    syncStore,
  });
  await syncStore.insertIntervals({
    intervals: requiredIntervals,
    chainId: chain.id,
  });

  const traces = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.traces).execute(),
  );

  expect(traces).toHaveLength(1);

  const intervals = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);
});

test("sync() with transaction filter", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { sources } = getAccountsIndexingBuild({
    address: ALICE,
  });

  const historicalSync = createHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddresses: setupChildAddresses(sources),
  });

  const requiredIntervals = getRequiredIntervals({
    interval: [1, 1],
    sources: sources.filter(({ filter }) => filter.type === "transaction"),
    cachedIntervals: setupCachedIntervals(sources),
  });
  const logs = await historicalSync.syncBlockRangeData({
    interval: [1, 1],
    requiredIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval: [1, 1],
    requiredIntervals,
    logs,
    syncStore,
  });
  await syncStore.insertIntervals({
    intervals: requiredIntervals,
    chainId: chain.id,
  });

  const transactions = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.transactions).execute(),
  );

  expect(transactions).toHaveLength(1);

  const transactionReceipts = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.transactionReceipts).execute(),
  );

  expect(transactionReceipts).toHaveLength(1);

  const intervals = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  // transaction:from and transaction:to
  expect(intervals).toHaveLength(2);
});

test("sync() with transfer filter", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const blockData = await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { sources } = getAccountsIndexingBuild({
    address: ALICE,
  });

  const request = async (request: any) => {
    if (request.method === "debug_traceBlockByNumber") {
      if (request.params[0] === "0x1") {
        return Promise.resolve([
          {
            txHash: blockData.trace.transactionHash,
            result: blockData.trace.trace,
          },
        ]);
      }
    }

    return rpc.request(request);
  };

  const historicalSync = createHistoricalSync({
    common: context.common,
    chain,
    rpc: {
      ...rpc,
      // @ts-ignore
      request,
    },
    childAddresses: setupChildAddresses(sources),
  });

  const requiredIntervals = getRequiredIntervals({
    interval: [1, 1],
    sources: sources.filter(({ filter }) => filter.type === "transfer"),
    cachedIntervals: setupCachedIntervals(sources),
  });
  const logs = await historicalSync.syncBlockRangeData({
    interval: [1, 1],
    requiredIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval: [1, 1],
    requiredIntervals,
    logs,
    syncStore,
  });
  await syncStore.insertIntervals({
    intervals: requiredIntervals,
    chainId: chain.id,
  });

  const transactions = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.transactions).execute(),
  );

  expect(transactions).toHaveLength(1);

  const intervals = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  // transfer:from and transfer:to
  expect(intervals).toHaveLength(2);
});

test("sync() with many filters", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const erc20IndexingBuild = getErc20IndexingBuild({
    address,
  });

  const blocksIndexingBuild = getBlocksIndexingBuild({
    interval: 1,
  });

  const historicalSync = createHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddresses: setupChildAddresses([
      ...erc20IndexingBuild.sources,
      ...blocksIndexingBuild.sources,
    ]),
  });

  const requiredIntervals = getRequiredIntervals({
    interval: [1, 2],
    sources: [...erc20IndexingBuild.sources, ...blocksIndexingBuild.sources],
    cachedIntervals: setupCachedIntervals([
      ...erc20IndexingBuild.sources,
      ...blocksIndexingBuild.sources,
    ]),
  });
  const logs = await historicalSync.syncBlockRangeData({
    interval: [1, 2],
    requiredIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval: [1, 2],
    requiredIntervals,
    logs,
    syncStore,
  });
  await syncStore.insertIntervals({
    intervals: requiredIntervals,
    chainId: chain.id,
  });

  const dbLogs = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.logs).execute(),
  );
  expect(dbLogs).toHaveLength(1);

  const blocks = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.blocks).execute(),
  );
  expect(blocks).toHaveLength(2);

  const intervals = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(2);
});

test("sync() with cache", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { sources } = getErc20IndexingBuild({
    address,
  });

  let historicalSync = createHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddresses: setupChildAddresses(sources),
  });

  let requiredIntervals = getRequiredIntervals({
    interval: [1, 2],
    sources,
    cachedIntervals: setupCachedIntervals(sources),
  });
  let logs = await historicalSync.syncBlockRangeData({
    interval: [1, 2],
    requiredIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval: [1, 2],
    requiredIntervals,
    logs,
    syncStore,
  });
  await syncStore.insertIntervals({
    intervals: requiredIntervals,
    chainId: chain.id,
  });

  // re-instantiate `historicalSync` to reset the cached intervals

  const spy = vi.spyOn(rpc, "request");

  const cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    sources,
  });

  historicalSync = createHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddresses: setupChildAddresses(sources),
  });

  requiredIntervals = getRequiredIntervals({
    interval: [1, 2],
    sources,
    cachedIntervals,
  });
  logs = await historicalSync.syncBlockRangeData({
    interval: [1, 2],
    requiredIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval: [1, 2],
    requiredIntervals,
    logs,
    syncStore,
  });
  await syncStore.insertIntervals({
    intervals: requiredIntervals,
    chainId: chain.id,
  });
  expect(spy).toHaveBeenCalledTimes(0);
});

test("sync() with partial cache", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { sources } = getErc20IndexingBuild({
    address,
  });

  let historicalSync = createHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddresses: setupChildAddresses(sources),
  });

  let requiredIntervals = getRequiredIntervals({
    interval: [1, 2],
    sources,
    cachedIntervals: setupCachedIntervals(sources),
  });
  let logs = await historicalSync.syncBlockRangeData({
    interval: [1, 2],
    requiredIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval: [1, 2],
    requiredIntervals,
    logs,
    syncStore,
  });
  await syncStore.insertIntervals({
    intervals: requiredIntervals,
    chainId: chain.id,
  });

  // re-instantiate `historicalSync` to reset the cached intervals

  let spy = vi.spyOn(rpc, "request");

  // @ts-ignore
  sources[0]!.filter.address = [sources[0]!.filter.address, zeroAddress];

  let cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    sources,
  });

  historicalSync = createHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddresses: setupChildAddresses(sources),
  });

  requiredIntervals = getRequiredIntervals({
    interval: [1, 2],
    sources,
    cachedIntervals,
  });
  logs = await historicalSync.syncBlockRangeData({
    interval: [1, 2],
    requiredIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval: [1, 2],
    requiredIntervals,
    logs,
    syncStore,
  });
  await syncStore.insertIntervals({
    intervals: requiredIntervals,
    chainId: chain.id,
  });

  // `eth_getBlockByNumber` is skipped
  expect(spy).toHaveBeenCalledTimes(1);

  expect(spy).toHaveBeenCalledWith(
    {
      method: "eth_getLogs",
      params: [
        {
          address: [zeroAddress],
          fromBlock: "0x1",
          toBlock: "0x2",
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          ],
        },
      ],
    },
    expect.any(Object),
  );

  // re-instantiate `historicalSync` to reset the cached intervals

  spy = vi.spyOn(rpc, "request");

  cachedIntervals = await getCachedIntervals({
    chain,
    syncStore,
    sources,
  });

  historicalSync = createHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddresses: setupChildAddresses(sources),
  });

  await simulateBlock();

  requiredIntervals = getRequiredIntervals({
    interval: [1, 3],
    sources,
    cachedIntervals,
  });
  logs = await historicalSync.syncBlockRangeData({
    interval: [1, 3],
    requiredIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval: [1, 3],
    requiredIntervals,
    logs,
    syncStore,
  });
  await syncStore.insertIntervals({
    intervals: requiredIntervals,
    chainId: chain.id,
  });
  // `eth_getBlockByNumber` is skipped
  expect(spy).toHaveBeenCalledTimes(1);

  expect(spy).toHaveBeenCalledWith(
    {
      method: "eth_getLogs",
      params: [
        {
          address: [address, zeroAddress],
          fromBlock: "0x3",
          toBlock: "0x3",
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          ],
        },
      ],
    },
    expect.any(Object),
  );
});

test("syncAddress() handles many addresses", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  context.common.options.factoryAddressCountThreshold = 10;

  const { address } = await deployFactory({ sender: ALICE });

  for (let i = 0; i < 10; i++) {
    await createPair({ factory: address, sender: ALICE });
  }

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

  const { sources } = getPairWithFactoryIndexingBuild({
    address,
  });

  const historicalSync = createHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddresses: setupChildAddresses(sources),
  });

  const requiredIntervals = getRequiredIntervals({
    interval: [1, 13],
    sources,
    cachedIntervals: setupCachedIntervals(sources),
  });
  const logs = await historicalSync.syncBlockRangeData({
    interval: [1, 13],
    requiredIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval: [1, 13],
    requiredIntervals,
    logs,
    syncStore,
  });
  await syncStore.insertIntervals({
    intervals: requiredIntervals,
    chainId: chain.id,
  });

  const dbLogs = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.logs).execute(),
  );
  const factories = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.factoryAddresses).execute(),
  );
  expect(dbLogs).toHaveLength(1);
  expect(factories).toHaveLength(11);
});
