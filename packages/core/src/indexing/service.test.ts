import { BOB } from "@/_test/constants.js";
import {
  setupAnvil,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getEventsErc20 } from "@/_test/utils.js";
import { createSchema } from "@/schema/schema.js";
import { SyncService } from "@/sync/service.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { type Address, checksumAddress } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import { decodeEvents } from "./events.js";
import {
  type Context,
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
      setup: vi.fn(),
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

  await processEvents(indexingService, {
    events: setupEvents,
    firstEventCheckpoint: zeroCheckpoint,
  });

  expect(indexingFunctions.Erc20.setup).toHaveBeenCalledOnce();
  expect(indexingFunctions.Erc20.setup).toHaveBeenCalledWith({
    context: {
      network: { chainId: 1, name: "mainnet" },
      contracts: {
        Erc20: {
          abi: expect.any(Object),
          address: checksumAddress(sources[0].criteria.address as Address),
          startBlock: sources[0].startBlock,
          endBlock: sources[0].endBlock,
          maxBlockRange: sources[0].maxBlockRange,
        },
        Pair: {
          abi: expect.any(Object),
          address: checksumAddress(sources[1].criteria.address as Address),
          startBlock: sources[1].startBlock,
          endBlock: sources[1].endBlock,
          maxBlockRange: sources[1].maxBlockRange,
        },
      },
      client: expect.any(Object),
      db: expect.any(Object),
    },
  });

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
      Transfer: vi.fn(),
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
  await processEvents(indexingService, {
    events,
    firstEventCheckpoint: zeroCheckpoint,
  });

  expect(indexingFunctions.Erc20.Transfer).toHaveBeenCalledTimes(2);
  expect(indexingFunctions.Erc20.Transfer).toHaveBeenCalledWith({
    event: {
      name: "Transfer",
      args: expect.any(Object),
      log: expect.any(Object),
      block: expect.any(Object),
      transaction: expect.any(Object),
    },
    context: {
      network: { chainId: 1, name: "mainnet" },
      contracts: {
        Erc20: {
          abi: expect.any(Object),
          address: checksumAddress(sources[0].criteria.address as Address),
          startBlock: sources[0].startBlock,
          endBlock: sources[0].endBlock,
          maxBlockRange: sources[0].maxBlockRange,
        },
        Pair: {
          abi: expect.any(Object),
          address: checksumAddress(sources[1].criteria.address as Address),
          startBlock: sources[1].startBlock,
          endBlock: sources[1].endBlock,
          maxBlockRange: sources[1].maxBlockRange,
        },
      },
      client: expect.any(Object),
      db: expect.any(Object),
    },
  });

  await cleanup();
});

test("executeSetup() context.client", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const indexingFunctions = {
    Erc20: {
      setup: async ({ context }: { context: Context }) => {
        await context.client.getBalance({
          address: BOB,
        });
      },
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

  const getBalanceSpy = vi.spyOn(
    indexingService.clientByChainId[1],
    "getBalance",
  );

  const setupEvents = createSetupEvents(indexingService, { sources, networks });

  await processEvents(indexingService, {
    events: setupEvents,
    firstEventCheckpoint: zeroCheckpoint,
  });

  expect(getBalanceSpy).toHaveBeenCalledOnce();
  expect(getBalanceSpy).toHaveBeenCalledWith({
    address: BOB,
  });

  await cleanup();
});

test("executeSetup() context.db", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const indexingFunctions = {
    Erc20: {
      setup: async ({ context }: { context: Context }) => {
        await context.db.Supply.create({
          id: "supply",
          data: {
            supply: 0n,
          },
        });
      },
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

  const createSpy = vi.spyOn(
    indexingService.currentEvent.context.db.Supply,
    "create",
  );

  const setupEvents = createSetupEvents(indexingService, { sources, networks });

  await processEvents(indexingService, {
    events: setupEvents,
    firstEventCheckpoint: zeroCheckpoint,
  });

  expect(createSpy).toHaveBeenCalledOnce();
  expect(createSpy).toHaveBeenCalledWith({
    id: "supply",
    data: { supply: 0n },
  });

  const supply = await indexingStore.findUnique({
    tableName: "Supply",
    id: "supply",
  });
  expect(supply).toMatchObject({
    id: "supply",
    supply: 0n,
  });

  await cleanup();
});

test.todo("executeSetup() metrics");

test.todo("executeSetup() error");

test("executeLog() context.client", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const indexingService = createIndexingService({
    indexingFunctions: {
      Erc20: {
        Transfer: async ({ context }: { context: Context }) => {
          await context.client.getBalance({
            address: BOB,
          });
        },
      },
    },
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  const getBalanceSpy = vi.spyOn(
    indexingService.clientByChainId[1],
    "getBalance",
  );

  const rawEvents = await getEventsErc20(sources);
  const events = decodeEvents(rawEvents, indexingService.sourceById);
  await processEvents(indexingService, {
    events,
    firstEventCheckpoint: zeroCheckpoint,
  });

  expect(getBalanceSpy).toHaveBeenCalledTimes(2);
  expect(getBalanceSpy).toHaveBeenCalledWith({
    address: BOB,
  });

  await cleanup();
});

test("executeLog() context.db", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = new SyncService({ common, syncStore, networks, sources });

  const indexingService = createIndexingService({
    indexingFunctions: {
      Erc20: {
        Transfer: async ({
          event,
          context,
        }: { event: any; context: Context }) => {
          await context.db.TransferEvent.create({
            id: event.log.id,
            data: {
              timestamp: Number(event.block.timestamp),
            },
          });
        },
      },
    },
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  const createSpy = vi.spyOn(
    indexingService.currentEvent.context.db.TransferEvent,
    "create",
  );

  const rawEvents = await getEventsErc20(sources);
  const events = decodeEvents(rawEvents, indexingService.sourceById);
  await processEvents(indexingService, {
    events,
    firstEventCheckpoint: zeroCheckpoint,
  });

  expect(createSpy).toHaveBeenCalledTimes(2);

  const transferEvents = await indexingStore.findMany({
    tableName: "TransferEvent",
  });

  expect(transferEvents.items).toHaveLength(2);

  await cleanup();
});

test.todo("executeLog() metrics");

test.todo("executeLog() error");
