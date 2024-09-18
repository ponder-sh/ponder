import { BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getEventsBlock, getEventsLog, getEventsTrace } from "@/_test/utils.js";
import { createSchema } from "@/schema/schema.js";
import { createSync } from "@/sync/index.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
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

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

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

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingService = create({
    indexingFunctions: {},
    common,
    sources,
    networks,
    sync,
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

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingService = create({
    indexingFunctions: {},
    common,
    sources,
    networks,
    sync,
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

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingFunctions = {
    "Erc20:setup": vi.fn(),
  };

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    sync,
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
          address: checksumAddress(sources[0].filter.address as Address),
          startBlock: sources[0].filter.fromBlock,
          endBlock: sources[0].filter.toBlock,
        },
        Pair: {
          abi: expect.any(Object),
          address: undefined,
          startBlock: sources[1].filter.fromBlock,
          endBlock: sources[1].filter.toBlock,
        },
        Factory: {
          abi: expect.any(Object),
          address: checksumAddress(
            sources[2].filter.toAddress.address as Address,
          ),
          startBlock: sources[2].filter.fromBlock,
          endBlock: sources[2].filter.toBlock,
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

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      vi.fn(),
    "Pair:Swap": vi.fn(),
  };

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  const rawEvents = await getEventsLog(sources);
  const events = decodeEvents(common, sources, rawEvents);
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
          address: checksumAddress(sources[0].filter.address as Address),
          startBlock: sources[0].filter.fromBlock,
          endBlock: sources[0].filter.toBlock,
        },
        Pair: {
          abi: expect.any(Object),
          address: undefined,
          startBlock: sources[1].filter.fromBlock,
          endBlock: sources[1].filter.toBlock,
        },
        Factory: {
          abi: expect.any(Object),
          address: checksumAddress(
            sources[2].filter.toAddress.address as Address,
          ),
          startBlock: sources[2].filter.fromBlock,
          endBlock: sources[2].filter.toBlock,
        },
      },
      client: expect.any(Object),
      db: expect.any(Object),
    },
  });

  await cleanup();
});

test("processEvents() block events", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingFunctions = {
    "OddBlocks:block": vi.fn(),
  };

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  const rawEvents = await getEventsBlock(sources);
  const events = decodeEvents(common, sources, rawEvents);
  const result = await processEvents(indexingService, {
    events,
  });
  expect(result).toStrictEqual({ status: "success" });

  expect(indexingFunctions["OddBlocks:block"]).toHaveBeenCalledTimes(1);
  expect(indexingFunctions["OddBlocks:block"]).toHaveBeenCalledWith({
    event: {
      block: expect.any(Object),
    },
    context: {
      network: { chainId: 1, name: "mainnet" },
      contracts: {
        Erc20: {
          abi: expect.any(Object),
          address: checksumAddress(sources[0].filter.address as Address),
          startBlock: sources[0].filter.fromBlock,
          endBlock: sources[0].filter.toBlock,
        },
        Pair: {
          abi: expect.any(Object),
          address: undefined,
          startBlock: sources[1].filter.fromBlock,
          endBlock: sources[1].filter.toBlock,
        },
        Factory: {
          abi: expect.any(Object),
          address: checksumAddress(
            sources[2].filter.toAddress.address as Address,
          ),
          startBlock: sources[2].filter.fromBlock,
          endBlock: sources[2].filter.toBlock,
        },
      },
      client: expect.any(Object),
      db: expect.any(Object),
    },
  });

  await cleanup();
});

test("processEvents() call trace events", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingFunctions = {
    "Factory.createPair()": vi.fn(),
  };

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  const rawEvents = await getEventsTrace(sources);
  const events = decodeEvents(common, sources, rawEvents);
  const result = await processEvents(indexingService, {
    events,
  });
  expect(result).toStrictEqual({ status: "success" });

  expect(indexingFunctions["Factory.createPair()"]).toHaveBeenCalledTimes(1);
  expect(indexingFunctions["Factory.createPair()"]).toHaveBeenCalledWith({
    event: {
      args: undefined,
      result: expect.any(String),
      block: expect.any(Object),
      trace: expect.any(Object),
      transaction: expect.any(Object),
      transactionReceipt: expect.any(Object),
    },
    context: {
      network: { chainId: 1, name: "mainnet" },
      contracts: {
        Erc20: {
          abi: expect.any(Object),
          address: checksumAddress(sources[0].filter.address as Address),
          startBlock: sources[0].filter.fromBlock,
          endBlock: sources[0].filter.toBlock,
        },
        Pair: {
          abi: expect.any(Object),
          address: undefined,
          startBlock: sources[1].filter.fromBlock,
          endBlock: sources[1].filter.toBlock,
        },
        Factory: {
          abi: expect.any(Object),
          address: checksumAddress(
            sources[2].filter.toAddress.address as Address,
          ),
          startBlock: sources[2].filter.fromBlock,
          endBlock: sources[2].filter.toBlock,
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

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      vi.fn(),
    "Pair:Swap": vi.fn(),
  };

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });
  kill(indexingService);

  const rawEvents = await getEventsLog(sources);
  const events = decodeEvents(common, sources, rawEvents);
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

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      vi.fn(),
    "Pair:Swap": vi.fn(),
  };

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  const rawEvents = await getEventsLog(sources);
  const events = decodeEvents(common, sources, rawEvents);
  const result = await processEvents(indexingService, {
    events,
  });
  expect(result).toStrictEqual({ status: "success" });

  expect(indexingService.eventCount).toStrictEqual({
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)": 2,
    "Pair:Swap": 1,
  });

  await cleanup();
});

test("executeSetup() context.client", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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
    sync,
    indexingStore,
    schema,
  });

  const getBalanceSpy = vi.spyOn(
    indexingService.clientByChainId[1]!,
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

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingFunctions = {
    "Erc20:setup": async ({ context }: { context: Context }) => {
      await context.db.Supply!.create({
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
    sync,
    indexingStore,
    schema,
  });

  const createSpy = vi.spyOn(
    indexingService.currentEvent.context.db.Supply!,
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

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingService = create({
    indexingFunctions: {
      "Erc20:setup": vi.fn(),
    },
    common,
    sources,
    networks,
    sync,
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

test("executeSetup() error", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingFunctions = {
    "Erc20:setup": vi.fn(),
  };

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  indexingFunctions["Erc20:setup"].mockRejectedValue(new Error());

  const result = await processSetupEvents(indexingService, {
    sources,
    networks,
  });
  expect(result).toStrictEqual({ status: "error", error: expect.any(Error) });

  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledTimes(1);

  await cleanup();
});

test("processEvents() context.client", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const clientCall = async ({ context }: { context: Context }) => {
    await context.client.getBalance({
      address: BOB,
    });
  };

  const indexingService = create({
    indexingFunctions: {
      "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
        clientCall,
      "Pair:Swap": clientCall,
      "OddBlocks:block": clientCall,
      "Factory.createPair()": clientCall,
    },
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  const getBalanceSpy = vi.spyOn(
    indexingService.clientByChainId[1]!,
    "getBalance",
  );

  const rawEvents = [
    ...(await getEventsLog(sources)),
    ...(await getEventsBlock(sources)),
    ...(await getEventsTrace(sources)),
  ];
  const events = decodeEvents(common, sources, rawEvents);
  const result = await processEvents(indexingService, {
    events,
  });
  expect(result).toStrictEqual({ status: "success" });

  expect(getBalanceSpy).toHaveBeenCalledTimes(5);
  expect(getBalanceSpy).toHaveBeenCalledWith({
    address: BOB,
  });

  await cleanup();
});

test("processEvents() context.db", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const dbCall = async ({
    event,
    context,
  }: { event: any; context: Context }) => {
    await context.db.TransferEvent!.create({
      id: event.transaction?.hash ?? event.block.hash,
      data: {
        timestamp: Number(event.block.timestamp),
      },
    });
  };

  const indexingService = create({
    indexingFunctions: {
      "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
        dbCall,
      "Pair:Swap": dbCall,
      "OddBlocks:block": dbCall,
      "Factory.createPair()": dbCall,
    },
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  const createSpy = vi.spyOn(
    indexingService.currentEvent.context.db.TransferEvent!,
    "create",
  );

  const rawEvents = [
    ...(await getEventsLog(sources)),
    ...(await getEventsBlock(sources)),
    ...(await getEventsTrace(sources)),
  ];
  const events = decodeEvents(common, sources, rawEvents);
  const result = await processEvents(indexingService, {
    events,
  });
  expect(result).toStrictEqual({ status: "success" });

  expect(createSpy).toHaveBeenCalledTimes(5);

  const transferEvents = await indexingStore.findMany({
    tableName: "TransferEvent",
  });

  expect(transferEvents.items).toHaveLength(5);

  await cleanup();
});

test("processEvents() metrics", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingService = create({
    indexingFunctions: {
      "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
        vi.fn(),
      "Pair:Swap": vi.fn(),
      "OddBlocks:block": vi.fn(),
      "Factory.createPair()": vi.fn(),
    },
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  const rawEvents = [
    ...(await getEventsLog(sources)),
    ...(await getEventsBlock(sources)),
    ...(await getEventsTrace(sources)),
  ];
  const events = decodeEvents(common, sources, rawEvents);
  await processEvents(indexingService, {
    events,
  });

  const metrics = await common.metrics.ponder_indexing_function_duration.get();
  expect(metrics.values).toBeDefined();

  await cleanup();
});

test("processEvents() error", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      vi.fn(),
    "Pair:Swap": vi.fn(),
    "OddBlocks:block": vi.fn(),
    "Factory.createPair()": vi.fn(),
  };

  const indexingService = create({
    indexingFunctions,
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  indexingFunctions[
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
  ].mockRejectedValue(new Error());

  const rawEvents = [
    ...(await getEventsLog(sources)),
    ...(await getEventsBlock(sources)),
    ...(await getEventsTrace(sources)),
  ];
  const events = decodeEvents(common, sources, rawEvents);
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
  ).toHaveBeenCalledTimes(1);
  expect(indexingFunctions["Pair:Swap"]).toHaveBeenCalledTimes(0);
  expect(indexingFunctions["OddBlocks:block"]).toHaveBeenCalledTimes(0);
  expect(indexingFunctions["Factory.createPair()"]).toHaveBeenCalledTimes(0);

  await cleanup();
});

test("execute() error after killed", async (context) => {
  const { common, sources, networks } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
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
    sync,
    indexingStore,
    schema,
  });

  const rawEvents = await getEventsLog(sources);
  const events = decodeEvents(common, sources, rawEvents);
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

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingService = create({
    indexingFunctions: {},
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  const balance = await indexingService.clientByChainId[1]!.getBalance({
    address: BOB,
  });

  expect(balance).toBe(parseEther("10000"));

  await cleanup();
});

test("ponderActions getCode()", async (context) => {
  const { common, sources, networks, erc20 } = context;
  const { syncStore, indexingStore, cleanup } = await setupDatabaseServices(
    context,
    { schema },
  );

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingService = create({
    indexingFunctions: {},
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  const bytecode = await indexingService.clientByChainId[1]!.getCode({
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

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingService = create({
    indexingFunctions: {},
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  const storage = await indexingService.clientByChainId[1]!.getStorageAt({
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

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingService = create({
    indexingFunctions: {},
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  const totalSupply = await indexingService.clientByChainId[1]!.readContract({
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

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingService = create({
    indexingFunctions: {},
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  const totalSupply = await indexingService.clientByChainId[1]!.readContract({
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

  const sync = await createSync({
    common,
    syncStore,
    networks,
    sources,
    onRealtimeEvent: () => Promise.resolve(),
    onFatalError: () => {},
    initialCheckpoint: encodeCheckpoint(zeroCheckpoint),
  });

  const indexingService = create({
    indexingFunctions: {},
    common,
    sources,
    networks,
    sync,
    indexingStore,
    schema,
  });

  const [totalSupply] = await indexingService.clientByChainId[1]!.multicall({
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
