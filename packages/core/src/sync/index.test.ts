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
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { wait } from "@/utils/wait.js";
import { promiseWithResolvers } from "@ponder/common";
import { beforeEach, expect, test, vi } from "vitest";
import type { RawEvent } from "./events.js";
import { type Sync, createSync } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

async function drainAsyncGenerator(
  asyncGenerator: ReturnType<Sync["getEvents"]>,
) {
  const result: RawEvent[] = [];

  for await (const { events } of asyncGenerator) {
    result.push(...events);
  }

  return result;
}

test("createSync()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const sync = await createSync({
    syncStore,
    sources,
    common: context.common,
    networks: [network],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  expect(sync).toBeDefined();

  await sync.kill();

  await cleanup();
});

test("getEvents() returns events", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  network.finalityBlockCount = 0;

  const sync = await createSync({
    syncStore,
    sources,
    common: context.common,
    networks: [network],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const events = await drainAsyncGenerator(sync.getEvents());

  expect(events).toBeDefined();
  expect(events).toHaveLength(2);

  await sync.kill();

  await cleanup();
});

test("getEvents() with cache", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  await testClient.mine({ blocks: 1 });

  // finalized block: 1
  network.finalityBlockCount = 0;

  let sync = await createSync({
    syncStore,
    sources,
    common: context.common,
    networks: [network],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  await drainAsyncGenerator(sync.getEvents());

  const spy = vi.spyOn(syncStore, "insertIntervals");

  sync = await createSync({
    syncStore,
    sources,
    common: context.common,
    networks: [network],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const events = await drainAsyncGenerator(sync.getEvents());

  expect(spy).toHaveBeenCalledTimes(0);

  expect(events).toBeDefined();
  expect(events).toHaveLength(2);

  await sync.kill();

  await cleanup();
});

test("getEvents() end block", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  network.finalityBlockCount = 0;

  sources[0]!.filter.toBlock = 1;

  const sync = await createSync({
    syncStore,
    sources,
    common: context.common,
    networks: [network],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const events = await drainAsyncGenerator(sync.getEvents());

  expect(events).toBeDefined();
  expect(events).toHaveLength(2);

  await sync.kill();

  await cleanup();
});

// TODO(kyle) This test is skipped because it causes a flake on ci.
// Our test setup is unable to properly mock a multichain environment
// The chain data of the chains in "network" is exactly the same.
// This test will fail when `sources[1]` finishes before `sources[0]`, because
// the `onConflictDoNothing` in `insertBlocks` causes the block with relavant data
// not to be added to the store. This test should be un-skipped when 1) we can mock
// multichain enviroments, and 2) when our sync-store is robust enough to handle
// multiple blocks with the same hash and different chain IDs.
test.skip("getEvents() multichain", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });

  const { sources: sources1, networks: networks1 } =
    await buildConfigAndIndexingFunctions({
      config,
      rawIndexingFunctions,
      options: {
        ponderDir: "",
        rootDir: "",
      },
    });

  const { sources: sources2, networks: networks2 } =
    await buildConfigAndIndexingFunctions({
      config,
      rawIndexingFunctions,
      options: {
        ponderDir: "",
        rootDir: "",
      },
    });

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  networks1[0]!.finalityBlockCount = 0;
  networks2[0]!.finalityBlockCount = 0;

  sources2[0]!.filter.chainId = 2;
  sources2[0]!.filter.toBlock = 1;
  networks2[0]!.chainId = 2;

  const sync = await createSync({
    syncStore,
    sources: [...sources1, ...sources2],
    common: context.common,
    networks: [...networks1, ...networks2],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const events = await drainAsyncGenerator(sync.getEvents());

  expect(events).toBeDefined();
  expect(events).toHaveLength(1);

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
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  network.finalityBlockCount = 0;

  const sync = await createSync({
    syncStore,
    sources,
    common: context.common,
    networks: [network],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  await drainAsyncGenerator(sync.getEvents());

  const status = sync.getStatus();

  expect(status[network.name]?.ready).toBe(false);
  expect(status[network.name]?.block?.number).toBe(2);

  await sync.kill();

  await cleanup();
});

test("getEvents() pagination", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  network.finalityBlockCount = 0;

  context.common.options.syncEventsQuerySize = 1;

  const sync = await createSync({
    syncStore,
    sources,
    common: context.common,
    networks: [network],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const events = await drainAsyncGenerator(sync.getEvents());
  expect(events).toHaveLength(3);

  await sync.kill();

  await cleanup();
});

test("getEvents() initialCheckpoint", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  network.finalityBlockCount = 0;

  const sync = await createSync({
    syncStore,
    sources,
    common: context.common,
    networks: [network],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(maxCheckpoint),
  });

  const events = await drainAsyncGenerator(sync.getEvents());

  expect(events).toBeDefined();
  expect(events).toHaveLength(0);

  await sync.kill();

  await cleanup();
});

test("getEvents() refetches finalized block", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  await testClient.mine({ blocks: 2 });

  // finalized block: 2
  network.finalityBlockCount = 0;

  context.common.options.syncHandoffStaleSeconds = 0.5;

  const sync = await createSync({
    syncStore,
    sources,
    common: context.common,
    networks: [network],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(maxCheckpoint),
  });

  // cause `latestFinalizedFetch` to be updated
  const gen = sync.getEvents();

  await wait(1000);

  await drainAsyncGenerator(gen);

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
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  await testClient.mine({ blocks: 2 });

  const sync = await createSync({
    syncStore,
    sources,
    common: context.common,
    networks: [network],
    onRealtimeEvent: async () => {},
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  const status = sync.getStatus();

  expect(status[network.name]?.ready).toBe(true);
  expect(status[network.name]?.block?.number).toBe(1);

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
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const promise = promiseWithResolvers<void>();
  const events: RawEvent[] = [];

  await testClient.mine({ blocks: 1 });

  const sync = await createSync({
    syncStore,
    sources,
    common: context.common,
    networks: [network],
    onRealtimeEvent: async (event) => {
      if (event.type === "block") {
        events.push(...event.events);
        promise.resolve();
      }
    },
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const promise = promiseWithResolvers<void>();
  let checkpoint: string;

  // finalized block: 0

  network.finalityBlockCount = 2;

  const sync = await createSync({
    syncStore,
    sources,
    common: context.common,
    networks: [network],
    onRealtimeEvent: async (event) => {
      if (event.type === "finalize") {
        checkpoint = event.checkpoint;
        promise.resolve();
      }
    },
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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

test("onEvent() multichain gets all events", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources: sources1, networks: networks1 } =
    await buildConfigAndIndexingFunctions({
      config,
      rawIndexingFunctions,
      options: {
        ponderDir: "",
        rootDir: "",
      },
    });

  const { sources: sources2, networks: networks2 } =
    await buildConfigAndIndexingFunctions({
      config,
      rawIndexingFunctions,
      options: {
        ponderDir: "",
        rootDir: "",
      },
    });

  // finalized block: 0

  sources2[0]!.filter.chainId = 2;
  networks2[0]!.chainId = 2;

  const promise = promiseWithResolvers<void>();

  const sync = await createSync({
    syncStore,
    sources: [...sources1, ...sources2],
    common: context.common,
    networks: [...networks1, ...networks2],
    onRealtimeEvent: async (event) => {
      if (event.type === "block") {
        promise.resolve();
      }
    },
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  await testClient.mine({ blocks: 1 });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;

  await sync.kill();

  await cleanup();
});

test("onEvent() multichain end block", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources: sources1, networks: networks1 } =
    await buildConfigAndIndexingFunctions({
      config,
      rawIndexingFunctions,
      options: {
        ponderDir: "",
        rootDir: "",
      },
    });

  const { sources: sources2, networks: networks2 } =
    await buildConfigAndIndexingFunctions({
      config,
      rawIndexingFunctions,
      options: {
        ponderDir: "",
        rootDir: "",
      },
    });

  // finalized block: 0

  sources2[0]!.filter.chainId = 2;
  sources2[0]!.filter.toBlock = 0;
  networks2[0]!.chainId = 2;

  const promise = promiseWithResolvers<void>();

  const sync = await createSync({
    syncStore,
    sources: [...sources1, ...sources2],
    common: context.common,
    networks: [...networks1, ...networks2],
    onRealtimeEvent: async (event) => {
      if (event.type === "block") {
        promise.resolve();
      }
    },
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  await testClient.mine({ blocks: 1 });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;

  await sync.kill();

  await cleanup();
});

test("onEvent() handles endBlock finalization", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const promise = promiseWithResolvers<void>();

  // finalized block: 0

  await testClient.mine({ blocks: 2 });

  network.finalityBlockCount = 2;

  sources[0]!.filter.toBlock = 1;

  const sync = await createSync({
    syncStore,
    sources,
    common: context.common,
    networks: [network],
    onRealtimeEvent: async (event) => {
      if (event.type === "finalize") {
        promise.resolve();
      }
    },
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  await testClient.mine({ blocks: 2 });

  await drainAsyncGenerator(sync.getEvents());

  await sync.startRealtime();

  await promise.promise;

  await sync.kill();

  await cleanup();
});

test("onEvent() handles errors", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
    options: {
      ponderDir: "",
      rootDir: "",
    },
  });

  const promise = promiseWithResolvers<void>();

  // finalized block: 0

  const sync = await createSync({
    syncStore,
    sources,
    common: context.common,
    networks: [network],
    onRealtimeEvent: async () => {},
    onFatalError: () => {
      promise.resolve();
    },
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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
