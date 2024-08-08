import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { maxCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { drainAsyncGenerator } from "@/utils/drainAsyncGenerator.js";
import { promiseWithResolvers } from "@ponder/common";
import { beforeEach, expect, test, vi } from "vitest";
import type { RawEvent } from "./events.js";
import { createSync } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

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

test.todo("getEvents() multichain");

test.todo("getEvents() handles endBlock");

test.todo("getEvents() updates status");

test.todo("getEvents() pagination");

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

test.todo("onEvent() handles finalize");

test.todo("onEvent() handles reorg");

test.todo("onEvent() handles endBlock finalization");

test.todo("onEvent() handles errors");

test.todo("initialCheckpoint");

test.todo("isDevnet");
