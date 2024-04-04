import { BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getEventsErc20 } from "@/_test/utils.js";
import { createSchema } from "@/schema/schema.js";
import { SyncService } from "@/sync/service.js";
import { type Address, checksumAddress, parseEther, toHex } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import { decodeEvents } from "./events.js";
import {
  type Context,
  createIndexingService,
  processEvents,
  processSetupEvents,
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

test("processSetupEvents() empty", async (context) => {
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

  const result = await processSetupEvents(indexingService, {
    sources,
    networks,
  });

  expect(result.status).toBe("success");

  await cleanup();
});

test("processSetupEvents()", async (context) => {
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

  const result = await processSetupEvents(indexingService, {
    sources,
    networks,
  });

  expect(result.status).toBe("success");

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

  const result = await processSetupEvents(indexingService, {
    sources,
    networks,
  });

  expect(result.status).toBe("success");

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

  const result = await processSetupEvents(indexingService, {
    sources,
    networks,
  });

  expect(result.status).toBe("success");

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

test("ponderActions getBalance()", async (context) => {
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

  const balance = await indexingService.clientByChainId[1].getBalance({
    address: BOB,
  });

  expect(balance).toBe(parseEther("10000"));

  await cleanup();
});

test("ponderActions getBytecode()", async (context) => {
  const { common, sources, networks, erc20 } = context;
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

  const bytecode = await indexingService.clientByChainId[1].getBytecode({
    address: erc20.address,
  });

  expect(bytecode).toBeTruthy();

  await cleanup();
});

test("ponderActions getStorageAt()", async (context) => {
  const { common, sources, networks, erc20 } = context;
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

  const storage = await indexingService.clientByChainId[1].getStorageAt({
    address: erc20.address,
    // totalSupply is in the third storage slot
    slot: toHex(2),
  });

  expect(BigInt(storage!)).toBe(parseEther("1"));

  await cleanup();
});

test("ponderActions readContract()", async (context) => {
  const { common, sources, networks, erc20 } = context;
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

  const totalSupply = await indexingService.clientByChainId[1].readContract({
    abi: erc20ABI,
    functionName: "totalSupply",
    address: erc20.address,
  });

  expect(totalSupply).toBe(parseEther("1"));

  await cleanup();
});

test("ponderActions readContract() blockNumber", async (context) => {
  const { common, sources, networks, erc20 } = context;
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

  const totalSupply = await indexingService.clientByChainId[1].readContract({
    abi: erc20ABI,
    functionName: "totalSupply",
    address: erc20.address,
    blockNumber: 1n,
  });

  expect(totalSupply).toBe(parseEther("0"));

  await cleanup();
});

// Note: Kyle the local chain doesn't have a deployed instance of "multicall3"
test.skip("ponderActions multicall()", async (context) => {
  const { common, sources, networks, erc20 } = context;
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

  const [totalSupply] = await indexingService.clientByChainId[1].multicall({
    allowFailure: false,
    contracts: [
      {
        abi: erc20ABI,
        functionName: "totalSupply",
        address: erc20.address,
      },
    ],
  });

  expect(totalSupply).toBe(parseEther("1"));

  await cleanup();
});
