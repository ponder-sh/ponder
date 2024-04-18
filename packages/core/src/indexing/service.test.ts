import { BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getEventsErc20 } from "@/_test/utils.js";
import { createSchema } from "@/schema/schema.js";
import { createSyncService } from "@/sync/index.js";
import { decodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { promiseWithResolvers } from "@ponder/common";
import { type Address, checksumAddress, parseEther, toHex } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import { decodeEvents } from "../sync/events.js";
import {
  type Context,
  create,
  kill,
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

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingService = create({
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

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingService = create({
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

  expect(result).toStrictEqual({ status: "success" });

  await cleanup();
});

test("processSetupEvents()", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingFunctions = {
    "Erc20:setup": vi.fn(),
  };

  const indexingService = create({
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

  expect(result).toStrictEqual({ status: "success" });

  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledOnce();
  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledWith({
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

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      vi.fn(),
  };

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  const rawEvents = await getEventsErc20(sources);
  const events = decodeEvents(syncService, rawEvents);
  const result = await processEvents(indexingService, {
    events,
  });
  expect(result).toStrictEqual({ status: "success" });

  expect(
    indexingFunctions[
      "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
    ],
  ).toHaveBeenCalledTimes(2);
  expect(
    indexingFunctions[
      "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
    ],
  ).toHaveBeenCalledWith({
    event: {
      name: "Transfer(address indexed from, address indexed to, uint256 amount)",
      args: expect.any(Object),
      log: expect.any(Object),
      block: expect.any(Object),
      transaction: expect.any(Object),
      transactionReceipt: expect.any(Object),
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

test("processEvents killed", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      vi.fn(),
  };

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });
  kill(indexingService);

  const rawEvents = await getEventsErc20(sources);
  const events = decodeEvents(syncService, rawEvents);
  const result = await processEvents(indexingService, {
    events,
  });
  expect(result).toStrictEqual({ status: "killed" });

  expect(
    indexingFunctions[
      "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
    ],
  ).toHaveBeenCalledTimes(0);

  await cleanup();
});

test("processEvents eventCount", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      vi.fn(),
  };

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  const rawEvents = await getEventsErc20(sources);
  const events = decodeEvents(syncService, rawEvents);
  const result = await processEvents(indexingService, {
    events,
  });
  expect(result).toStrictEqual({ status: "success" });

  expect(indexingService.eventCount).toStrictEqual({
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      {
        mainnet: 2,
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

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingFunctions = {
    "Erc20:setup": async ({ context }: { context: Context }) => {
      await context.client.getBalance({
        address: BOB,
      });
    },
  };

  const indexingService = create({
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

  expect(result).toStrictEqual({ status: "success" });

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

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingFunctions = {
    "Erc20:setup": async ({ context }: { context: Context }) => {
      await context.db.Supply.create({
        id: "supply",
        data: {
          supply: 0n,
        },
      });
    },
  };

  const indexingService = create({
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

  expect(result).toStrictEqual({ status: "success" });

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

test("executeSetup() metrics", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingService = create({
    indexingFunctions: {
      "Erc20:setup": vi.fn(),
    },
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
  expect(result).toStrictEqual({ status: "success" });

  const metrics = await common.metrics.ponder_indexing_function_duration.get();
  expect(metrics.values).toBeDefined();

  await cleanup();
});

test("executeSetup() retry", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingFunctions = {
    "Erc20:setup": vi.fn(),
  };

  const revertSpy = vi.spyOn(indexingStore, "revert");

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  indexingFunctions["Erc20:setup"].mockRejectedValueOnce(new Error());

  const result = await processSetupEvents(indexingService, {
    sources,
    networks,
  });
  expect(result).toStrictEqual({ status: "success" });

  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledTimes(2);

  expect(revertSpy).toHaveBeenCalledTimes(1);
  expect(revertSpy).toHaveBeenCalledWith({
    checkpoint: {
      ...zeroCheckpoint,
      chainId: 1,
      blockNumber: 0,
    },
    isCheckpointSafe: false,
  });

  await cleanup();
});

test("executeSetup() error", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingFunctions = {
    "Erc20:setup": vi.fn(),
  };

  const revertSpy = vi.spyOn(indexingStore, "revert");

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  indexingFunctions["Erc20:setup"].mockRejectedValue(new Error());

  const result = await processSetupEvents(indexingService, {
    sources,
    networks,
  });
  expect(result).toStrictEqual({ status: "error", error: expect.any(Error) });

  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledTimes(4);
  expect(revertSpy).toHaveBeenCalledTimes(3);

  await cleanup();
});

test("executeLog() context.client", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingService = create({
    indexingFunctions: {
      "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
        async ({ context }: { context: Context }) => {
          await context.client.getBalance({
            address: BOB,
          });
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
  const events = decodeEvents(syncService, rawEvents);
  const result = await processEvents(indexingService, {
    events,
  });
  expect(result).toStrictEqual({ status: "success" });

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

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingService = create({
    indexingFunctions: {
      "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
        async ({ event, context }: { event: any; context: Context }) => {
          await context.db.TransferEvent.create({
            id: event.log.id,
            data: {
              timestamp: Number(event.block.timestamp),
            },
          });
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
  const events = decodeEvents(syncService, rawEvents);
  const result = await processEvents(indexingService, {
    events,
  });
  expect(result).toStrictEqual({ status: "success" });

  expect(createSpy).toHaveBeenCalledTimes(2);

  const transferEvents = await indexingStore.findMany({
    tableName: "TransferEvent",
  });

  expect(transferEvents.items).toHaveLength(2);

  await cleanup();
});

test("executeLog() metrics", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingService = create({
    indexingFunctions: {
      "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
        vi.fn(),
    },
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  const rawEvents = await getEventsErc20(sources);
  const events = decodeEvents(syncService, rawEvents);
  await processEvents(indexingService, {
    events,
  });

  const metrics = await common.metrics.ponder_indexing_function_duration.get();
  expect(metrics.values).toBeDefined();

  await cleanup();
});

test("executeLog() retry", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      vi.fn(),
  };

  const revertSpy = vi.spyOn(indexingStore, "revert");

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  indexingFunctions[
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
  ].mockRejectedValueOnce(new Error());

  const rawEvents = await getEventsErc20(sources);
  const events = decodeEvents(syncService, rawEvents);
  const result = await processEvents(indexingService, {
    events,
  });

  expect(result).toStrictEqual({
    status: "success",
  });
  expect(
    indexingFunctions[
      "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
    ],
  ).toHaveBeenCalledTimes(3);

  expect(revertSpy).toHaveBeenCalledTimes(1);
  expect(revertSpy).toHaveBeenCalledWith({
    checkpoint: decodeCheckpoint(events[0].encodedCheckpoint),
    isCheckpointSafe: false,
  });

  await cleanup();
});

test("executeLog() error", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      vi.fn(),
  };

  const revertSpy = vi.spyOn(indexingStore, "revert");

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  indexingFunctions[
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
  ].mockRejectedValue(new Error());

  const rawEvents = await getEventsErc20(sources);
  const events = decodeEvents(syncService, rawEvents);
  const result = await processEvents(indexingService, {
    events,
  });

  expect(result).toStrictEqual({
    status: "error",
    error: expect.any(Error),
  });
  expect(
    indexingFunctions[
      "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
    ],
  ).toHaveBeenCalledTimes(4);
  expect(revertSpy).toHaveBeenCalledTimes(3);

  await cleanup();
});

test("executeLog() error after killed", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const { promise, reject } = promiseWithResolvers();
  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      () => promise,
  };

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    syncService,
    indexingStore,
    schema,
  });

  const rawEvents = await getEventsErc20(sources);
  const events = decodeEvents(syncService, rawEvents);
  const resultPromise = processEvents(indexingService, { events });
  kill(indexingService);

  reject(new Error("anything"));

  const result = await resultPromise;
  expect(result).toStrictEqual({ status: "killed" });

  await cleanup();
});

test("ponderActions getBalance()", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingService = create({
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

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingService = create({
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

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingService = create({
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

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingService = create({
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

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingService = create({
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

  const syncService = await createSyncService({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
  });

  const indexingService = create({
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
