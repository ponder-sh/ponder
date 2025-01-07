import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import {
  createPair,
  deployErc20,
  deployFactory,
  mintErc20,
  swapPair,
  transferEth,
} from "@/_test/simulate.js";
import {
  getAccountsConfigAndIndexingFunctions,
  getBlocksConfigAndIndexingFunctions,
  getErc20ConfigAndIndexingFunctions,
  getNetwork,
  getPairWithFactoryConfigAndIndexingFunctions,
} from "@/_test/utils.js";
import { buildConfigAndIndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import type { SyncTrace, SyncTransaction } from "@/types/sync.js";
import {
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import {
  _eth_getBlockByNumber,
  _eth_getLogs,
  _eth_getTransactionReceipt,
} from "@/utils/rpc.js";
import {
  type Hex,
  encodeEventTopics,
  padHex,
  parseEther,
  toHex,
  zeroAddress,
} from "viem";
import { encodeFunctionData, encodeFunctionResult } from "viem/utils";
import { beforeEach, expect, test } from "vitest";
import {
  type BlockEvent,
  type LogEvent,
  type RawEvent,
  type TraceEvent,
  type TransferEvent,
  buildEvents,
  decodeEventLog,
  decodeEvents,
} from "./events.js";
import type { LogFactory, LogFilter } from "./source.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("decodeEvents() log", async (context) => {
  const { common } = context;

  const { config, rawIndexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address: zeroAddress,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
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
    checkpoint: encodeCheckpoint(zeroCheckpoint),
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: {
      id: "test",
      data,
      topics,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [LogEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toMatchObject({
    from: zeroAddress,
    to: ALICE,
    amount: parseEther("1"),
  });
  expect(events[0].event.name).toBe(
    "Transfer(address indexed from, address indexed to, uint256 amount)",
  );
});

test("decodeEvents() log error", async (context) => {
  const { common } = context;

  const { config, rawIndexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address: zeroAddress,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const topics = encodeEventTopics({
    abi: erc20ABI,
    eventName: "Transfer",
    args: {
      from: zeroAddress,
      to: ALICE,
    },
  });

  // invalid log.data, causing an error when decoding
  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: encodeCheckpoint(zeroCheckpoint),
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: {
      id: "test",
      data: "0x0" as Hex,
      topics,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [LogEvent];

  expect(events).toHaveLength(0);
});

test("decodeEvents() block", async (context) => {
  const { common } = context;

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: encodeCheckpoint(zeroCheckpoint),
    block: {
      number: 1n,
    } as RawEvent["block"],
    transaction: undefined,
    log: undefined,
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [BlockEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.block).toMatchObject({
    number: 1n,
  });
});

test("decodeEvents() transfer", async (context) => {
  const { common } = context;

  const { config, rawIndexingFunctions } =
    getAccountsConfigAndIndexingFunctions({
      address: ALICE,
    });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 3,
    checkpoint: encodeCheckpoint(zeroCheckpoint),
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: {
      id: "test",
      type: "CALL",
      from: ALICE,
      to: BOB,
      gas: 0n,
      gasUsed: 0n,
      input: "0x0",
      output: "0x0",
      value: parseEther("1"),
      traceIndex: 0,
      subcalls: 0,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [TransferEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.transfer).toMatchObject({
    from: ALICE,
    to: BOB,
    value: parseEther("1"),
  });
  expect(events[0].name).toBe("Accounts:transfer:from");
});

test("decodeEvents() transaction", async (context) => {
  const { common } = context;

  const { config, rawIndexingFunctions } =
    getAccountsConfigAndIndexingFunctions({
      address: ALICE,
    });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 0,
    checkpoint: encodeCheckpoint(zeroCheckpoint),
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: undefined,
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [TransferEvent];

  expect(events).toHaveLength(1);

  expect(events[0].name).toBe("Accounts:transaction:to");
});

test("decodeEvents() trace", async (context) => {
  const { common } = context;

  const { config, rawIndexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address: zeroAddress,
    includeCallTraces: true,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 1,
    checkpoint: encodeCheckpoint(zeroCheckpoint),
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: {
      id: "test",
      type: "CALL",
      from: ALICE,
      to: BOB,
      input: encodeFunctionData({
        abi: erc20ABI,
        functionName: "transfer",
        args: [BOB, parseEther("1")],
      }),
      output: encodeFunctionResult({
        abi: erc20ABI,
        functionName: "transfer",
        result: true,
      }),
      gas: 0n,
      gasUsed: 0n,
      value: 0n,
      traceIndex: 0,
      subcalls: 0,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [TraceEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toStrictEqual([BOB, parseEther("1")]);
  expect(events[0].event.result).toBe(true);
  expect(events[0].name).toBe("Erc20.transfer()");
});

test("decodeEvents() trace error", async (context) => {
  const { common } = context;

  const { config, rawIndexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address: zeroAddress,
    includeCallTraces: true,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const rawEvent = {
    chainId: 1,
    sourceIndex: 1,
    checkpoint: encodeCheckpoint(zeroCheckpoint),
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: {
      id: "test",
      type: "CALL",
      from: ALICE,
      to: BOB,
      input: "0x",
      output: encodeFunctionResult({
        abi: erc20ABI,
        functionName: "transfer",
        result: true,
      }),
      gas: 0n,
      gasUsed: 0n,
      value: 0n,
      traceIndex: 0,
      subcalls: 0,
    },
  } as RawEvent;

  const events = decodeEvents(common, sources, [rawEvent]) as [TraceEvent];

  expect(events).toHaveLength(0);
});

test("buildEvents() matches getEvents() log", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { config, rawIndexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  // insert block 2

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
    chainId: 1,
  });

  const rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });
  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]!, block: rpcBlock }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });

  const { events: events1 } = await syncStore.getEvents({
    filters: sources.map((s) => s.filter),
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  const events2 = buildEvents({
    sources,
    chainId: 1,
    blockWithEventData: {
      block: rpcBlock,
      logs: rpcLogs,
      transactions: rpcBlock.transactions,
      traces: [],
      transactionReceipts: [],
    },
    finalizedChildAddresses: new Map(),
    unfinalizedChildAddresses: new Map(),
  });

  expect(events1).toHaveLength(1);

  expect(events2).toStrictEqual(events1);

  await cleanup();
});

test("buildEvents() matches getEvents() log factory", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { address } = await deployFactory({ sender: ALICE });
  const { result: pair } = await createPair({
    factory: address,
    sender: ALICE,
  });
  await swapPair({
    pair,
    amount0Out: 1n,
    amount1Out: 1n,
    to: ALICE,
    sender: ALICE,
  });

  const { config, rawIndexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  // insert block 2

  let rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });
  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]! }],
    shouldUpdateCheckpoint: false,
    chainId: 1,
  });

  // insert block 3

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 3,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
    chainId: 1,
  });

  rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 3,
    toBlock: 3,
  });
  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]!, block: rpcBlock }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });

  const { events: events1 } = await syncStore.getEvents({
    filters: sources.map((s) => s.filter),
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  const filter = sources[0]!.filter as LogFilter<LogFactory>;

  const events2 = buildEvents({
    sources,
    chainId: 1,
    blockWithEventData: {
      block: rpcBlock,
      logs: rpcLogs,
      transactions: rpcBlock.transactions,
      traces: [],
      transactionReceipts: [],
    },
    finalizedChildAddresses: new Map([[filter.address, new Set()]]),
    unfinalizedChildAddresses: new Map([[filter.address, new Set([pair])]]),
  });

  expect(events1).toHaveLength(1);

  expect(events2).toStrictEqual(events1);

  await cleanup();
});

test("buildEvents() matches getEvents() block", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  // insert block 0

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 0,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  const { events: events1 } = await syncStore.getEvents({
    filters: sources.map((s) => s.filter),
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  const events2 = buildEvents({
    sources,
    chainId: 1,
    blockWithEventData: {
      block: rpcBlock,
      logs: [],
      transactions: [],
      traces: [],
      transactionReceipts: [],
    },
    finalizedChildAddresses: new Map(),
    unfinalizedChildAddresses: new Map(),
  });

  expect(events1).toHaveLength(1);

  expect(events2).toStrictEqual(events1);

  await cleanup();
});

test("buildEvents() matches getEvents() transfer", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { hash } = await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { config, rawIndexingFunctions } =
    getAccountsConfigAndIndexingFunctions({
      address: ALICE,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
    chainId: 1,
  });

  const rpcReceipt = await _eth_getTransactionReceipt(requestQueue, { hash });

  await syncStore.insertTransactionReceipts({
    transactionReceipts: [rpcReceipt],
    chainId: 1,
  });

  const rpcTrace = {
    trace: {
      type: "CALL",
      from: ALICE,
      to: BOB,
      gas: "0x0",
      gasUsed: "0x0",
      input: "0x0",
      output: "0x0",
      value: rpcBlock.transactions[0]!.value,
      index: 0,
      subcalls: 0,
    },
    transactionHash: hash,
  } satisfies SyncTrace;

  await syncStore.insertTraces({
    traces: [
      {
        trace: rpcTrace,
        block: rpcBlock,
        transaction: rpcBlock.transactions[0] as SyncTransaction,
      },
    ],
    chainId: 1,
  });

  const { events: events1 } = await syncStore.getEvents({
    filters: sources.map((s) => s.filter),
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  const events2 = buildEvents({
    sources,
    chainId: 1,
    blockWithEventData: {
      block: rpcBlock,
      logs: [],
      transactions: rpcBlock.transactions,
      traces: [rpcTrace],
      transactionReceipts: [rpcReceipt],
    },
    finalizedChildAddresses: new Map(),
    unfinalizedChildAddresses: new Map(),
  });

  // transaction:from and transfer:from
  expect(events1).toHaveLength(2);

  expect(events2).toStrictEqual(events1);

  await cleanup();
});

test("buildEvents() matches getEvents() transaction", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { hash } = await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { config, rawIndexingFunctions } =
    getAccountsConfigAndIndexingFunctions({
      address: ALICE,
    });

  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
    chainId: 1,
  });

  const rpcReceipt = await _eth_getTransactionReceipt(requestQueue, { hash });

  await syncStore.insertTransactionReceipts({
    transactionReceipts: [rpcReceipt],
    chainId: 1,
  });

  const { events: events1 } = await syncStore.getEvents({
    filters: sources.map((s) => s.filter),
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  const events2 = buildEvents({
    sources,
    chainId: 1,
    blockWithEventData: {
      block: rpcBlock,
      logs: [],
      transactions: rpcBlock.transactions,
      traces: [],
      transactionReceipts: [rpcReceipt],
    },
    finalizedChildAddresses: new Map(),
    unfinalizedChildAddresses: new Map(),
  });

  expect(events1).toHaveLength(1);

  expect(events2).toStrictEqual(events1);

  await cleanup();
});

test("buildEvents() matches getEvents() trace", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  const { hash } = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { config, rawIndexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address,
    includeCallTraces: true,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
    chainId: 1,
  });

  const rpcTrace = {
    trace: {
      type: "CALL",
      from: ALICE,
      to: address,
      gas: "0x0",
      gasUsed: "0x0",
      input: encodeFunctionData({
        abi: erc20ABI,
        functionName: "transfer",
        args: [BOB, parseEther("1")],
      }),
      output: encodeFunctionResult({
        abi: erc20ABI,
        functionName: "transfer",
        result: true,
      }),
      value: "0x0",
      index: 0,
      subcalls: 0,
    },
    transactionHash: hash,
  } satisfies SyncTrace;

  await syncStore.insertTraces({
    traces: [
      {
        trace: rpcTrace,
        block: rpcBlock,
        transaction: rpcBlock.transactions[0] as SyncTransaction,
      },
    ],
    chainId: 1,
  });

  const { events: events1 } = await syncStore.getEvents({
    filters: sources.map((s) => s.filter),
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  const events2 = buildEvents({
    sources,
    chainId: 1,
    blockWithEventData: {
      block: rpcBlock,
      logs: [],
      transactions: rpcBlock.transactions,
      traces: [rpcTrace],
      transactionReceipts: [],
    },
    finalizedChildAddresses: new Map(),
    unfinalizedChildAddresses: new Map(),
  });

  expect(events1).toHaveLength(1);

  expect(events2).toStrictEqual(events1);

  await cleanup();
});

test("decodeEventLog removes null characters", () => {
  // NameRegistered event from this transaction contains null characters:
  // https://etherscan.io/tx/0x2e67be22d5e700e61e102b926f28ba451c53a6cd6438c53b43dbb783c2081a12#eventlog
  const log = {
    topics: [
      "0xca6abbe9d7f11422cb6ca7629fbf6fe9efb1c621f71ce8f02b9f2a230097404f",
      "0x56e1003dc29ff83445ba93c493f4a76570eb667494e78c6974a745593131ae2a",
      "0x0000000000000000000000008504a09352555ff1acf9c8a8d9fb5fdcc4161cbc",
    ],
    data: "0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000697a5dd2a81dc000000000000000000000000000000000000000000000000000000006457430e000000000000000000000000000000000000000000000000000000000000001174656e63656e74636c7562000000000000000000000000000000000000000000",
  } as const;

  const abiItem = {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "string",
        name: "name",
        type: "string",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "label",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "cost",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "expires",
        type: "uint256",
      },
    ],
    name: "NameRegistered",
    type: "event",
  } as const;

  const args = decodeEventLog({
    abiItem,
    topics: log.topics as unknown as [signature: Hex, ...args: Hex[]],
    data: log.data,
  });

  // Failing test: 'tencentclub\x00\x00\x00\x00\x00\x00'
  expect(args.name).toBe("tencentclub");
});
