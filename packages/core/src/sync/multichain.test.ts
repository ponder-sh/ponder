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
import {
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import { beforeEach, expect, test } from "vitest";
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
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  expect(sync).toBeDefined();

  await sync.kill();

  await cleanup();
});

test.todo("mergeEventGenerators()", async () => {});

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
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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
    initialCheckpoint: encodeCheckpoint(maxCheckpoint),
  });

  const events = await drainAsyncGenerator(sync.getEvents()).then((events) =>
    events.flat(),
  );

  expect(events).toBeDefined();
  expect(events).toHaveLength(0);

  await sync.kill();

  await cleanup();
});
