import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupCleanup,
  setupCommon,
  setupDatabase,
  setupPonder,
} from "@/_test/setup.js";
import { deployErc20, deployMulticall, mintErc20 } from "@/_test/simulate.js";
import { getErc20ConfigAndIndexingFunctions } from "@/_test/utils.js";
import { onchainTable } from "@/drizzle/onchain.js";
import { createRealtimeIndexingStore } from "@/indexing-store/realtime.js";
import { createCachedViemClient } from "@/indexing/client.js";
import type { Event, LogEvent, RawEvent } from "@/internal/types.js";
import { createRpc } from "@/rpc/index.js";
import { decodeEvents } from "@/sync/events.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { checksumAddress, padHex, parseEther, toHex, zeroAddress } from "viem";
import { encodeEventTopics } from "viem/utils";
import { beforeEach, expect, test, vi } from "vitest";
import { type Context, createIndexing } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupDatabase);
beforeEach(setupCleanup);

const account = onchainTable("account", (p) => ({
  address: p.hex().primaryKey(),
  balance: p.bigint().notNull(),
}));

const schema = { account };

const { config, indexingFunctions } = getErc20ConfigAndIndexingFunctions({
  address: zeroAddress,
});

test("createIndexing()", async (context) => {
  const app = await setupPonder(context, true, {
    config,
    indexingFunctions,
  });

  const eventCount = {};

  const cachedViemClient = createCachedViemClient(app, {
    eventCount,
  });

  const indexing = createIndexing(app, {
    client: cachedViemClient,
    eventCount,
  });

  expect(indexing).toBeDefined();
});

test("processSetupEvents() empty", async (context) => {
  const app = await setupPonder(context, true, {
    config,
    indexingFunctions,
  });

  const eventCount = {};

  const cachedViemClient = createCachedViemClient(app, {
    eventCount,
  });

  const indexing = createIndexing(app, {
    client: cachedViemClient,
    eventCount,
  });

  const indexingStore = createRealtimeIndexingStore(app);

  const result = await indexing.processSetupEvents({ db: indexingStore });

  expect(result).toStrictEqual({ status: "success" });
});

test("processSetupEvents()", async (context) => {
  const indexingFunctions = [
    {
      name: "Erc20:setup",
      fn: vi.fn(),
    },
  ];

  const app = await setupPonder(context, true, {
    config,
    indexingFunctions,
  });

  const eventCount = { "Erc20:setup": 0 };

  const cachedViemClient = createCachedViemClient(app, {
    eventCount,
  });

  const indexing = createIndexing(app, {
    client: cachedViemClient,
    eventCount,
  });

  const indexingStore = createRealtimeIndexingStore(app);

  const result = await indexing.processSetupEvents({ db: indexingStore });

  expect(result).toStrictEqual({ status: "success" });

  expect(indexingFunctions[0]!.fn).toHaveBeenCalledOnce();
  expect(indexingFunctions[0]!.fn).toHaveBeenCalledWith({
    context: {
      chain: { chainId: 1, name: "mainnet" },
      contracts: {
        Erc20: {
          abi: expect.any(Object),
          // @ts-ignore
          address: checksumAddress(app.indexingBuild[0]!.filters[0]!.address),
          startBlock: app.indexingBuild[0]!.filters[0]!.fromBlock,
          endBlock: app.indexingBuild[0]!.filters[0]!.toBlock,
        },
      },
      client: expect.any(Object),
      db: expect.any(Object),
    },
  });
});

test.only("processEvent()", async (context) => {
  const indexingFunctions = [
    {
      name: "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
      fn: vi.fn(),
    },
    {
      name: "Pair:Swap",
      fn: vi.fn(),
    },
  ];

  const app = await setupPonder(context, true, { config, indexingFunctions });
  const perChainApp = { ...app, indexingBuild: app.indexingBuild[0]! };

  const eventCount = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)": 0,
    "Pair:Swap": 0,
  };

  const cachedViemClient = createCachedViemClient(app, { eventCount });

  const indexing = createIndexing(app, {
    client: cachedViemClient,
    eventCount,
  });

  const indexingStore = createRealtimeIndexingStore(perChainApp);

  const topics = encodeEventTopics({
    abi: erc20ABI,
    eventName: "Transfer",
    args: {
      from: zeroAddress,
      to: ALICE,
    },
  });

  const data = padHex(toHex(parseEther("1")), { size: 32 });

  const rawEvent = {
    checkpoint: ZERO_CHECKPOINT_STRING,
    chain: app.indexingBuild[0]!.chain,
    eventCallback: app.indexingBuild[0]!.eventCallbacks[0]!,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: { data, topics },
  } as RawEvent;

  const events = decodeEvents(perChainApp, { rawEvents: [rawEvent] });
  const result = await indexing.processEvents({ db: indexingStore, events });
  expect(result).toStrictEqual({ status: "success" });

  expect(indexingFunctions[0]!.fn).toHaveBeenCalledTimes(1);
  expect(indexingFunctions[0]!.fn).toHaveBeenCalledWith({
    event: {
      id: expect.any(String),
      args: expect.any(Object),
      log: expect.any(Object),
      block: expect.any(Object),
      transaction: expect.any(Object),
      transactionReceipt: undefined,
    },
    context: {
      chain: { chainId: 1, name: "mainnet" },
      contracts: {
        Erc20: {
          abi: expect.any(Object),
          address: checksumAddress(
            // @ts-ignore
            perChainApp.indexingBuild.filters[0]!.address,
          ),
          startBlock: perChainApp.indexingBuild.filters[0]!.fromBlock,
          endBlock: perChainApp.indexingBuild.filters[0]!.toBlock,
        },
      },
      client: expect.any(Object),
      db: expect.any(Object),
    },
  });
});

test("processEvents eventCount", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      vi.fn(),
  };
  const eventCount = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)": 0,
  };

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [createRpc({ common, chain: chains[0]! })],
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains,
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
  });

  const topics = encodeEventTopics({
    abi: erc20ABI,
    eventName: "Transfer",
    args: { from: zeroAddress, to: ALICE },
  });

  const data = padHex(toHex(parseEther("1")), { size: 32 });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: { data, topics },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]);
  await indexing.processEvents({ db: indexingStore, events });

  const metrics = await common.metrics.ponder_indexing_completed_events.get();

  expect(metrics.values).toMatchInlineSnapshot(`
    [
      {
        "labels": {
          "event": "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
        },
        "value": 1,
      },
    ]
  `);
});

test("executeSetup() context.client", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingFunctions = {
    "Erc20:setup": async ({ context }: { context: Context }) => {
      await context.client.getBalance({
        address: BOB,
      });
    },
  };

  const rpc = createRpc({ common, chain: chains[0]! });

  const eventCount = {};

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [rpc],
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains,
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
  });

  const getBalanceSpy = vi.spyOn(rpc, "request");

  const result = await indexing.processSetupEvents({ db: indexingStore });

  expect(result).toStrictEqual({ status: "success" });

  expect(getBalanceSpy).toHaveBeenCalledOnce();
  expect(getBalanceSpy).toHaveBeenCalledWith({
    method: "eth_getBalance",
    params: ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "latest"],
  });
});

test("executeSetup() context.db", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingFunctions = {
    "Erc20:setup": async ({ context }: { context: Context }) => {
      await context.db
        .insert(account)
        .values({ address: zeroAddress, balance: 10n });
    },
  };
  const eventCount = { "Erc20:setup": 0 };

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [createRpc({ common, chain: chains[0]! })],
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains,
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
  });

  const insertSpy = vi.spyOn(indexingStore, "insert");

  const result = await indexing.processSetupEvents({ db: indexingStore });

  expect(result).toStrictEqual({ status: "success" });

  expect(insertSpy).toHaveBeenCalledOnce();

  const supply = await indexingStore.find(account, { address: zeroAddress });
  expect(supply).toMatchObject({
    address: zeroAddress,
    balance: 10n,
  });
});

test("executeSetup() metrics", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const eventCount = { "Erc20:setup": 0 };

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [createRpc({ common, chain: chains[0]! })],
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions: {
        "Erc20:setup": vi.fn(),
      },
      sources,
      chains,
    },
    client: cachedViemClient,
    eventCount,
  });

  const result = await indexing.processSetupEvents({ db: indexingStore });
  expect(result).toStrictEqual({ status: "success" });

  const metrics = await common.metrics.ponder_indexing_function_duration.get();
  expect(metrics.values).toBeDefined();
});

test("executeSetup() error", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingFunctions = {
    "Erc20:setup": vi.fn(),
  };

  const eventCount = { "Erc20:setup": 0 };

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [createRpc({ common, chain: chains[0]! })],
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains,
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
  });

  indexingFunctions["Erc20:setup"].mockRejectedValue(new Error());

  const result = await indexing.processSetupEvents({ db: indexingStore });
  expect(result).toStrictEqual({ status: "error", error: expect.any(Error) });

  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledTimes(1);
});

test("processEvents() context.client", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const clientCall = async ({ context }: { context: Context }) => {
    await context.client.getBalance({
      address: BOB,
    });
  };

  const rpc = createRpc({ common, chain: chains[0]! });

  const eventCount = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)": 0,
  };

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [rpc],
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions: {
        "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
          clientCall,
      },
      sources,
      chains,
    },
    client: cachedViemClient,
    eventCount,
  });

  const getBalanceSpy = vi.spyOn(rpc, "request");

  const topics = encodeEventTopics({
    abi: erc20ABI,
    eventName: "Transfer",
    args: {
      from: zeroAddress,
      to: ALICE,
    },
  });

  const data = padHex(toHex(parseEther("1")), { size: 32 });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: { data, topics },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]);
  const result = await indexing.processEvents({ db: indexingStore, events });
  expect(result).toStrictEqual({ status: "success" });

  expect(getBalanceSpy).toHaveBeenCalledTimes(1);
  expect(getBalanceSpy).toHaveBeenCalledWith({
    method: "eth_getBalance",
    params: ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "latest"],
  });
});

test("processEvents() context.db", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  let i = 0;

  const dbCall = async ({ context }: { event: any; context: Context }) => {
    await context.db.insert(account).values({
      address: `0x000000000000000000000000000000000000000${i++}`,
      balance: 10n,
    });
  };

  const eventCount = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)": 0,
  };

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [createRpc({ common, chain: chains[0]! })],
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions: {
        "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
          dbCall,
      },
      sources,
      chains,
    },
    client: cachedViemClient,
    eventCount,
  });

  const insertSpy = vi.spyOn(indexingStore, "insert");

  const topics = encodeEventTopics({
    abi: erc20ABI,
    eventName: "Transfer",
    args: {
      from: zeroAddress,
      to: ALICE,
    },
  });

  const data = padHex(toHex(parseEther("1")), { size: 32 });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: { data, topics },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]);
  const result = await indexing.processEvents({ db: indexingStore, events });
  expect(result).toStrictEqual({ status: "success" });

  expect(insertSpy).toHaveBeenCalledTimes(1);

  const transferEvents = await indexingStore.sql.select().from(account);

  expect(transferEvents).toHaveLength(1);
});

test("processEvents() metrics", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const eventCount = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)": 0,
  };

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [createRpc({ common, chain: chains[0]! })],
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions: {
        "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
          vi.fn(),
      },
      sources,
      chains,
    },
    client: cachedViemClient,
    eventCount,
  });

  const topics = encodeEventTopics({
    abi: erc20ABI,
    eventName: "Transfer",
    args: {
      from: zeroAddress,
      to: ALICE,
    },
  });

  const data = padHex(toHex(parseEther("1")), { size: 32 });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: { data, topics },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]);
  await indexing.processEvents({
    events,
    db: indexingStore,
  });

  const metrics = await common.metrics.ponder_indexing_function_duration.get();
  expect(metrics.values).toBeDefined();
});

test("processEvents() error", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      vi.fn(),
  };

  const eventCount = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)": 0,
  };

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [createRpc({ common, chain: chains[0]! })],
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains,
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
  });

  indexingFunctions[
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
  ].mockRejectedValue(new Error());

  const topics = encodeEventTopics({
    abi: erc20ABI,
    eventName: "Transfer",
    args: {
      from: zeroAddress,
      to: ALICE,
    },
  });

  const data = padHex(toHex(parseEther("1")), { size: 32 });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: { data, topics },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]);
  const result = await indexing.processEvents({ db: indexingStore, events });

  expect(result).toStrictEqual({
    status: "error",
    error: expect.any(Error),
  });
  expect(
    indexingFunctions[
      "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
    ],
  ).toHaveBeenCalledTimes(1);
});

test("processEvents() error with missing event object properties", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const chain = getChain();

  const throwError = async ({ event }: { event: any; context: Context }) => {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete event.transaction;
    throw new Error("empty transaction");
  };

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      throwError,
  };

  const eventCount = {};

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain] },
    rpcs: [createRpc({ common, chain })],
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions,
      sources,
      chains,
    },
    client: cachedViemClient,
    eventCount,
  });

  const topics = encodeEventTopics({
    abi: erc20ABI,
    eventName: "Transfer",
    args: {
      from: zeroAddress,
      to: ALICE,
    },
  });

  const data = padHex(toHex(parseEther("1")), { size: 32 });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: { data, topics },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]);
  const result = await indexing.processEvents({ events, db: indexingStore });

  expect(result).toMatchInlineSnapshot(`
    {
      "error": [Error: empty transaction],
      "status": "error",
    }
  `);
});

test("ponderActions getBalance()", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const eventCount = {};

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [createRpc({ common, chain: chains[0]! })],
    syncStore,
    eventCount,
  });
  cachedViemClient.event = {
    type: "log",
    event: { block: { number: 0n } },
  } as Event;

  const client = cachedViemClient.getClient(chains[0]!);

  const balance = await client.getBalance({ address: BOB });

  expect(balance).toBe(parseEther("10000"));
});

test("ponderActions getCode()", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });

  const eventCount = { "Contract:Event": 0 };

  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "Contract:Event",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: {
        from: zeroAddress,
        to: ALICE,
        amount: parseEther("1"),
      },
      log: {} as LogEvent["event"]["log"],
      block: { number: 1n } as LogEvent["event"]["block"],
      transaction: {} as LogEvent["event"]["transaction"],
    },
  } satisfies LogEvent;

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [createRpc({ common, chain: chains[0]! })],
    syncStore,
    eventCount,
  });

  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chains[0]!);

  const bytecode = await client.getCode({
    address,
  });

  expect(bytecode).toBeTruthy();
});

test("ponderActions getStorageAt()", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const eventCount = {};

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [createRpc({ common, chain: chains[0]! })],
    syncStore,
    eventCount,
  });
  cachedViemClient.event = {
    type: "log",
    event: { block: { number: 2n } },
  } as Event;

  const client = cachedViemClient.getClient(chains[0]!);

  const storage = await client.getStorageAt({
    address,
    // totalSupply is in the third storage slot
    slot: toHex(2),
  });

  expect(BigInt(storage!)).toBe(parseEther("1"));
});

test("ponderActions readContract()", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "Contract:Event",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: {
        from: zeroAddress,
        to: ALICE,
        amount: parseEther("1"),
      },
      log: {} as LogEvent["event"]["log"],
      block: { number: 2n } as LogEvent["event"]["block"],
      transaction: {} as LogEvent["event"]["transaction"],
    },
  } satisfies LogEvent;

  const eventCount = { "Contract:Event": 0 };

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [createRpc({ common, chain: chains[0]! })],
    syncStore,
    eventCount,
  });

  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chains[0]!);

  const totalSupply = await client.readContract({
    abi: erc20ABI,
    functionName: "totalSupply",
    address,
  });

  expect(totalSupply).toMatchInlineSnapshot("1000000000000000000n");
});

test("ponderActions readContract() blockNumber", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "Contract:Event",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: {
        from: zeroAddress,
        to: ALICE,
        amount: parseEther("1"),
      },
      log: {} as LogEvent["event"]["log"],
      block: { number: 2n } as LogEvent["event"]["block"],
      transaction: {} as LogEvent["event"]["transaction"],
    },
  } satisfies LogEvent;

  const eventCount = { "Contract:Event": 0 };

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [createRpc({ common, chain: chains[0]! })],
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chains[0]!);

  const totalSupply = await client.readContract({
    abi: erc20ABI,
    functionName: "totalSupply",
    address,
    blockNumber: 1n,
  });

  expect(totalSupply).toMatchInlineSnapshot("0n");
});

test("ponderActions readContract() ContractFunctionZeroDataError", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const rpc = createRpc({ common, chain: chains[0]! });

  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "Contract:Event",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: {
        from: zeroAddress,
        to: ALICE,
        amount: parseEther("1"),
      },
      log: {} as LogEvent["event"]["log"],
      block: { number: 2n } as LogEvent["event"]["block"],
      transaction: {} as LogEvent["event"]["transaction"],
    },
  } satisfies LogEvent;

  // Mock requestQueue.request to throw ContractFunctionZeroDataError
  const requestSpy = vi.spyOn(rpc, "request");
  requestSpy.mockResolvedValueOnce("0x");

  const eventCount = { "Contract:Event": 0 };

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [rpc],
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chains[0]!);

  const totalSupply = await client.readContract({
    abi: erc20ABI,
    functionName: "totalSupply",
    address,
  });

  expect(totalSupply).toBe(parseEther("1"));
  expect(requestSpy).toHaveBeenCalledTimes(2);
});

test("ponderActions multicall()", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address: multicall } = await deployMulticall({ sender: ALICE });
  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "Contract:Event",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: {
        from: zeroAddress,
        to: ALICE,
        amount: parseEther("1"),
      },
      log: {} as LogEvent["event"]["log"],
      block: { number: 3n } as LogEvent["event"]["block"],
      transaction: {} as LogEvent["event"]["transaction"],
    },
  } satisfies LogEvent;

  const eventCount = { "Contract:Event": 0 };

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [createRpc({ common, chain: chains[0]! })],
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chains[0]!);

  const [totalSupply] = await client.multicall({
    allowFailure: false,
    multicallAddress: multicall,
    contracts: [
      {
        abi: erc20ABI,
        functionName: "totalSupply",
        address,
      },
      {
        abi: erc20ABI,
        functionName: "totalSupply",
        address,
      },
    ],
  });

  expect(totalSupply).toMatchInlineSnapshot("1000000000000000000n");
});

test("ponderActions multicall() allowFailure", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address: multicall } = await deployMulticall({ sender: ALICE });
  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "Contract:Event",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: {
        from: zeroAddress,
        to: ALICE,
        amount: parseEther("1"),
      },
      log: {} as LogEvent["event"]["log"],
      block: { number: 3n } as LogEvent["event"]["block"],
      transaction: {} as LogEvent["event"]["transaction"],
    },
  } satisfies LogEvent;

  const eventCount = { "Contract:Event": 0 };

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains },
    rpcs: [createRpc({ common, chain: chains[0]! })],
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chains[0]!);

  const result = await client.multicall({
    allowFailure: true,
    multicallAddress: multicall,
    contracts: [
      {
        abi: erc20ABI,
        functionName: "totalSupply",
        address,
      },
      {
        abi: erc20ABI,
        functionName: "totalSupply",
        address,
      },
    ],
  });

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "result": 1000000000000000000n,
        "status": "success",
      },
      {
        "result": 1000000000000000000n,
        "status": "success",
      },
    ]
  `);
});
