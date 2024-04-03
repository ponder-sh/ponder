import {
  setupAnvil,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getEventsErc20 } from "@/_test/utils.js";
import { createSchema } from "@/schema/schema.js";
import { SyncService } from "@/sync/service.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { beforeEach, expect, test, vi } from "vitest";
import { decodeEvents } from "./events.js";
import {
  createIndexingService,
  createSetupEvents,
  processEvents,
} from "./service.js";

beforeEach((context) => setupAnvil(context));
beforeEach((context) => setupIsolatedDatabase(context));

const schema = createSchema((p) => ({
  TransferEvent: p.createTable({
    id: p.string(),
    timestamp: p.int(),
  }),
  Supply: p.createTable({
    id: p.string(),
    supply: p.bigint(),
  }),
}));

test("createIndexing()", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const indexingService = createIndexingService({
    indexingFunctions: {},
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  expect(indexingService).toBeDefined();
  expect(indexingService.isKilled).toBe(false);

  await cleanup();
});

test("createSetupEvents() empty", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const indexingService = createIndexingService({
    indexingFunctions: {},
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  const setupEvents = createSetupEvents(indexingService, { sources, networks });

  expect(setupEvents).toHaveLength(0);

  await cleanup();
});

test("createSetupEvents()", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const indexingService = createIndexingService({
    indexingFunctions: {
      Erc20: {
        setup: () => {},
      },
    },
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  const setupEvents = createSetupEvents(indexingService, { sources, networks });

  expect(setupEvents).toHaveLength(1);
  expect(setupEvents[0]).toMatchObject({
    type: "setup",
    contractName: "Erc20",
    eventName: "setup",
    chainId: 1,
    startBlock: 0n,
    encodedCheckpoint: encodeCheckpoint({
      ...zeroCheckpoint,
      chainId: 1,
    }),
  });

  await cleanup();
});

test("processEvents() setup events", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const indexingFunctions = {
    Erc20: {
      setup: vi.fn((context) => {
        expect(context.network).toBeDefined();
        expect(context.client).toBeDefined();
        expect(context.db).toBeDefined();
        expect(context.contracts).toBeDefined();
      }),
    },
  };

  const indexingService = createIndexingService({
    indexingFunctions,
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  const setupEvents = createSetupEvents(indexingService, { sources, networks });

  await processEvents(indexingService, { events: setupEvents });

  expect(indexingFunctions.Erc20.setup).toHaveBeenCalledOnce();

  await cleanup();
});

test("processEvent() log events", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const indexingFunctions = {
    Erc20: {
      Transfer: vi.fn((context) => {
        expect(context.network).toBeDefined();
        expect(context.client).toBeDefined();
        expect(context.db).toBeDefined();
        expect(context.contracts).toBeDefined();
      }),
    },
  };

  const indexingService = createIndexingService({
    indexingFunctions,
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  const rawEvents = await getEventsErc20(sources);
  const events = decodeEvents(rawEvents, indexingService.sourceById);
  await processEvents(indexingService, { events });

  expect(indexingFunctions.Erc20.Transfer).toHaveBeenCalledTimes(2);

  await cleanup();
});

test.todo("processEvents() calls store method");

test.todo("processEvents() reads from contract");

test.todo("processEvents() error");
