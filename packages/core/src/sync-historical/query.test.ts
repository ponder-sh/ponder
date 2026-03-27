// Integration tests against real Monad RPC with query API support.
// These hit a real endpoint and are slower than unit tests.
import {
  context,
  setupCachedIntervals,
  setupChildAddresses,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import type { Chain, EventCallback } from "@/internal/types.js";
import { createRpc } from "@/rpc/index.js";
import {
  defaultLogFilterInclude,
  defaultTraceFilterInclude,
} from "@/runtime/filter.js";
import { getRequiredIntervalsWithFilters } from "@/runtime/index.js";
import * as ponderSyncSchema from "@/sync-store/schema.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { beforeEach, expect, test, vi } from "vitest";
import { createHistoricalSync } from "./index.js";
import { createQueryHistoricalSync, syncLogsViaQueryApi } from "./query.js";

const MONAD_RPC = "https://monad-data-poc-production.up.railway.app/rpc";

// Kuru MON-USDC OrderBook on Monad
const KURU_ADDRESS = "0x065C9d28E428A0db40191a54d33d5b7c71a9C394";
// Trade event topic
// keccak256("Trade(uint40,address,bool,uint256,uint96,address,address,uint96)")
const TRADE_TOPIC =
  "0xf16924fba1c18c108912fcacaac7450c98eb3f2d8c0a3cdf3df7066c08f21581";

// First Kuru Trade event is at block 43922596
const BLOCK_RANGE: [number, number] = [43922596, 43922700];

beforeEach(setupCommon);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

function getMonadChain(hasQueryApi: boolean): Chain {
  return {
    name: "monad",
    id: 143,
    rpc: MONAD_RPC,
    ws: undefined,
    pollingInterval: 1_000,
    finalityBlockCount: 1,
    disableCache: false,
    ethGetLogsBlockRange: undefined,
    viemChain: undefined,
    hasQueryApi,
  };
}

function getKuruEventCallback(chain: Chain): EventCallback {
  return {
    filter: {
      type: "log" as const,
      chainId: 143,
      sourceId: "KuruOrderBook",
      address: toLowerCase(KURU_ADDRESS),
      topic0: TRADE_TOPIC,
      topic1: null,
      topic2: null,
      topic3: null,
      fromBlock: undefined,
      toBlock: undefined,
      hasTransactionReceipt: false,
      include: defaultLogFilterInclude,
    },
    name: "KuruOrderBook:Trade",
    fn: vi.fn(),
    chain,
    type: "contract" as const,
    abiItem: { type: "event", name: "Trade" } as any,
    metadata: { safeName: "Trade", abi: [] },
  };
}

test("syncLogsViaQueryApi fetches logs with joined blocks and transactions", async () => {
  const chain = getMonadChain(true);
  const rpc = createRpc({ common: context.common, chain });

  const result = await syncLogsViaQueryApi(rpc, {
    address: KURU_ADDRESS,
    interval: BLOCK_RANGE,
  });

  expect(result.logs).toBeDefined();
  expect(Array.isArray(result.logs)).toBe(true);
  expect(result.blocks).toBeDefined();
  expect(result.transactions).toBeDefined();

  if (result.logs.length > 0) {
    expect(result.blocks.length).toBeGreaterThan(0);

    const log = result.logs[0]!;
    expect(log.blockNumber).toBeDefined();
    expect(log.blockHash).toBeDefined();
    expect(log.logIndex).toBeDefined();
    expect(log.address).toBeDefined();
    expect(log.data).toBeDefined();
    expect(log.topics).toBeDefined();
    expect(log.removed).toBe(false);

    const block = result.blocks[0]!;
    expect(block.hash).toBeDefined();
    expect(block.number).toBeDefined();
    expect(block.timestamp).toBeDefined();
    expect(block.parentHash).toBeDefined();
    expect(Array.isArray(block.transactions)).toBe(true);
  }
}, 30_000);

test("query API and legacy sync produce the same logs", async () => {
  const queryChain = getMonadChain(true);
  const queryRpc = createRpc({ common: context.common, chain: queryChain });
  const eventCallback = getKuruEventCallback(queryChain);
  const childAddresses = setupChildAddresses([eventCallback]);
  const cachedIntervals = setupCachedIntervals([eventCallback]);

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: BLOCK_RANGE,
    filters: [eventCallback.filter],
    cachedIntervals,
  });

  // --- Run the query API path, collect results ---
  const { syncStore: querySyncStore, database: queryDb } =
    await setupDatabaseServices();

  const querySync = createQueryHistoricalSync({
    common: context.common,
    chain: queryChain,
    rpc: queryRpc,
    childAddresses,
  });

  const queryLogs = await querySync.syncBlockRangeData({
    interval: BLOCK_RANGE,
    requiredIntervals: requiredIntervals.intervals,
    requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    syncStore: querySyncStore,
  });
  await querySync.syncBlockData({
    interval: BLOCK_RANGE,
    requiredIntervals: requiredIntervals.intervals,
    logs: queryLogs,
    syncStore: querySyncStore,
  });

  const queryDbLogs = await queryDb.syncQB.wrap((db) =>
    db
      .select()
      .from(ponderSyncSchema.logs)
      .orderBy(
        ponderSyncSchema.logs.blockNumber,
        ponderSyncSchema.logs.logIndex,
      )
      .execute(),
  );
  const queryDbBlocks = await queryDb.syncQB.wrap((db) =>
    db
      .select()
      .from(ponderSyncSchema.blocks)
      .orderBy(ponderSyncSchema.blocks.number)
      .execute(),
  );

  // Kill shutdown to release the DB schema lock, then reinit common
  await context.common.shutdown.kill();
  setupCommon();

  // --- Run the legacy path, collect results ---
  const legacyChain = getMonadChain(false);
  const legacyRpc = createRpc({ common: context.common, chain: legacyChain });

  const { syncStore: legacySyncStore, database: legacyDb } =
    await setupDatabaseServices();

  const legacySync = createHistoricalSync({
    common: context.common,
    chain: legacyChain,
    rpc: legacyRpc,
    childAddresses,
  });

  const legacyLogs = await legacySync.syncBlockRangeData({
    interval: BLOCK_RANGE,
    requiredIntervals: requiredIntervals.intervals,
    requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    syncStore: legacySyncStore,
  });
  await legacySync.syncBlockData({
    interval: BLOCK_RANGE,
    requiredIntervals: requiredIntervals.intervals,
    logs: legacyLogs,
    syncStore: legacySyncStore,
  });

  const legacyDbLogs = await legacyDb.syncQB.wrap((db) =>
    db
      .select()
      .from(ponderSyncSchema.logs)
      .orderBy(
        ponderSyncSchema.logs.blockNumber,
        ponderSyncSchema.logs.logIndex,
      )
      .execute(),
  );
  const legacyDbBlocks = await legacyDb.syncQB.wrap((db) =>
    db
      .select()
      .from(ponderSyncSchema.blocks)
      .orderBy(ponderSyncSchema.blocks.number)
      .execute(),
  );

  // --- Compare ---
  // Sanity check: we should have actual data to compare
  expect(queryDbLogs.length).toBeGreaterThan(0);
  expect(queryDbLogs.length).toBe(legacyDbLogs.length);

  for (let i = 0; i < queryDbLogs.length; i++) {
    expect(queryDbLogs[i]!.blockNumber).toBe(legacyDbLogs[i]!.blockNumber);
    expect(queryDbLogs[i]!.logIndex).toBe(legacyDbLogs[i]!.logIndex);
    expect(queryDbLogs[i]!.address).toBe(legacyDbLogs[i]!.address);
    expect(queryDbLogs[i]!.topic0).toBe(legacyDbLogs[i]!.topic0);
    expect(queryDbLogs[i]!.data).toBe(legacyDbLogs[i]!.data);
  }

  expect(queryDbBlocks.length).toBe(legacyDbBlocks.length);

  for (let i = 0; i < queryDbBlocks.length; i++) {
    expect(queryDbBlocks[i]!.number).toBe(legacyDbBlocks[i]!.number);
    expect(queryDbBlocks[i]!.hash).toBe(legacyDbBlocks[i]!.hash);
    expect(queryDbBlocks[i]!.timestamp).toBe(legacyDbBlocks[i]!.timestamp);
  }
}, 120_000);

test("query API syncs traces via eth_queryTraces", async () => {
  const chain = getMonadChain(true);
  const rpc = createRpc({ common: context.common, chain });

  const traceEventCallback: EventCallback = {
    filter: {
      type: "trace" as const,
      chainId: 143,
      sourceId: "KuruOrderBook",
      fromAddress: undefined,
      toAddress: toLowerCase(KURU_ADDRESS),
      functionSelector: "0x7c51d6cf" as `0x${string}`,
      callType: "CALL",
      includeReverted: false,
      fromBlock: undefined,
      toBlock: undefined,
      hasTransactionReceipt: false,
      include: defaultTraceFilterInclude,
    },
    name: "KuruOrderBook:trace",
    fn: vi.fn(),
    chain,
    type: "contract" as const,
    abiItem: { type: "function", name: "placeAndExecuteMarketBuy" } as any,
    metadata: { safeName: "placeAndExecuteMarketBuy()", abi: [] },
  };

  const childAddresses = setupChildAddresses([traceEventCallback]);
  const cachedIntervals = setupCachedIntervals([traceEventCallback]);
  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: BLOCK_RANGE,
    filters: [traceEventCallback.filter],
    cachedIntervals,
  });

  const { syncStore, database } = await setupDatabaseServices();

  const querySync = createQueryHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddresses,
  });

  const logs = await querySync.syncBlockRangeData({
    interval: BLOCK_RANGE,
    requiredIntervals: requiredIntervals.intervals,
    requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    syncStore,
  });
  await querySync.syncBlockData({
    interval: BLOCK_RANGE,
    requiredIntervals: requiredIntervals.intervals,
    logs,
    syncStore,
  });

  const dbTraces = await database.syncQB.wrap((db) =>
    db
      .select()
      .from(ponderSyncSchema.traces)
      .orderBy(
        ponderSyncSchema.traces.blockNumber,
        ponderSyncSchema.traces.traceIndex,
      )
      .execute(),
  );

  expect(dbTraces.length).toBeGreaterThan(0);

  const dbBlocks = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.blocks).execute(),
  );
  expect(dbBlocks.length).toBeGreaterThan(0);

  const dbTransactions = await database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.transactions).execute(),
  );
  expect(dbTransactions.length).toBeGreaterThan(0);
}, 60_000);
