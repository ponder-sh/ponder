import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { deployErc20, deployMulticall, mintErc20 } from "@/_test/simulate.js";
import {
  getChain,
  getErc20IndexingBuild,
  getSimulatedEvent,
} from "@/_test/utils.js";
import { onchainTable } from "@/drizzle/onchain.js";
import type { IndexingCache } from "@/indexing-store/cache.js";
import { createCachedViemClient } from "@/indexing/client.js";
import {
  InvalidEventAccessError,
  type RetryableError,
} from "@/internal/errors.js";
import type { IndexingErrorHandler } from "@/internal/types.js";
import { createRpc } from "@/rpc/index.js";
import { parseEther, toHex, zeroAddress } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import {
  type Context,
  createColumnAccessPattern,
  createIndexing,
  getEventCount,
} from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

const account = onchainTable("account", (p) => ({
  address: p.hex().primaryKey(),
  balance: p.bigint().notNull(),
}));

const schema = { account };

const indexingErrorHandler: IndexingErrorHandler = {
  getRetryableError: () => {
    return indexingErrorHandler.error;
  },
  setRetryableError: (error: RetryableError) => {
    indexingErrorHandler.error = error;
  },
  clearRetryableError: () => {
    indexingErrorHandler.error = undefined;
  },
  error: undefined as RetryableError | undefined,
};

test("createIndexing()", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  const eventCount = getEventCount(indexingFunctions);
  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  expect(indexing).toBeDefined();
});

test("processSetupEvents() empty", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  const eventCount = getEventCount(indexingFunctions);
  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  await indexing.processSetupEvents({ db: indexingStore });
});

test("processSetupEvents()", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  const eventCount = getEventCount(indexingFunctions);
  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  await indexing.processSetupEvents({ db: indexingStore });

  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledOnce();
  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledWith({
    context: {
      chain: { id: 1, name: "mainnet" },
      contracts: {
        Erc20: {
          abi: expect.any(Object),
          address: zeroAddress,
          startBlock: sources[0]!.filter.fromBlock,
          endBlock: sources[0]!.filter.toBlock,
        },
      },
      client: expect.any(Object),
      db: expect.any(Object),
    },
  });
});

test("processEvent()", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);
  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const event = getSimulatedEvent({ source: sources[0], blockData });

  await indexing.processRealtimeEvents({ db: indexingStore, events: [event] });

  expect(
    indexingFunctions[
      "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
    ],
  ).toHaveBeenCalledTimes(1);
  expect(
    indexingFunctions[
      "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
    ],
  ).toHaveBeenCalledWith({
    event: {
      id: expect.any(String),
      args: expect.any(Object),
      log: expect.any(Object),
      block: expect.any(Object),
      transaction: expect.any(Object),
      transactionReceipt: undefined,
    },
    context: {
      chain: { id: 1, name: "mainnet" },
      contracts: {
        Erc20: {
          abi: expect.any(Object),
          // @ts-ignore
          address,
          startBlock: sources[0]!.filter.fromBlock,
          endBlock: sources[0]!.filter.toBlock,
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

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);
  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const event = getSimulatedEvent({ source: sources[0], blockData });

  await indexing.processRealtimeEvents({ db: indexingStore, events: [event] });

  const metrics = await common.metrics.ponder_indexing_completed_events.get();

  expect(metrics.values).toMatchInlineSnapshot(`
    [
      {
        "labels": {
          "event": "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
        },
        "value": 1,
      },
      {
        "labels": {
          "event": "Erc20:setup",
        },
        "value": 0,
      },
    ]
  `);
});

test("executeSetup() context.client", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  const eventCount = getEventCount(indexingFunctions);

  indexingFunctions["Erc20:setup"] = async ({
    context,
  }: { context: Context }) => {
    await context.client.getBalance({ address: BOB });
  };

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const getBalanceSpy = vi.spyOn(rpc, "request");

  await indexing.processSetupEvents({ db: indexingStore });

  expect(getBalanceSpy).toHaveBeenCalledOnce();
  expect(getBalanceSpy).toHaveBeenCalledWith(
    {
      method: "eth_getBalance",
      params: ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "0x0"],
    },
    expect.any(Object),
  );
});

test("executeSetup() context.db", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  indexingFunctions["Erc20:setup"] = async ({
    context,
  }: { context: Context }) => {
    await context.db
      .insert(account)
      .values({ address: zeroAddress, balance: 10n });
  };

  const eventCount = getEventCount(indexingFunctions);

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const insertSpy = vi.spyOn(indexingStore, "insert");

  await indexing.processSetupEvents({ db: indexingStore });

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

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  const eventCount = getEventCount(indexingFunctions);

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions,
      sources,
      chains: [chain],
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  await indexing.processSetupEvents({ db: indexingStore });

  const metrics = await common.metrics.ponder_indexing_function_duration.get();
  expect(metrics.values).toBeDefined();
});

test("executeSetup() error", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  const eventCount = getEventCount(indexingFunctions);

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  // @ts-ignore
  indexingFunctions["Erc20:setup"].mockRejectedValue(new Error());

  await expect(() =>
    indexing.processSetupEvents({ db: indexingStore }),
  ).rejects.toThrowError();

  expect(indexingFunctions["Erc20:setup"]).toHaveBeenCalledTimes(1);
});

test("processEvents() context.client", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  indexingFunctions[
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
  ] = async ({ context }: { context: Context }) => {
    await context.client.getBalance({ address: BOB });
  };

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions,
      sources,
      chains: [chain],
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const getBalanceSpy = vi.spyOn(rpc, "request");

  const event = getSimulatedEvent({ source: sources[0], blockData });
  await indexing.processRealtimeEvents({ db: indexingStore, events: [event] });

  expect(getBalanceSpy).toHaveBeenCalledTimes(1);
  expect(getBalanceSpy).toHaveBeenCalledWith(
    {
      method: "eth_getBalance",
      params: ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "0x2"],
    },
    expect.any(Object),
  );
});

test("processEvents() context.db", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  let i = 0;

  indexingFunctions[
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
  ] = async ({ context }: { event: any; context: Context }) => {
    await context.db.insert(account).values({
      address: `0x000000000000000000000000000000000000000${i++}`,
      balance: 10n,
    });
  };

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions,
      sources,
      chains: [chain],
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const insertSpy = vi.spyOn(indexingStore, "insert");

  const event = getSimulatedEvent({ source: sources[0], blockData });
  await indexing.processRealtimeEvents({ db: indexingStore, events: [event] });

  expect(insertSpy).toHaveBeenCalledTimes(1);

  const transferEvents = await indexingStore.sql.select().from(account);

  expect(transferEvents).toHaveLength(1);
});

test("processEvents() metrics", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions,
      sources,
      chains: [chain],
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const event = getSimulatedEvent({ source: sources[0], blockData });

  await indexing.processRealtimeEvents({ events: [event], db: indexingStore });

  const metrics = await common.metrics.ponder_indexing_function_duration.get();
  expect(metrics.values).toBeDefined();
});

test("processEvents() error", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  indexingFunctions[
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
    // @ts-ignore
  ]!.mockRejectedValue(new Error());

  const event = getSimulatedEvent({ source: sources[0], blockData });
  await expect(() =>
    indexing.processRealtimeEvents({ db: indexingStore, events: [event] }),
  ).rejects.toThrowError();

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

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  indexingFunctions[
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
  ] = async ({ event }: { event: any; context: Context }) => {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete event.transaction;
    throw new Error("empty transaction");
  };

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      indexingFunctions,
      sources,
      chains: [chain],
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const event = getSimulatedEvent({ source: sources[0], blockData });
  await expect(() =>
    indexing.processRealtimeEvents({ events: [event], db: indexingStore }),
  ).rejects.toThrowError();
});

test("processEvents() column selection", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  // TODO(kyle) remove setup functions from column selection resolution
  // @ts-ignore
  // biome-ignore lint/performance/noDelete: <explanation>
  delete indexingFunctions["Erc20:setup"];

  const eventCount = getEventCount(indexingFunctions);

  let count = 0;

  indexingFunctions[
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
  ] = async ({ event }: { event: any; context: Context }) => {
    event.transaction.gas;
    event.transaction.maxFeePerGas;
    if (count++ === 1001) {
      event.transaction.maxPriorityFeePerGas;
    }
  };

  const columnAccessPattern = createColumnAccessPattern({
    indexingBuild: { indexingFunctions },
  });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  const indexing = createIndexing({
    common,
    indexingBuild: {
      sources,
      chains: [chain],
      indexingFunctions,
    },
    client: cachedViemClient,
    eventCount,
    indexingErrorHandler,
    columnAccessPattern,
  });

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const events = Array.from({ length: 1001 }).map(() => event);

  await indexing.processHistoricalEvents({
    db: indexingStore,
    events,
    cache: {} as IndexingCache,
    updateIndexingSeconds: vi.fn(),
  });

  expect(sources[0]!.filter.include).toMatchInlineSnapshot(`
    [
      "transaction.gas",
      "transaction.maxFeePerGas",
      "log.address",
      "log.data",
      "log.logIndex",
      "log.removed",
      "log.topics",
      "transaction.transactionIndex",
      "transaction.from",
      "transaction.to",
      "transaction.hash",
      "transaction.type",
      "block.timestamp",
      "block.number",
      "block.hash",
    ]
  `);

  // Remove accessed property to simulate resolved column selection
  // @ts-ignore
  // biome-ignore lint/performance/noDelete: <explanation>
  delete event.event.transaction.maxPriorityFeePerGas;

  await expect(() =>
    indexing.processHistoricalEvents({
      events: [event],
      db: indexingStore,
      cache: {} as IndexingCache,
      updateIndexingSeconds: vi.fn(),
    }),
  ).rejects.toThrowError(
    new InvalidEventAccessError("transaction.maxPriorityFeePerGas"),
  );
});

test("ponderActions getBalance()", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

  const balance = await client.getBalance({ address: BOB });

  expect(balance).toBe(parseEther("10000"));
});

test("ponderActions getCode()", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

  const bytecode = await client.getCode({ address });

  expect(bytecode).toBeTruthy();
});

test("ponderActions getStorageAt()", async (context) => {
  const { common } = context;
  const { syncStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

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
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });

  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

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
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

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
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  // Mock requestQueue.request to throw ContractFunctionZeroDataError
  const requestSpy = vi.spyOn(rpc, "request");
  requestSpy.mockResolvedValueOnce("0x");

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

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
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { indexingFunctions, sources } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

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
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const chain = getChain();
  const rpc = createRpc({ common, chain });

  const { sources, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const eventCount = getEventCount(indexingFunctions);

  const event = getSimulatedEvent({ source: sources[0], blockData });

  const cachedViemClient = createCachedViemClient({
    common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  const client = cachedViemClient.getClient(chain);

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
