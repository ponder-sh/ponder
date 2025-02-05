import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { deployErc20, mintErc20 } from "@/_test/simulate.js";
import {
  getErc20ConfigAndIndexingFunctions,
  getNetwork,
} from "@/_test/utils.js";
import { buildConfigAndIndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import { onchainTable } from "@/drizzle/onchain.js";
import type { RawEvent } from "@/internal/types.js";
import { decodeEvents } from "@/sync/events.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import { checksumAddress, padHex, parseEther, toHex, zeroAddress } from "viem";
import { encodeEventTopics } from "viem/utils";
import { beforeEach, expect, test, vi } from "vitest";
import {
  type Context,
  create,
  processEvents,
  processSetupEvents,
  setIndexingStore,
} from "./service.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

const account = onchainTable("account", (p) => ({
  address: p.hex().primaryKey(),
  balance: p.bigint().notNull(),
}));

const schema = { account };

const { config, rawIndexingFunctions } = getErc20ConfigAndIndexingFunctions({
  address: zeroAddress,
});
const { sources, networks } = await buildConfigAndIndexingFunctions({
  config,
  rawIndexingFunctions,
});

test("createIndexing()", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions: {},
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

  expect(indexingService).toBeDefined();
});

test("processSetupEvents() empty", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions: {},
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

  const result = await processSetupEvents(indexingService, {
    sources,
    networks,
  });

  expect(result).toStrictEqual({ status: "success" });
});

test("processSetupEvents()", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingFunctions = {
    "Erc20:setup": vi.fn(),
  };

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions,
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

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
          // @ts-ignore
          address: checksumAddress(sources[0]!.filter.address),
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

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      vi.fn(),
    "Pair:Swap": vi.fn(),
  };

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions,
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

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
    log: {
      id: "test",
      data,
      topics,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]);
  const result = await processEvents(indexingService, {
    events,
  });
  expect(result).toStrictEqual({ status: "success" });

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
      name: "Transfer(address indexed from, address indexed to, uint256 amount)",
      args: expect.any(Object),
      log: expect.any(Object),
      block: expect.any(Object),
      transaction: expect.any(Object),
      transactionReceipt: undefined,
    },
    context: {
      network: { chainId: 1, name: "mainnet" },
      contracts: {
        Erc20: {
          abi: expect.any(Object),
          // @ts-ignore
          address: checksumAddress(sources[0]!.filter.address),
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

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      vi.fn(),
  };

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions,
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

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
    log: {
      id: "test",
      data,
      topics,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]);
  const result = await processEvents(indexingService, {
    events,
  });
  expect(result).toStrictEqual({ status: "success" });

  expect(indexingService.eventCount).toStrictEqual({
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)": 1,
  });
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

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions,
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

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

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions,
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

  const insertSpy = vi.spyOn(indexingService.currentEvent.context.db, "insert");

  const result = await processSetupEvents(indexingService, {
    sources,
    networks,
  });

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

  const indexingService = create({
    common,
    indexingBuild: {
      indexingFunctions: {
        "Erc20:setup": vi.fn(),
      },
      sources,
      networks,
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

  const result = await processSetupEvents(indexingService, {
    sources,
    networks,
  });
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

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions,
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

  indexingFunctions["Erc20:setup"].mockRejectedValue(new Error());

  const result = await processSetupEvents(indexingService, {
    sources,
    networks,
  });
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

  const indexingService = create({
    common,
    indexingBuild: {
      indexingFunctions: {
        "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
          clientCall,
      },
      sources,
      networks,
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

  const getBalanceSpy = vi.spyOn(
    indexingService.clientByChainId[1]!,
    "getBalance",
  );

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
    log: {
      id: "test",
      data,
      topics,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]);
  const result = await processEvents(indexingService, {
    events,
  });
  expect(result).toStrictEqual({ status: "success" });

  expect(getBalanceSpy).toHaveBeenCalledTimes(1);
  expect(getBalanceSpy).toHaveBeenCalledWith({
    address: BOB,
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

  const indexingService = create({
    common,
    indexingBuild: {
      indexingFunctions: {
        "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
          dbCall,
      },
      sources,
      networks,
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

  const insertSpy = vi.spyOn(indexingService.currentEvent.context.db, "insert");

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
    log: {
      id: "test",
      data,
      topics,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]);
  const result = await processEvents(indexingService, {
    events,
  });
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

  const indexingService = create({
    common,
    indexingBuild: {
      indexingFunctions: {
        "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
          vi.fn(),
      },
      sources,
      networks,
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

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
    log: {
      id: "test",
      data,
      topics,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]);
  await processEvents(indexingService, {
    events,
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

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions,
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

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
    log: {
      id: "test",
      data,
      topics,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]);
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
});

test("processEvents() error with missing event object properties", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const network = getNetwork();

  const throwError = async ({ event }: { event: any; context: Context }) => {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete event.transaction;
    throw new Error("empty transaction");
  };

  const indexingFunctions = {
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
      throwError,
  };

  const indexingService = create({
    common,
    indexingBuild: {
      indexingFunctions,
      sources,
      networks,
    },
    requestQueues: [createRequestQueue({ network, common: context.common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

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
    log: {
      id: "test",
      data,
      topics,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]);
  const result = await processEvents(indexingService, { events });

  expect(result).toMatchInlineSnapshot(`
    {
      "error": [Error: empty transaction],
      "status": "error",
    }
  `);
});

test("ponderActions getBalance()", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions: {},
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

  const balance = await indexingService.clientByChainId[1]!.getBalance({
    address: BOB,
  });

  expect(balance).toBe(parseEther("10000"));
});

test("ponderActions getCode()", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions: {},
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

  const bytecode = await indexingService.clientByChainId[1]!.getCode({
    address,
  });

  expect(bytecode).toBeTruthy();
});

test("ponderActions getStorageAt()", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions: {},
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

  const storage = await indexingService.clientByChainId[1]!.getStorageAt({
    address,
    // totalSupply is in the third storage slot
    slot: toHex(2),
  });

  expect(BigInt(storage!)).toBe(parseEther("1"));
});

test("ponderActions readContract()", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions: {},
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

  const totalSupply = await indexingService.clientByChainId[1]!.readContract({
    abi: erc20ABI,
    functionName: "totalSupply",
    address,
  });

  expect(totalSupply).toBe(parseEther("1"));
});

test("ponderActions readContract() blockNumber", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions: {},
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

  const totalSupply = await indexingService.clientByChainId[1]!.readContract({
    abi: erc20ABI,
    functionName: "totalSupply",
    address,
    blockNumber: 1n,
  });

  expect(totalSupply).toBe(parseEther("0"));
});

// Note: Kyle the local chain doesn't have a deployed instance of "multicall3"
test.skip("ponderActions multicall()", async (context) => {
  const { common } = context;
  const { syncStore, indexingStore } = await setupDatabaseServices(context, {
    schemaBuild: { schema },
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const indexingService = create({
    common,
    indexingBuild: {
      sources,
      networks,
      indexingFunctions: {},
    },
    requestQueues: [createRequestQueue({ network: networks[0]!, common })],
    syncStore,
  });

  setIndexingStore(indexingService, indexingStore);

  const [totalSupply] = await indexingService.clientByChainId[1]!.multicall({
    allowFailure: false,
    contracts: [
      {
        abi: erc20ABI,
        functionName: "totalSupply",
        address,
      },
    ],
  });

  expect(totalSupply).toBe(parseEther("1"));
});
