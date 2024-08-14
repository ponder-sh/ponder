import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { testClient } from "@/_test/utils.js";
import {
  decodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { wait } from "@/utils/wait.js";
import { promiseWithResolvers } from "@ponder/common";
import { type TestContext, beforeEach, expect, test, vi } from "vitest";
import type { RawEvent } from "./events.js";
import { type Sync, createSync } from "./index.js";
import type { BlockSource } from "./source.js";

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

function getMultichainNetworksAndSources(context: TestContext) {
  const mainnet = context.networks[0];
  const optimism = { ...mainnet, name: "optimism", chainId: 10 };

  const sources = [
    context.sources[4],
    {
      ...context.sources[4],
      networkName: optimism.name,
      filter: {
        ...context.sources[4].filter,
        chainId: 10,
      },
    },
  ] as [BlockSource, BlockSource];

  return { networks: [mainnet, optimism], sources };
}

test("createSync()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const sync = await createSync({
    syncStore,
    sources: [context.sources[0]],
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
    initialCheckpoint: zeroCheckpoint,
  });

  expect(sync).toBeDefined();

  await sync.kill();

  await cleanup();
});

test("getEvents() returns events", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const sync = await createSync({
    syncStore,
    sources: [context.sources[4]],
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
    initialCheckpoint: zeroCheckpoint,
  });

  const events = await drainAsyncGenerator(sync.getEvents());

  expect(events).toBeDefined();
  expect(events).toHaveLength(1);

  await sync.kill();

  await cleanup();
});

test("getEvents() with cache", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  let sync = await createSync({
    syncStore,
    sources: [context.sources[4]],
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
    initialCheckpoint: zeroCheckpoint,
  });

  await drainAsyncGenerator(sync.getEvents());

  const spy = vi.spyOn(syncStore, "insertInterval");

  sync = await createSync({
    syncStore,
    sources: [context.sources[4]],
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
    initialCheckpoint: zeroCheckpoint,
  });

  const events = await drainAsyncGenerator(sync.getEvents());

  expect(spy).toHaveBeenCalledTimes(0);

  expect(events).toBeDefined();
  expect(events).toHaveLength(1);

  await sync.kill();

  await cleanup();
});

test("getEvents() end block", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  context.networks[0].finalityBlockCount = 1;
  context.sources[4].filter.toBlock = 4;

  const sync = await createSync({
    syncStore,
    sources: [context.sources[4]],
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
    initialCheckpoint: zeroCheckpoint,
  });

  const events = await drainAsyncGenerator(sync.getEvents());

  expect(events).toBeDefined();
  expect(events).toHaveLength(2);

  await sync.kill();

  await cleanup();
});

test("getEvents() multichain", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  sources[1].filter.toBlock = 0;

  const sync = await createSync({
    syncStore,
    sources: [sources[0], sources[1]],
    common: context.common,
    networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
    initialCheckpoint: zeroCheckpoint,
  });

  const events = await drainAsyncGenerator(sync.getEvents());

  expect(events).toBeDefined();
  expect(events).toHaveLength(1);

  await sync.kill();

  await cleanup();
});

test("getEvents() updates status", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const sync = await createSync({
    syncStore,
    sources: [context.sources[4]],
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
    initialCheckpoint: zeroCheckpoint,
  });

  await drainAsyncGenerator(sync.getEvents());

  const status = sync.getStatus();

  expect(status[context.networks[0].name]?.ready).toBe(false);
  expect(status[context.networks[0].name]?.block?.number).toBe(1);

  await sync.kill();

  await cleanup();
});

test("getEvents() pagination", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = context.networks[0];
  network.finalityBlockCount = 0;

  context.common.options = {
    ...context.common.options,
    syncEventsQuerySize: 1,
  };

  const sync = await createSync({
    syncStore,
    sources: [context.sources[4]],
    common: context.common,
    networks: [network],
    onRealtimeEvent: () => {},
    onFatalError: () => {},
    initialCheckpoint: zeroCheckpoint,
  });

  const events = await drainAsyncGenerator(sync.getEvents());
  expect(events).toHaveLength(3);

  await sync.kill();

  await cleanup();
});

test("getEvents() initialCheckpoint", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const sync = await createSync({
    syncStore,
    sources: [context.sources[4]],
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
    initialCheckpoint: maxCheckpoint,
  });

  const events = await drainAsyncGenerator(sync.getEvents());

  expect(events).toBeDefined();
  expect(events).toHaveLength(0);

  await sync.kill();

  await cleanup();
});

test("getEvents() refetches finalized block", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  context.common.options.syncHandoffStaleSeconds = 0.5;

  const sync = await createSync({
    syncStore,
    sources: [context.sources[4]],
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
    initialCheckpoint: zeroCheckpoint,
  });

  await wait(1000);

  await drainAsyncGenerator(sync.getEvents());

  await sync.kill();

  await cleanup();
});

test("startRealtime()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const sync = await createSync({
    syncStore,
    sources: [context.sources[4]],
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
    initialCheckpoint: zeroCheckpoint,
  });

  sync.startRealtime();

  const status = sync.getStatus();

  expect(status[context.networks[0].name]?.ready).toBe(true);
  expect(status[context.networks[0].name]?.block?.number).toBe(1);

  await sync.kill();

  await cleanup();
});

test("onEvent() handles block", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const promise = promiseWithResolvers<void>();
  const events: RawEvent[] = [];

  const sync = await createSync({
    syncStore,
    sources: [context.sources[0]],
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: (event) => {
      if (event.type === "block") {
        events.push(...event.events);
        promise.resolve();
      }
    },
    onFatalError: () => {},
    initialCheckpoint: zeroCheckpoint,
  });

  await drainAsyncGenerator(sync.getEvents());

  sync.startRealtime();

  await promise.promise;

  expect(events).toHaveLength(2);

  await sync.kill();

  await cleanup();
});

test("onEvent() handles finalize", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const promise = promiseWithResolvers<void>();
  let checkpoint: string;

  const sync = await createSync({
    syncStore,
    sources: [context.sources[0]],
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: (event) => {
      if (event.type === "finalize") {
        checkpoint = event.checkpoint;
        promise.resolve();
      }
    },
    onFatalError: () => {},
    initialCheckpoint: zeroCheckpoint,
  });

  await testClient.mine({ blocks: 4 });

  await drainAsyncGenerator(sync.getEvents());

  sync.startRealtime();

  await promise.promise;

  expect(decodeCheckpoint(checkpoint!).blockNumber).toBe(5n);

  await sync.kill();

  await cleanup();
});

test.todo("onEvent() handles reorg");

test("onEvent() multichain", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);
  const { networks, sources } = getMultichainNetworksAndSources(context);

  sources[1].filter.toBlock = 1;

  const promise = promiseWithResolvers<void>();

  const sync = await createSync({
    syncStore,
    sources: [sources[0], sources[1]],
    common: context.common,
    networks,
    onRealtimeEvent: () => {
      promise.resolve();
    },
    onFatalError: () => {},
    initialCheckpoint: zeroCheckpoint,
  });

  await drainAsyncGenerator(sync.getEvents());

  sync.startRealtime();

  await promise.promise;

  await sync.kill();

  await cleanup();
});

test("onEvent() handles endBlock finalization", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const promise = promiseWithResolvers<void>();

  context.sources[0].filter.toBlock = 4;

  const sync = await createSync({
    syncStore,
    sources: [context.sources[0]],
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: (event) => {
      if (event.type === "finalize") {
        promise.resolve();
      }
    },
    onFatalError: () => {},
    initialCheckpoint: zeroCheckpoint,
  });

  await testClient.mine({ blocks: 4 });

  await drainAsyncGenerator(sync.getEvents());

  sync.startRealtime();

  await promise.promise;

  await sync.kill();

  await cleanup();
});

test("onEvent() handles errors", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const promise = promiseWithResolvers<void>();

  const sync = await createSync({
    syncStore,
    sources: [context.sources[0]],
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {
      promise.resolve();
    },
    initialCheckpoint: zeroCheckpoint,
  });

  await drainAsyncGenerator(sync.getEvents());

  const spy = vi.spyOn(syncStore, "insertTransactions");
  spy.mockRejectedValue(new Error());

  sync.startRealtime();

  await promise.promise;

  await sync.kill();

  await cleanup();
});
