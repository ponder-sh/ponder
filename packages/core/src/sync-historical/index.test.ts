import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupCachedIntervals,
  setupChildAddresses,
  setupCleanup,
  setupCommon,
  setupDatabase,
  setupPonder,
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
  getPairWithFactoryConfigAndIndexingFunctions,
  testClient,
} from "@/_test/utils.js";
import { getCachedIntervals } from "@/runtime/index.js";
import { createSyncStore } from "@/sync-store/index.js";
import * as ponderSyncSchema from "@/sync-store/schema.js";
import {
  encodeFunctionData,
  encodeFunctionResult,
  toHex,
  zeroAddress,
} from "viem";
import { parseEther } from "viem/utils";
import { beforeEach, expect, test, vi } from "vitest";
import { createHistoricalSync } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupDatabase);
beforeEach(setupCleanup);

test("createHistoricalSync()", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const syncStore = createSyncStore(app);

  const historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals: setupCachedIntervals(app),
    syncStore,
  });

  expect(historicalSync).toBeDefined();
});

test("sync() with log filter", async (context) => {
  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { config, indexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);
  const syncStore = createSyncStore(app);

  const historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals: setupCachedIntervals(app),
    syncStore,
  });

  await historicalSync.sync([1, 2]);

  const logs = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.logs).execute(),
  );

  expect(logs).toHaveLength(1);

  const intervals = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);
});

test("sync() with log filter and transaction receipts", async (context) => {
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
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const syncStore = createSyncStore(app);

  const historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals: setupCachedIntervals(app),
    syncStore,
  });

  await historicalSync.sync([1, 2]);

  const transactionReceipts = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.transactionReceipts).execute(),
  );

  expect(transactionReceipts).toHaveLength(1);

  const intervals = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);
});

test("sync() with block filter", async (context) => {
  const { config, indexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const syncStore = createSyncStore(app);

  await testClient.mine({ blocks: 3 });

  const historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals: setupCachedIntervals(app),
    syncStore,
  });

  await historicalSync.sync([1, 3]);

  const blocks = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.blocks).execute(),
  );

  expect(blocks).toHaveLength(3);

  const intervals = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);
});

test("sync() with log factory", async (context) => {
  const { address } = await deployFactory({ sender: ALICE });
  const { result } = await createPair({ factory: address, sender: ALICE });
  await swapPair({
    pair: result,
    amount0Out: 1n,
    amount1Out: 1n,
    to: ALICE,
    sender: ALICE,
  });

  const { config, indexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address,
    });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const syncStore = createSyncStore(app);

  const historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals: setupCachedIntervals(app),
    syncStore,
  });

  await historicalSync.sync([1, 3]);

  const logs = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.logs).execute(),
  );
  const factories = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.factories).execute(),
  );

  expect(logs).toHaveLength(1);
  expect(factories).toHaveLength(1);

  const intervals = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);
});

test("sync() with trace filter", async (context) => {
  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  const { hash } = await transferErc20({
    erc20: address,
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { config, indexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address,
    includeCallTraces: true,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const syncStore = createSyncStore(app);

  const _request = app.indexingBuild.rpc.request;
  const request = async (request: any) => {
    if (request.method === "debug_traceBlockByNumber") {
      if (request.params[0] === "0x1") return Promise.resolve([]);
      if (request.params[0] === "0x2") return Promise.resolve([]);
      if (request.params[0] === "0x3") {
        return Promise.resolve([
          {
            txHash: hash,
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
    }

    return _request(request);
  };

  // @ts-ignore
  app.indexingBuild.rpc.request = request;

  const historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals: setupCachedIntervals(app),
    syncStore,
  });

  await historicalSync.sync([1, 3]);

  const traces = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.traces).execute(),
  );

  expect(traces).toHaveLength(1);

  const intervals = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);
});

test("sync() with transaction filter", async (context) => {
  await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { config, indexingFunctions } = getAccountsConfigAndIndexingFunctions({
    address: ALICE,
  });

  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const syncStore = createSyncStore(app);

  const historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals: setupCachedIntervals(app),
    syncStore,
  });

  await historicalSync.sync([1, 1]);

  const transactions = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.transactions).execute(),
  );

  expect(transactions).toHaveLength(1);

  const transactionReceipts = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.transactionReceipts).execute(),
  );

  expect(transactionReceipts).toHaveLength(1);

  const intervals = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  // transaction:from and transaction:to
  expect(intervals).toHaveLength(2);
});

test("sync() with transfer filter", async (context) => {
  const { hash } = await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { config, indexingFunctions } = getAccountsConfigAndIndexingFunctions({
    address: ALICE,
  });

  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const syncStore = createSyncStore(app);

  const _request = app.indexingBuild.rpc.request;
  const request = async (request: any) => {
    if (request.method === "debug_traceBlockByNumber") {
      if (request.params[0] === "0x1") {
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
    }

    return _request(request);
  };

  // @ts-ignore
  app.indexingBuild.rpc.request = request;

  const historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals: setupCachedIntervals(app),
    syncStore,
  });

  await historicalSync.sync([1, 1]);

  const transactions = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.transactions).execute(),
  );

  expect(transactions).toHaveLength(1);

  const intervals = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  // transfer:from and transfer:to
  expect(intervals).toHaveLength(2);
});

test("sync() with many filters", async (context) => {
  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const erc20Sources = getErc20ConfigAndIndexingFunctions({
    address,
  });

  const blockSources = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });

  const config = {
    ...blockSources.config,
    ...erc20Sources.config,
  };
  const indexingFunctions = [
    ...blockSources.indexingFunctions,
    ...erc20Sources.indexingFunctions,
  ];

  const app = await setupPonder(context, { config, indexingFunctions }, true);
  const syncStore = createSyncStore(app);

  const historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals: setupCachedIntervals(app),
    syncStore,
  });

  await historicalSync.sync([1, 2]);

  const logs = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.logs).execute(),
  );
  expect(logs).toHaveLength(1);

  const blocks = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.blocks).execute(),
  );
  expect(blocks).toHaveLength(2);

  const intervals = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(2);
});

test("sync() with cache", async (context) => {
  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { config, indexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const syncStore = createSyncStore(app);

  let historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals: setupCachedIntervals(app),
    syncStore,
  });

  await historicalSync.sync([1, 2]);

  // re-instantiate `historicalSync` to reset the cached intervals

  const spy = vi.spyOn(app.indexingBuild.rpc, "request");

  const cachedIntervals = await getCachedIntervals(app, { syncStore });

  historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals,
    syncStore,
  });

  await historicalSync.sync([1, 2]);
  expect(spy).toHaveBeenCalledTimes(0);
});

test("sync() with partial cache", async (context) => {
  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { config, indexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address,
  });
  const app = await setupPonder(context, { config, indexingFunctions }, true);

  const syncStore = createSyncStore(app);

  let historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals: setupCachedIntervals(app),
    syncStore,
  });

  await historicalSync.sync([1, 2]);

  // re-instantiate `historicalSync` to reset the cached intervals

  let spy = vi.spyOn(app.indexingBuild.rpc, "request");

  // @ts-ignore
  app.indexingBuild.eventCallbacks[0]!.filter.address = [
    // @ts-ignore
    app.indexingBuild.eventCallbacks[0]!.filter.address,
    zeroAddress,
  ];

  let cachedIntervals = await getCachedIntervals(app, { syncStore });

  historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals,
    syncStore,
  });

  await historicalSync.sync([1, 2]);
  expect(spy).toHaveBeenCalledTimes(2);

  expect(spy).toHaveBeenCalledWith({
    method: "eth_getLogs",
    params: [
      {
        address: [zeroAddress],
        fromBlock: "0x1",
        toBlock: "0x2",
        topics: [
          [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          ],
        ],
      },
    ],
  });

  // re-instantiate `historicalSync` to reset the cached intervals

  spy = vi.spyOn(app.indexingBuild.rpc, "request");

  cachedIntervals = await getCachedIntervals(app, { syncStore });

  historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals,
    syncStore,
  });

  await testClient.mine({ blocks: 1 });

  await historicalSync.sync([1, 3]);
  expect(spy).toHaveBeenCalledTimes(2);

  expect(spy).toHaveBeenCalledWith({
    method: "eth_getLogs",
    params: [
      {
        address: [address, zeroAddress],
        fromBlock: "0x3",
        toBlock: "0x3",
        topics: [
          [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          ],
        ],
      },
    ],
  });
});

test("syncBlock() with cache", async (context) => {
  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const erc20Sources = getErc20ConfigAndIndexingFunctions({
    address,
  });
  const blockSources = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });

  const config = {
    ...blockSources.config,
    ...erc20Sources.config,
  };
  const indexingFunctions = [
    ...blockSources.indexingFunctions,
    ...erc20Sources.indexingFunctions,
  ];

  const app = await setupPonder(context, { config, indexingFunctions }, true);
  const syncStore = createSyncStore(app);

  const historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals: setupCachedIntervals(app),
    syncStore,
  });

  const spy = vi.spyOn(app.indexingBuild.rpc, "request");

  await historicalSync.sync([1, 2]);

  // 1 "eth_getLogs" request and only 2 "eth_getBlockByNumber" requests
  // because the erc20 and block sources share the block 2
  expect(spy).toHaveBeenCalledTimes(3);
});

test("syncAddress() handles many addresses", async (context) => {
  context.common.options.factoryAddressCountThreshold = 10;

  const { address } = await deployFactory({ sender: ALICE });

  for (let i = 0; i < 10; i++) {
    await createPair({ factory: address, sender: ALICE });
  }

  const { result } = await createPair({ factory: address, sender: ALICE });
  await swapPair({
    pair: result,
    amount0Out: 1n,
    amount1Out: 1n,
    to: ALICE,
    sender: ALICE,
  });

  const { config, indexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address,
    });
  const app = await setupPonder(context, { config, indexingFunctions }, true);
  const syncStore = createSyncStore(app);

  const historicalSync = createHistoricalSync(app, {
    childAddresses: setupChildAddresses(app),
    cachedIntervals: setupCachedIntervals(app),
    syncStore,
  });

  await historicalSync.sync([1, 13]);

  const logs = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.logs).execute(),
  );
  const factories = await app.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.factoryAddresses).execute(),
  );
  expect(logs).toHaveLength(1);
  expect(factories).toHaveLength(11);
});
