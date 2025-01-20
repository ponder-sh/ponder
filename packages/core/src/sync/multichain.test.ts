import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import {
  getBlocksConfigAndIndexingFunctions,
  getNetwork,
  testClient,
} from "@/_test/utils.js";
import { buildConfigAndIndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import type { RawEvent } from "@/internal/types.js";
import {
  MAX_CHECKPOINT_STRING,
  ZERO_CHECKPOINT_STRING,
  decodeCheckpoint,
} from "@/utils/checkpoint.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import { promiseWithResolvers } from "@ponder/common";
import { beforeEach, expect, test, vi } from "vitest";
import { createSyncMultichain } from "./multichain.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("createSyncMultichain()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const sync = await createSyncMultichain({
    common: context.common,
    network,
    sources,
    requestQueue: createRequestQueue({ network, common: context.common }),
    syncStore,
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  expect(sync).toBeDefined();

  await sync.kill();

  await cleanup();
});

test("getEvents()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  network.finalityBlockCount = 0;

  const sync = await createSyncMultichain({
    syncStore,
    common: context.common,
    network,
    sources,
    requestQueue: createRequestQueue({ network, common: context.common }),
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  const events = await drainAsyncGenerator(sync.getEvents()).then((events) =>
    events.flat(),
  );

  expect(events).toBeDefined();
  expect(events).toHaveLength(2);

  await sync.kill();

  await cleanup();
});

test("getEvents() updates status", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  network.finalityBlockCount = 0;

  const sync = await createSyncMultichain({
    syncStore,

    common: context.common,
    network,
    sources,
    requestQueue: createRequestQueue({ network, common: context.common }),
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  await drainAsyncGenerator(sync.getEvents());

  const status = sync.getStatus();

  expect(status[network.chainId]?.ready).toBe(false);
  expect(status[network.chainId]?.block?.number).toBe(2);

  await sync.kill();

  await cleanup();
});

test("getEvents() with initial checkpoint", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  network.finalityBlockCount = 0;

  const sync = await createSyncMultichain({
    syncStore,

    common: context.common,
    network,
    sources,
    requestQueue: createRequestQueue({ network, common: context.common }),
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: MAX_CHECKPOINT_STRING,
  });

  const events = await drainAsyncGenerator(sync.getEvents()).then((events) =>
    events.flat(),
  );

  expect(events).toBeDefined();
  expect(events).toHaveLength(0);

  await sync.kill();

  await cleanup();
});

test("startRealtime()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await testClient.mine({ blocks: 2 });

  const sync = await createSyncMultichain({
    syncStore,

    common: context.common,
    network,
    sources,
    requestQueue: createRequestQueue({ network, common: context.common }),
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  const status = sync.getStatus();

  expect(status[network.chainId]?.ready).toBe(true);
  expect(status[network.chainId]?.block?.number).toBe(1);

  await sync.kill();

  await cleanup();
});

test("onEvent() handles block", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const promise = promiseWithResolvers<void>();
  const events: RawEvent[] = [];

  await testClient.mine({ blocks: 1 });

  const sync = await createSyncMultichain({
    syncStore,

    common: context.common,
    network,
    sources,
    requestQueue: createRequestQueue({ network, common: context.common }),
    onRealtimeEvent: async (event) => {
      if (event.type === "block") {
        events.push(...event.events);
        promise.resolve();
      }
    },
    onFatalError: () => {},
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;

  expect(events).toHaveLength(1);

  await sync.kill();

  await cleanup();
});

test("onEvent() handles finalize", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const promise = promiseWithResolvers<void>();
  let checkpoint: string;

  // finalized block: 0

  network.finalityBlockCount = 2;

  const sync = await createSyncMultichain({
    syncStore,

    common: context.common,
    network,
    sources,
    requestQueue: createRequestQueue({ network, common: context.common }),
    onRealtimeEvent: async (event) => {
      if (event.type === "finalize") {
        checkpoint = event.checkpoint;
        promise.resolve();
      }
    },
    onFatalError: () => {},
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  await testClient.mine({ blocks: 4 });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;

  expect(decodeCheckpoint(checkpoint!).blockNumber).toBe(2n);

  await sync.kill();

  await cleanup();
});

test.todo("onEvent() handles reorg");

test("onEvent() handles errors", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const promise = promiseWithResolvers<void>();

  // finalized block: 0

  const sync = await createSyncMultichain({
    syncStore,

    common: context.common,
    network,
    sources,
    requestQueue: createRequestQueue({ network, common: context.common }),
    onRealtimeEvent: async () => {},
    onFatalError: () => {
      promise.resolve();
    },
    initialCheckpoint: ZERO_CHECKPOINT_STRING,
  });

  await testClient.mine({ blocks: 4 });

  await drainAsyncGenerator(sync.getEvents());

  const spy = vi.spyOn(syncStore, "insertTransactions");
  spy.mockRejectedValue(new Error());

  await sync.startRealtime();

  await promise.promise;

  await sync.kill();

  await cleanup();
});
