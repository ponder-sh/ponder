import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { simulateFactoryDeploy, simulatePairSwap } from "@/_test/simulate.js";
import { getRawRPCData, publicClient } from "@/_test/utils.js";
import type { SyncBlock } from "@/types/sync.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import { hexToNumber } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import { createHistoricalSync } from "./index.js";

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
      if (request.method === "trace_filter") {
        let traces = [
          ...rpcData.block2.traces,
          ...rpcData.block3.traces,
          ...rpcData.block4.traces,
        ];

        if (request.params[0].fromBlock !== undefined) {
          traces = traces.filter(
            (t) =>
              hexToNumber(t.blockNumber) >=
              hexToNumber(request.params[0].fromBlock),
          );
        }
        if (request.params[0].toBlock) {
          traces = traces.filter(
            (t) =>
              hexToNumber(t.blockNumber) <=
              hexToNumber(request.params[0].toBlock),
          );
        }

        return Promise.resolve(traces);
      }
      return requestQueue.request(request);
    },
  } as RequestQueue;
};

test("createHistoricalSync()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: [context.sources[0]],
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });

  expect(historicalSync).toBeDefined();

  await cleanup();
});

test("sync() with log filter", async (context) => {
  const { cleanup, syncStore, database } = await setupDatabaseServices(context);

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: [context.sources[0]],
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });

  await historicalSync.sync([0, 5]);

  const logs = await database.syncDb.selectFrom("logs").selectAll().execute();

  expect(logs).toHaveLength(2);

  const intervals = await database.syncDb
    .selectFrom("logFilterIntervals")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(1);

  await cleanup();
});

test("sync() with log filter and transaction receipts", async (context) => {
  const { cleanup, syncStore, database } = await setupDatabaseServices(context);

  context.sources[0].filter.includeTransactionReceipts = true;

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: [context.sources[0]],
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });

  await historicalSync.sync([0, 5]);

  const logs = await database.syncDb.selectFrom("logs").selectAll().execute();

  expect(logs).toHaveLength(2);

  const transactionReceipts = await database.syncDb
    .selectFrom("transactionReceipts")
    .selectAll()
    .execute();

  expect(transactionReceipts).toHaveLength(2);

  const intervals = await database.syncDb
    .selectFrom("logFilterIntervals")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(1);

  await cleanup();
});

test("sync() with block filter", async (context) => {
  const { cleanup, syncStore, database } = await setupDatabaseServices(context);

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: [context.sources[4]],
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });

  await historicalSync.sync([0, 5]);

  const blocks = await database.syncDb
    .selectFrom("blocks")
    .selectAll()
    .execute();

  expect(blocks).toHaveLength(3);

  const intervals = await database.syncDb
    .selectFrom("blockFilterIntervals")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(1);

  await cleanup();
});

test("sync() with log address filter", async (context) => {
  const { cleanup, syncStore, database } = await setupDatabaseServices(context);

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: [context.sources[1]],
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });

  await historicalSync.sync([0, 5]);

  const logs = await database.syncDb.selectFrom("logs").selectAll().execute();

  expect(logs).toHaveLength(2);

  const intervals = await database.syncDb
    .selectFrom("factoryLogFilterIntervals")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(1);

  await cleanup();
});

test("sync() with trace filter", async (context) => {
  const { cleanup, syncStore, database } = await setupDatabaseServices(context);

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: [context.sources[3]],
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });

  await historicalSync.sync([0, 5]);

  const callTraces = await database.syncDb
    .selectFrom("callTraces")
    .selectAll()
    .execute();

  expect(callTraces).toHaveLength(4);

  const intervals = await database.syncDb
    .selectFrom("traceFilterIntervals")
    .selectAll()
    .execute();

  expect(intervals).toHaveLength(1);

  await cleanup();
});

test("sync() with many filters", async (context) => {
  const { cleanup, syncStore, database } = await setupDatabaseServices(context);

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: context.sources,
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });

  await historicalSync.sync([0, 5]);

  const logs = await database.syncDb.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(4);

  const blocks = await database.syncDb
    .selectFrom("blocks")
    .selectAll()
    .execute();
  expect(blocks).toHaveLength(5);

  await cleanup();
});

test("sync() with cache hit", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  let historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: [context.sources[0]],
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });
  await historicalSync.sync([0, 5]);

  // re-instantiate `historicalSync` to reset the cached intervals

  const spy = vi.spyOn(syncStore, "insertBlock");

  historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: [context.sources[0]],
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });
  await historicalSync.sync([0, 5]);

  expect(spy).toHaveBeenCalledTimes(0);

  await cleanup();
});

test("initializeMetrics()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: context.sources,
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });

  const finalizeBlock = await publicClient.request({
    method: "eth_getBlockByNumber",
    params: ["latest", false],
  });

  historicalSync.initializeMetrics(finalizeBlock as SyncBlock, true);

  const totalBlocksMetric = (
    await context.common.metrics.ponder_historical_total_blocks.get()
  ).values;
  const cachedBlocksMetric = (
    await context.common.metrics.ponder_historical_cached_blocks.get()
  ).values;

  expect(totalBlocksMetric).toEqual(
    expect.arrayContaining([
      {
        labels: { network: "mainnet", source: "Erc20", type: "log" },
        value: 6,
      },
      // {
      //   labels: { network: "mainnet", source: "Pair_factory", type: "log" },
      //   value: 6,
      // },
      { labels: { network: "mainnet", source: "Pair", type: "log" }, value: 6 },
      {
        labels: { network: "mainnet", source: "OddBlocks", type: "block" },
        value: 5,
      },
      // {
      //   labels: { network: "mainnet", source: "Factory", type: "trace" },
      //   value: 6,
      // },
    ]),
  );

  expect(cachedBlocksMetric).toEqual(
    expect.arrayContaining([
      {
        labels: { network: "mainnet", source: "Erc20", type: "log" },
        value: 0,
      },
      // {
      //   labels: { network: "mainnet", source: "Pair_factory", type: "log" },
      //   value: 0,
      // },
      { labels: { network: "mainnet", source: "Pair", type: "log" }, value: 0 },
      {
        labels: { network: "mainnet", source: "OddBlocks", type: "block" },
        value: 0,
      },
      // {
      //   labels: { network: "mainnet", source: "Factory", type: "trace" },
      //   value: 0,
      // },
    ]),
  );

  await cleanup();
});

test("initializeMetrics() with cache hit", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  let historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: context.sources,
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });

  await historicalSync.sync([0, 5]);

  historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: context.sources,
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });

  const finalizeBlock = await publicClient.request({
    method: "eth_getBlockByNumber",
    params: ["latest", false],
  });

  historicalSync.initializeMetrics(finalizeBlock as SyncBlock, true);

  const totalBlocksMetric = (
    await context.common.metrics.ponder_historical_total_blocks.get()
  ).values;
  const cachedBlocksMetric = (
    await context.common.metrics.ponder_historical_cached_blocks.get()
  ).values;

  expect(totalBlocksMetric).toEqual(
    expect.arrayContaining([
      {
        labels: { network: "mainnet", source: "Erc20", type: "log" },
        value: 6,
      },
      // {
      //   labels: { network: "mainnet", source: "Pair_factory", type: "log" },
      //   value: 6,
      // },
      { labels: { network: "mainnet", source: "Pair", type: "log" }, value: 6 },
      {
        labels: { network: "mainnet", source: "OddBlocks", type: "block" },
        value: 5,
      },
      // {
      //   labels: { network: "mainnet", source: "Factory", type: "trace" },
      //   value: 6,
      // },
    ]),
  );

  expect(cachedBlocksMetric).toEqual(
    expect.arrayContaining([
      {
        labels: { network: "mainnet", source: "Erc20", type: "log" },
        value: 6,
      },
      // {
      //   labels: { network: "mainnet", source: "Pair_factory", type: "log" },
      //   value: 0,
      // },
      { labels: { network: "mainnet", source: "Pair", type: "log" }, value: 6 },
      {
        labels: { network: "mainnet", source: "OddBlocks", type: "block" },
        value: 5,
      },
      // {
      //   labels: { network: "mainnet", source: "Factory", type: "trace" },
      //   value: 0,
      // },
    ]),
  );

  await cleanup();
});

test("sync() updates metrics", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: context.sources,
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });

  await historicalSync.sync([0, 5]);

  const completedBlocksMetric = (
    await context.common.metrics.ponder_historical_completed_blocks.get()
  ).values;

  expect(completedBlocksMetric).toEqual(
    expect.arrayContaining([
      {
        labels: { network: "mainnet", source: "Erc20", type: "log" },
        value: 6,
      },
      // {
      //   labels: { network: "mainnet", source: "Pair_factory", type: "log" },
      //   value: 0,
      // },
      { labels: { network: "mainnet", source: "Pair", type: "log" }, value: 6 },
      {
        labels: { network: "mainnet", source: "OddBlocks", type: "block" },
        value: 5,
      },
      // {
      //   labels: { network: "mainnet", source: "Factory", type: "trace" },
      //   value: 0,
      // },
    ]),
  );

  await cleanup();
});

test("syncBlock() with cache", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  // block 2 and 4 will be requested
  const blockFilter = context.sources[4].filter;
  blockFilter.offset = 0;

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: [
      context.sources[0],
      { ...context.sources[4], filter: blockFilter },
    ],
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });

  const spy = vi.spyOn(context.requestQueues[0], "request");

  await historicalSync.sync([0, 5]);

  // 1 call to `syncBlock()` will be cached because
  // each source in `sources` matches block 2
  expect(spy).toHaveBeenCalledTimes(4);

  await cleanup();
});

test("syncAddress() handles many addresses", async (context) => {
  const { cleanup, syncStore, database } = await setupDatabaseServices(context);

  context.common.options.factoryAddressCountThreshold = 10;

  for (let i = 0; i < 10; i++) {
    await simulateFactoryDeploy(context.factory.address);
  }

  const pair = await simulateFactoryDeploy(context.factory.address);
  await simulatePairSwap(pair);

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: [context.sources[1]],
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });

  await historicalSync.sync([0, 10 + 5 + 2]);

  const logs = await database.syncDb.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(14);

  await cleanup();
});

test("sync() chunks requests", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  context.sources[0].maxBlockRange = 1;

  const historicalSync = await createHistoricalSync({
    common: context.common,
    network: context.networks[0],
    sources: [context.sources[0]],
    syncStore,
    requestQueue: await getRequestQueue(context.requestQueues[0]),
  });

  const spy = vi.spyOn(context.requestQueues[0], "request");

  await historicalSync.sync([0, 5]);

  expect(spy).toHaveBeenCalledTimes(8);

  await cleanup();
});
