import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
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
  getAccountsConfigAndIndexingFunctions,
  getBlocksConfigAndIndexingFunctions,
  getErc20ConfigAndIndexingFunctions,
  getNetwork,
  getPairWithFactoryConfigAndIndexingFunctions,
  testClient,
} from "@/_test/utils.js";
import { buildConfigAndIndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
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
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("createHistoricalSync()", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

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

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources,
    syncStore,
    requestQueue,
    onFatalError: () => {},
  });

  expect(historicalSync).toBeDefined();
});

test("sync() with log filter", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const network = getNetwork();
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

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources,
    syncStore,
    requestQueue,
    onFatalError: () => {},
  });

  await historicalSync.sync([1, 2]);

  const logs = await database.qb.sync.selectFrom("logs").selectAll().execute();

  expect(logs).toHaveLength(1);

  const intervals = await database.qb.sync
    .selectFrom("intervals")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(1);
});

test("sync() with log filter and transaction receipts", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const network = getNetwork();
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
    includeTransactionReceipts: true,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources,
    syncStore,
    requestQueue,
    onFatalError: () => {},
  });

  await historicalSync.sync([1, 2]);

  const transactionReceipts = await database.qb.sync
    .selectFrom("transactionReceipts")
    .selectAll()
    .execute();

  expect(transactionReceipts).toHaveLength(1);

  const intervals = await database.qb.sync
    .selectFrom("intervals")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(1);
});

test("sync() with block filter", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

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

  await testClient.mine({ blocks: 3 });

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources,
    syncStore,
    requestQueue,
    onFatalError: () => {},
  });

  await historicalSync.sync([1, 3]);

  const blocks = await database.qb.sync
    .selectFrom("blocks")
    .selectAll()
    .execute();

  expect(blocks).toHaveLength(3);

  const intervals = await database.qb.sync
    .selectFrom("intervals")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(1);
});

test("sync() with log factory", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { address } = await deployFactory({ sender: ALICE });
  const { result } = await createPair({ factory: address, sender: ALICE });
  await swapPair({
    pair: result,
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

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources,
    syncStore,
    requestQueue,
    onFatalError: () => {},
  });

  await historicalSync.sync([1, 3]);

  const logs = await database.qb.sync.selectFrom("logs").selectAll().execute();

  expect(logs).toHaveLength(2);

  const intervals = await database.qb.sync
    .selectFrom("intervals")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(1);
});

test("sync() with trace filter", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const network = getNetwork();
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
  const { hash } = await transferErc20({
    erc20: address,
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
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

    return requestQueue.request(request);
  };

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources: sources.filter(({ filter }) => filter.type === "trace"),
    syncStore,
    requestQueue: {
      ...requestQueue,
      // @ts-ignore
      request,
    },
    onFatalError: () => {},
  });

  await historicalSync.sync([1, 3]);

  const traces = await database.qb.sync
    .selectFrom("traces")
    .selectAll()
    .execute();

  expect(traces).toHaveLength(1);

  const intervals = await database.qb.sync
    .selectFrom("intervals")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(1);
});

test("sync() with transaction filter", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const network = getNetwork();
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

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources: sources.filter(({ filter }) => filter.type === "transaction"),
    syncStore,
    requestQueue,
    onFatalError: () => {},
  });

  await historicalSync.sync([1, 1]);

  const transactions = await database.qb.sync
    .selectFrom("transactions")
    .selectAll()
    .execute();

  expect(transactions).toHaveLength(1);

  const transactionReceipts = await database.qb.sync
    .selectFrom("transactionReceipts")
    .selectAll()
    .execute();

  expect(transactionReceipts).toHaveLength(1);

  const intervals = await database.qb.sync
    .selectFrom("intervals")
    .selectAll()
    .execute();

  // transaction:from and transaction:to
  expect(intervals).toHaveLength(2);
});

test("sync() with transfer filter", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const network = getNetwork();
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

    return requestQueue.request(request);
  };

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources: sources.filter(({ filter }) => filter.type === "transfer"),
    syncStore,
    requestQueue: {
      ...requestQueue,
      // @ts-ignore
      request,
    },
    onFatalError: () => {},
  });

  await historicalSync.sync([1, 1]);

  const transactions = await database.qb.sync
    .selectFrom("transactions")
    .selectAll()
    .execute();

  expect(transactions).toHaveLength(1);

  const intervals = await database.qb.sync
    .selectFrom("intervals")
    .selectAll()
    .execute();

  // transfer:from and transfer:to
  expect(intervals).toHaveLength(2);
});

test("sync() with many filters", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const network = getNetwork();
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

  const { sources: erc20Sources } = await buildConfigAndIndexingFunctions({
    ...getErc20ConfigAndIndexingFunctions({
      address,
    }),
  });
  const { sources: blockSources } = await buildConfigAndIndexingFunctions({
    ...getBlocksConfigAndIndexingFunctions({
      interval: 1,
    }),
  });

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources: [...erc20Sources, ...blockSources],
    syncStore,
    requestQueue,
    onFatalError: () => {},
  });

  await historicalSync.sync([1, 2]);

  const logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(1);

  const blocks = await database.qb.sync
    .selectFrom("blocks")
    .selectAll()
    .execute();
  expect(blocks).toHaveLength(2);

  const intervals = await database.qb.sync
    .selectFrom("intervals")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(2);
});

test("sync() with cache", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
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

  let historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources,
    syncStore,
    requestQueue,
    onFatalError: () => {},
  });

  await historicalSync.sync([1, 2]);

  // re-instantiate `historicalSync` to reset the cached intervals

  const spy = vi.spyOn(requestQueue, "request");

  historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources,
    syncStore,
    requestQueue,
    onFatalError: () => {},
  });

  await historicalSync.sync([1, 2]);
  expect(spy).toHaveBeenCalledTimes(0);
});

test("sync() with partial cache", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
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

  let historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources,
    syncStore,
    requestQueue,
    onFatalError: () => {},
  });

  await historicalSync.sync([1, 2]);

  // re-instantiate `historicalSync` to reset the cached intervals

  let spy = vi.spyOn(requestQueue, "request");

  // @ts-ignore
  sources[0]!.filter.address = [sources[0]!.filter.address, zeroAddress];

  historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources,
    syncStore,
    requestQueue,
    onFatalError: () => {},
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

  spy = vi.spyOn(requestQueue, "request");

  historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources,
    syncStore,
    requestQueue,
    onFatalError: () => {},
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
  const { syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
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

  const { sources: erc20Sources } = await buildConfigAndIndexingFunctions({
    ...getErc20ConfigAndIndexingFunctions({
      address,
    }),
  });
  const { sources: blockSources } = await buildConfigAndIndexingFunctions({
    ...getBlocksConfigAndIndexingFunctions({
      interval: 1,
    }),
  });

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources: [...erc20Sources, ...blockSources],
    syncStore,
    requestQueue,
    onFatalError: () => {},
  });

  const spy = vi.spyOn(requestQueue, "request");

  await historicalSync.sync([1, 2]);

  // 1 "eth_getLogs" request and only 2 "eth_getBlockByNumber" requests
  // because the erc20 and block sources share the block 2
  expect(spy).toHaveBeenCalledTimes(3);
});

test("syncAddress() handles many addresses", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

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

  const { config, rawIndexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network,
    sources,
    syncStore,
    requestQueue,
    onFatalError: () => {},
  });

  await historicalSync.sync([1, 13]);

  const logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  // 11 pair creations and 1 swap
  expect(logs).toHaveLength(12);
});
