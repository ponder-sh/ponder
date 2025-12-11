import {
  context,
  setupAnvil,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getBlocksIndexingBuild, getChain, testClient } from "@/_test/utils.js";
import { eth_getBlockByNumber } from "@/rpc/actions.js";
import { createRpc } from "@/rpc/index.js";
import * as ponderSyncSchema from "@/sync-store/schema.js";
import { beforeEach, expect, test } from "vitest";
import { getCachedIntervals, getLocalSyncProgress } from "./index.js";
import { handleRealtimeSyncEvent } from "./realtime.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

async function init(cacheWrite: boolean) {
  const { database } = await setupDatabaseServices();
  const chain = getChain();
  chain.cache.write = cacheWrite;
  chain.cache.read = false;
  const rpc = createRpc({ chain, common: context.common });
  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });
  const cachedIntervals = await getCachedIntervals({
    chain,
    filters: eventCallbacks.map(({ filter }) => filter),
    // unused, cache read turned off
    syncStore: null as any,
  });

  const block0 = await eth_getBlockByNumber(rpc, ["0x0", true]);

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain,
    rpc,
    finalizedBlock: block0,
    cachedIntervals,
  });
  const params = {
    chain,
    common: context.common,
    database,
    eventCallbacks,
    syncProgress: syncProgress,
    unfinalizedBlocks: [],
  };
  return {
    params,
    rpc,
  };
}

test("handleRealtimeSyncEvent() cache..write enabled", async () => {
  const { params, rpc } = await init(true);

  await testClient.mine({ blocks: 1 });
  const block1 = await eth_getBlockByNumber(rpc, ["0x1", true]);

  await handleRealtimeSyncEvent(
    {
      type: "block",
      block: block1,
      childAddresses: new Map(),
      hasMatchedFilter: false,
      logs: [],
      traces: [],
      transactions: [],
      transactionReceipts: [],
    },
    params,
  );
  await handleRealtimeSyncEvent({ type: "finalize", block: block1 }, params);

  expect(params.unfinalizedBlocks).toHaveLength(0);
  const intervals = await params.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(1);
  expect(intervals[0]!.fragmentId).toBe("block_1_1_0");
});

test("handleRealtimeSyncEvent() cache.write disabled", async () => {
  const { params, rpc } = await init(false);

  await testClient.mine({ blocks: 1 });
  const block1 = await eth_getBlockByNumber(rpc, ["0x1", true]);

  await handleRealtimeSyncEvent(
    {
      type: "block",
      block: block1,
      childAddresses: new Map(),
      hasMatchedFilter: false,
      logs: [],
      traces: [],
      transactions: [],
      transactionReceipts: [],
    },
    params,
  );
  await handleRealtimeSyncEvent({ type: "finalize", block: block1 }, params);
  expect(params.unfinalizedBlocks).toHaveLength(0);
  const intervals = await params.database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.intervals).execute(),
  );

  expect(intervals).toHaveLength(0);
});
