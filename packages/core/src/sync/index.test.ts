import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { drainAsyncGenerator } from "@/utils/drainAsyncGenerator.js";
import { beforeEach, expect, test, vi } from "vitest";
import { createSync } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("createSync()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const sync = await createSync({
    syncStore,
    sources: context.sources,
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
  });

  expect(sync).toBeDefined();

  await cleanup();
});

test("getEvents() returns events", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const sync = await createSync({
    syncStore,
    sources: context.sources,
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
  });

  const events = await drainAsyncGenerator(sync.getEvents());

  expect(events).toBeDefined();
  expect(events).toHaveLength(1);

  await cleanup();
});

test("getEvents() with cache", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  let sync = await createSync({
    syncStore,
    sources: context.sources,
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
  });

  await drainAsyncGenerator(sync.getEvents());

  const spy = vi.spyOn(syncStore, "populateEvents");

  sync = await createSync({
    syncStore,
    sources: context.sources,
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
  });

  const events = await drainAsyncGenerator(sync.getEvents());

  expect(spy).toHaveBeenCalledTimes(0);

  expect(events).toBeDefined();
  expect(events).toHaveLength(1);

  await cleanup();
});

test("startRealtime()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const sync = await createSync({
    syncStore,
    sources: context.sources,
    common: context.common,
    networks: context.networks,
    onRealtimeEvent: () => {},
    onFatalError: () => {},
  });

  sync.startRealtime();

  await cleanup();
});
