import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import {
  createPair,
  deployErc20,
  deployFactory,
  mintErc20,
} from "@/_test/simulate.js";
import {
  getBlocksConfigAndIndexingFunctions,
  getChain,
  getErc20ConfigAndIndexingFunctions,
  getPairWithFactoryConfigAndIndexingFunctions,
  testClient,
} from "@/_test/utils.js";
import { buildConfigAndIndexingFunctions } from "@/build/config.js";
import type {
  BlockFilter,
  Factory,
  LogFilter,
  SyncTrace,
  SyncTransaction,
} from "@/internal/types.js";
import { orderObject } from "@/utils/order.js";

import { createRpc } from "@/rpc/index.js";
import {
  _eth_getBlockByNumber,
  _eth_getLogs,
  _eth_getTransactionReceipt,
} from "@/utils/rpc.js";
import { sql } from "drizzle-orm";
import {
  encodeFunctionData,
  encodeFunctionResult,
  hexToBigInt,
  hexToNumber,
  parseEther,
  zeroAddress,
} from "viem";
import { beforeEach, expect, test } from "vitest";
import * as ponderSyncSchema from "./schema.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("getIntervals() empty", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const filter = {
    type: "block",
    chainId: 1,
    interval: 1,
    offset: 0,
    fromBlock: undefined,
    toBlock: undefined,
    include: [],
  } satisfies BlockFilter;

  const intervals = await syncStore.getIntervals({
    filters: [filter],
  });

  expect(intervals).toMatchInlineSnapshot(`
    Map {
      {
        "chainId": 1,
        "fromBlock": undefined,
        "include": [],
        "interval": 1,
        "offset": 0,
        "toBlock": undefined,
        "type": "block",
      } => [
        {
          "fragment": {
            "chainId": 1,
            "interval": 1,
            "offset": 0,
            "type": "block",
          },
          "intervals": [],
        },
      ],
    }
  `);
});

test("getIntervals() returns intervals", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const filter = {
    type: "block",
    chainId: 1,
    interval: 1,
    offset: 0,
    fromBlock: undefined,
    toBlock: undefined,
    include: [],
  } satisfies BlockFilter;

  await syncStore.insertIntervals({
    intervals: [
      {
        filter,
        interval: [0, 4],
      },
    ],
    chainId: 1,
  });

  const intervals = await syncStore.getIntervals({
    filters: [filter],
  });

  expect(intervals).toMatchInlineSnapshot(`
    Map {
      {
        "chainId": 1,
        "fromBlock": undefined,
        "include": [],
        "interval": 1,
        "offset": 0,
        "toBlock": undefined,
        "type": "block",
      } => [
        {
          "fragment": {
            "chainId": 1,
            "interval": 1,
            "offset": 0,
            "type": "block",
          },
          "intervals": [
            [
              0,
              4,
            ],
          ],
        },
      ],
    }
  `);
});

test("getIntervals() merges intervals", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const filter = {
    type: "block",
    chainId: 1,
    interval: 1,
    offset: 0,
    fromBlock: undefined,
    toBlock: undefined,
    include: [],
  } satisfies BlockFilter;

  await syncStore.insertIntervals({
    intervals: [
      {
        filter,
        interval: [0, 4],
      },
    ],
    chainId: 1,
  });

  await syncStore.insertIntervals({
    intervals: [
      {
        filter,
        interval: [5, 8],
      },
    ],
    chainId: 1,
  });
  const intervals = await syncStore.getIntervals({
    filters: [filter],
  });

  expect(intervals).toMatchInlineSnapshot(`
    Map {
      {
        "chainId": 1,
        "fromBlock": undefined,
        "include": [],
        "interval": 1,
        "offset": 0,
        "toBlock": undefined,
        "type": "block",
      } => [
        {
          "fragment": {
            "chainId": 1,
            "interval": 1,
            "offset": 0,
            "type": "block",
          },
          "intervals": [
            [
              0,
              8,
            ],
          ],
        },
      ],
    }
  `);
});

test("getIntervals() adjacent intervals", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const filter = {
    type: "log",
    chainId: 1,
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    address: [zeroAddress],
    fromBlock: undefined,
    toBlock: undefined,
    include: [],
  } satisfies LogFilter;

  await syncStore.insertIntervals({
    intervals: [
      {
        filter,
        interval: [0, 4],
      },
    ],
    chainId: 1,
  });

  await syncStore.insertIntervals({
    intervals: [
      {
        // @ts-ignore
        filter: { ...filter, address: undefined },
        interval: [5, 8],
      },
    ],
    chainId: 1,
  });
  const intervals = await syncStore.getIntervals({
    filters: [filter],
  });

  expect(intervals).toMatchInlineSnapshot(`
    Map {
      {
        "address": [
          "0x0000000000000000000000000000000000000000",
        ],
        "chainId": 1,
        "fromBlock": undefined,
        "include": [],
        "toBlock": undefined,
        "topic0": null,
        "topic1": null,
        "topic2": null,
        "topic3": null,
        "type": "log",
      } => [
        {
          "fragment": {
            "address": "0x0000000000000000000000000000000000000000",
            "chainId": 1,
            "includeTransactionReceipts": false,
            "topic0": null,
            "topic1": null,
            "topic2": null,
            "topic3": null,
            "type": "log",
          },
          "intervals": [
            [
              0,
              8,
            ],
          ],
        },
      ],
    }
  `);
});

test("insertIntervals() merges duplicates", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const filter = {
    type: "block",
    chainId: 1,
    interval: 1,
    offset: 0,
    fromBlock: undefined,
    toBlock: undefined,
    include: [],
  } satisfies BlockFilter;

  await syncStore.insertIntervals({
    intervals: [
      {
        filter,
        interval: [0, 4],
      },
    ],
    chainId: 1,
  });

  await syncStore.insertIntervals({
    intervals: [
      {
        filter,
        interval: [5, 6],
      },
      {
        filter,
        interval: [5, 8],
      },
    ],
    chainId: 1,
  });

  const intervals = await syncStore.getIntervals({
    filters: [filter],
  });

  expect(intervals).toMatchInlineSnapshot(`
    Map {
      {
        "chainId": 1,
        "fromBlock": undefined,
        "include": [],
        "interval": 1,
        "offset": 0,
        "toBlock": undefined,
        "type": "block",
      } => [
        {
          "fragment": {
            "chainId": 1,
            "interval": 1,
            "offset": 0,
            "type": "block",
          },
          "intervals": [
            [
              0,
              8,
            ],
          ],
        },
      ],
    }
  `);
});

test("insertIntervals() preserves fragments", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const filter = {
    type: "log",
    chainId: 1,
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    address: [zeroAddress, ALICE],
    fromBlock: undefined,
    toBlock: undefined,
    include: [],
  } satisfies LogFilter;

  await syncStore.insertIntervals({
    intervals: [
      {
        filter,
        interval: [0, 4],
      },
    ],
    chainId: 1,
  });

  const intervals = await syncStore.getIntervals({
    filters: [filter],
  });

  expect(intervals).toMatchInlineSnapshot(`
    Map {
      {
        "address": [
          "0x0000000000000000000000000000000000000000",
          "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        ],
        "chainId": 1,
        "fromBlock": undefined,
        "include": [],
        "toBlock": undefined,
        "topic0": null,
        "topic1": null,
        "topic2": null,
        "topic3": null,
        "type": "log",
      } => [
        {
          "fragment": {
            "address": "0x0000000000000000000000000000000000000000",
            "chainId": 1,
            "includeTransactionReceipts": false,
            "topic0": null,
            "topic1": null,
            "topic2": null,
            "topic3": null,
            "type": "log",
          },
          "intervals": [
            [
              0,
              4,
            ],
          ],
        },
        {
          "fragment": {
            "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            "chainId": 1,
            "includeTransactionReceipts": false,
            "topic0": null,
            "topic1": null,
            "topic2": null,
            "topic3": null,
            "type": "log",
          },
          "intervals": [
            [
              0,
              4,
            ],
          ],
        },
      ],
    }
  `);
});

test("getChildAddresses()", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const { address } = await deployFactory({ sender: ALICE });
  const { result } = await createPair({ factory: address, sender: ALICE });

  const { config, rawIndexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });
  const filter = sources[0]!.filter as LogFilter<Factory>;

  await syncStore.insertChildAddresses({
    factory: filter.address,
    childAddresses: new Map([[result, 0]]),
    chainId: 1,
  });

  const addresses = await syncStore.getChildAddresses({
    factory: filter.address,
  });

  expect(addresses).toMatchInlineSnapshot(`
    Map {
      "0xa16e02e87b7454126e5e10d957a927a7f5b5d2be" => 0,
    }
  `);
});

test("getChildAddresses() empty", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const { address } = await deployFactory({ sender: ALICE });

  const { config, rawIndexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  const filter = sources[0]!.filter as LogFilter<Factory>;

  const addresses = await syncStore.getChildAddresses({
    factory: filter.address,
  });

  expect(addresses).toMatchInlineSnapshot("Map {}");
});

test("getChildAddresses() distinct", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const { address } = await deployFactory({ sender: ALICE });
  const { result } = await createPair({ factory: address, sender: ALICE });

  const { config, rawIndexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });
  const filter = sources[0]!.filter as LogFilter<Factory>;

  await syncStore.insertChildAddresses({
    factory: filter.address,
    childAddresses: new Map([[result, 0]]),
    chainId: 1,
  });
  await syncStore.insertChildAddresses({
    factory: filter.address,
    childAddresses: new Map([[result, 3]]),
    chainId: 1,
  });

  const addresses = await syncStore.getChildAddresses({
    factory: filter.address,
  });

  expect(addresses).toMatchInlineSnapshot(`
    Map {
      "0xa16e02e87b7454126e5e10d957a927a7f5b5d2be" => 0,
    }
  `);
});

test("getCrashRecoveryBlock()", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  await testClient.mine({ blocks: 4 });
  const rpcBlock1 = await _eth_getBlockByNumber(rpc, {
    blockNumber: 1,
  });
  rpcBlock1.timestamp = rpcBlock1.number;

  const rpcBlock2 = await _eth_getBlockByNumber(rpc, {
    blockNumber: 2,
  });
  rpcBlock2.timestamp = rpcBlock2.number;

  const rpcBlock3 = await _eth_getBlockByNumber(rpc, {
    blockNumber: 3,
  });
  rpcBlock3.timestamp = rpcBlock3.number;

  const rpcBlock4 = await _eth_getBlockByNumber(rpc, {
    blockNumber: 4,
  });
  rpcBlock4.timestamp = rpcBlock4.number;

  await syncStore.insertBlocks({
    blocks: [rpcBlock1, rpcBlock2, rpcBlock3, rpcBlock4],
    chainId: 1,
  });

  const result = await syncStore.getSafeCrashRecoveryBlock({
    chainId: chain.id,
    timestamp: hexToNumber(rpcBlock3.timestamp),
  });

  expect(result).toEqual({
    number: hexToBigInt(rpcBlock2.number),
    timestamp: hexToBigInt(rpcBlock2.timestamp),
  });
});

test("insertChildAddresses()", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const { address } = await deployFactory({ sender: ALICE });
  const { result } = await createPair({ factory: address, sender: ALICE });

  const { config, rawIndexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });
  const filter = sources[0]!.filter as LogFilter<Factory>;

  await syncStore.insertChildAddresses({
    factory: filter.address,
    childAddresses: new Map([[result, 0]]),
    chainId: 1,
  });
  await syncStore.insertChildAddresses({
    factory: filter.address,
    childAddresses: new Map([[result, 3]]),
    chainId: 1,
  });

  const factories = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.factories)
    .execute();
  const factoryAddresses = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.factoryAddresses)
    .execute();

  expect(factories).toHaveLength(1);
  expect(factoryAddresses).toHaveLength(2);
});

test("insertLogs()", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  const rpcLogs = await _eth_getLogs(rpc, {
    fromBlock: 2,
    toBlock: 2,
  });

  await syncStore.insertLogs({ logs: [rpcLogs[0]!], chainId: 1 });

  const logs = await database.syncQB().select().from(ponderSyncSchema.logs);
  expect(logs).toHaveLength(1);
});

test("insertLogs() with duplicates", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  const rpcLogs = await _eth_getLogs(rpc, {
    fromBlock: 2,
    toBlock: 2,
  });

  await syncStore.insertLogs({ logs: [rpcLogs[0]!], chainId: 1 });

  await syncStore.insertLogs({ logs: [rpcLogs[0]!], chainId: 1 });

  const logs = await database.syncQB().select().from(ponderSyncSchema.logs);
  expect(logs).toHaveLength(1);
});

test("insertBlocks()", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  await testClient.mine({ blocks: 1 });
  const rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 1,
  });

  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  const blocks = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.blocks)
    .execute();
  expect(blocks).toHaveLength(1);
});

test("insertBlocks() with duplicates", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  await testClient.mine({ blocks: 1 });
  const rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 1,
  });

  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  const blocks = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.blocks)
    .execute();
  expect(blocks).toHaveLength(1);
});

test("insertTransactions()", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 2,
  });
  await syncStore.insertTransactions({
    transactions: [rpcBlock.transactions[0]!],
    chainId: 1,
  });

  const transactions = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.transactions)
    .execute();
  expect(transactions).toHaveLength(1);
});

test("insertTransactions() with duplicates", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 2,
  });
  await syncStore.insertTransactions({
    transactions: [rpcBlock.transactions[0]!],
    chainId: 1,
  });
  await syncStore.insertTransactions({
    transactions: [rpcBlock.transactions[0]!],
    chainId: 1,
  });

  const transactions = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.transactions)
    .execute();
  expect(transactions).toHaveLength(1);
});

test("insertTransactionReceipts()", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  const { hash } = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const rpcTransactionReceipt = await _eth_getTransactionReceipt(rpc, {
    hash,
  });

  await syncStore.insertTransactionReceipts({
    transactionReceipts: [rpcTransactionReceipt],
    chainId: 1,
  });

  const transactionReceipts = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.transactionReceipts)
    .execute();
  expect(transactionReceipts).toHaveLength(1);
});

test("insertTransactionReceipts() with duplicates", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  const { hash } = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const rpcTransactionReceipt = await _eth_getTransactionReceipt(rpc, {
    hash,
  });

  await syncStore.insertTransactionReceipts({
    transactionReceipts: [rpcTransactionReceipt],
    chainId: 1,
  });
  await syncStore.insertTransactionReceipts({
    transactionReceipts: [rpcTransactionReceipt],
    chainId: 1,
  });

  const transactionReceipts = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.transactionReceipts)
    .execute();
  expect(transactionReceipts).toHaveLength(1);
});

test("insertTraces()", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  const { hash } = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const trace = {
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

  const rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 1,
  });

  await syncStore.insertTraces({
    traces: [
      {
        trace,
        block: rpcBlock,
        transaction: rpcBlock.transactions[0] as SyncTransaction,
      },
    ],
    chainId: 1,
  });

  const traces = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.traces)
    .execute();
  expect(traces).toHaveLength(1);
});

test("insertTraces() with duplicates", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  const { hash } = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const trace = {
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

  const rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 1,
  });

  await syncStore.insertTraces({
    traces: [
      {
        trace,
        block: rpcBlock,
        transaction: rpcBlock.transactions[0] as SyncTransaction,
      },
    ],
    chainId: 1,
  });
  await syncStore.insertTraces({
    traces: [
      {
        trace,
        block: rpcBlock,
        transaction: rpcBlock.transactions[0] as SyncTransaction,
      },
    ],
    chainId: 1,
  });

  const traces = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.traces)
    .execute();
  expect(traces).toHaveLength(1);
});

test("getEventBlockData() returns events", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  const rpcLogs = await _eth_getLogs(rpc, {
    fromBlock: 2,
    toBlock: 2,
  });

  const rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 2,
  });

  await syncStore.insertLogs({
    logs: [rpcLogs[0]!],
    chainId: 1,
  });
  await syncStore.insertTransactions({
    transactions: [rpcBlock.transactions[0]!],
    chainId: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  const filter = {
    type: "log",
    chainId: 1,
    address: undefined,
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    fromBlock: undefined,
    toBlock: undefined,
    include: [],
  } satisfies LogFilter;

  const { blockData } = await syncStore.getEventBlockData({
    filters: [filter],
    fromBlock: 0,
    toBlock: 10,
    chainId: 1,
    limit: 10,
  });

  expect(blockData).toHaveLength(1);
});

test("getEventBlockData() pagination", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  await testClient.mine({ blocks: 2 });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    config,
    rawIndexingFunctions,
  });

  let rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 2,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  const { blockData, cursor } = await syncStore.getEventBlockData({
    filters: [sources[0]!.filter],
    fromBlock: 0,
    toBlock: 10,
    chainId: 1,
    limit: 1,
  });

  expect(blockData).toHaveLength(1);

  const { blockData: blockData2 } = await syncStore.getEventBlockData({
    filters: [sources[0]!.filter],
    fromBlock: cursor,
    toBlock: 10,
    chainId: 1,
    limit: 1,
  });

  expect(blockData2).toHaveLength(1);
});

test("insertRpcRequestResults() ", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);

  await syncStore.insertRpcRequestResults({
    requests: [
      {
        request: { method: "eth_call", params: ["0x1"] },
        blockNumber: 1,
        result: "0x1",
      },
    ],
    chainId: 1,
  });

  const result = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.rpcRequestResults)
    .execute();

  expect(result).toHaveLength(1);
  expect(result[0]!.requestHash).toBe("39d5ace8093d42c1bd00ce7781a7891a");
  expect(result[0]!.result).toBe("0x1");
});

test("inserttRpcRequestResults() hash matches postgres", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);

  await syncStore.insertRpcRequestResults({
    requests: [
      {
        request: { method: "eth_call", params: ["0x1"] },
        blockNumber: 1,
        result: "0x1",
      },
    ],
    chainId: 1,
  });

  const jsHash = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.rpcRequestResults)
    .execute()
    .then((result) => result[0]!.requestHash);

  const psqlHash = await database
    .syncQB()
    .execute(
      sql`SELECT MD5(${JSON.stringify(orderObject({ method: "eth_call", params: ["0x1"] }))}) as request_hash`,
    );

  expect(jsHash).toBe(psqlHash.rows[0]!.request_hash);
});

test("getRpcRequestResults()", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  await syncStore.insertRpcRequestResults({
    requests: [
      {
        request: { method: "eth_call", params: ["0x1"] },
        blockNumber: 1,
        result: "0x1",
      },
    ],
    chainId: 1,
  });
  const result = await syncStore.getRpcRequestResults({
    requests: [
      { method: "eth_call", params: ["0x1"] },
      { method: "eth_call", params: ["0x2"] },
    ],
    chainId: 1,
  });

  expect(result).toMatchInlineSnapshot(`
    [
      "0x1",
      undefined,
    ]
  `);
});

test("getEventBlockData() pagination with multiple filters", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { sources: erc20Sources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    ...getErc20ConfigAndIndexingFunctions({ address }),
  });

  const { sources: blockSources } = await buildConfigAndIndexingFunctions({
    common: context.common,
    ...getBlocksConfigAndIndexingFunctions({
      interval: 1,
    }),
  });

  let rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [rpcBlock.transactions[0]!],
    chainId: 1,
  });

  rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 2,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [rpcBlock.transactions[0]!],
    chainId: 1,
  });

  const rpcLogs = await _eth_getLogs(rpc, {
    fromBlock: 2,
    toBlock: 2,
  });
  await syncStore.insertLogs({
    logs: [rpcLogs[0]!],
    chainId: 1,
  });

  const { blockData, cursor } = await syncStore.getEventBlockData({
    filters: [erc20Sources[0]!.filter, blockSources[0]!.filter],
    fromBlock: 0,
    toBlock: 10,
    chainId: 1,
    limit: 3,
  });

  expect(blockData).toHaveLength(2);
  expect(cursor).toBe(10);
});

test("pruneRpcRequestResult", async (context) => {
  const { database, syncStore } = await setupDatabaseServices(context);

  await syncStore.insertRpcRequestResults({
    requests: [
      {
        request: { method: "eth_call", params: ["0x1"] },
        blockNumber: 1,
        result: "0x1",
      },
      {
        request: { method: "eth_call", params: ["0x2"] },
        blockNumber: 2,
        result: "0x2",
      },
      {
        request: { method: "eth_call", params: ["0x3"] },
        blockNumber: 3,
        result: "0x3",
      },
      {
        request: { method: "eth_call", params: ["0x4"] },
        blockNumber: 4,
        result: "0x4",
      },
    ],
    chainId: 1,
  });
  await syncStore.pruneRpcRequestResults({
    blocks: [{ number: "0x2" }, { number: "0x4" }],
    chainId: 1,
  });

  const requestResults = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.rpcRequestResults)
    .execute();

  expect(requestResults).toHaveLength(2);
});

test("pruneByChain deletes blocks, logs, traces, transactions", async (context) => {
  const { syncStore, database } = await setupDatabaseServices(context);

  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  const { hash: hash1 } = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  const { hash: hash2 } = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  // block 2 (first mint)

  let rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 2,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [rpcBlock.transactions[0]!],
    chainId: 1,
  });

  let rpcLogs = await _eth_getLogs(rpc, {
    fromBlock: 2,
    toBlock: 2,
  });
  await syncStore.insertLogs({
    logs: [rpcLogs[0]!],
    chainId: 1,
  });

  let rpcTransactionReceipt = await _eth_getTransactionReceipt(rpc, {
    hash: hash1,
  });

  await syncStore.insertTransactionReceipts({
    transactionReceipts: [rpcTransactionReceipt],
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
    transactionHash: hash1,
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

  // block 3 (second mint)

  rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 3,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [rpcBlock.transactions[0]!],
    chainId: 1,
  });

  rpcLogs = await _eth_getLogs(rpc, {
    fromBlock: 3,
    toBlock: 3,
  });
  await syncStore.insertLogs({
    logs: [rpcLogs[0]!],
    chainId: 1,
  });

  rpcTransactionReceipt = await _eth_getTransactionReceipt(rpc, {
    hash: hash1,
  });

  await syncStore.insertTransactionReceipts({
    transactionReceipts: [rpcTransactionReceipt],
    chainId: 1,
  });

  rpcTrace.transactionHash = hash2;

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

  await syncStore.pruneByChain({ chainId: 1 });

  const logs = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.logs)
    .execute();
  const blocks = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.blocks)
    .execute();
  const traces = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.traces)
    .execute();
  const transactions = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.transactions)
    .execute();
  const transactionReceipts = await database
    .syncQB()
    .select()
    .from(ponderSyncSchema.transactionReceipts)
    .execute();

  expect(logs).toHaveLength(0);
  expect(blocks).toHaveLength(0);
  expect(traces).toHaveLength(0);
  expect(transactions).toHaveLength(0);
  expect(transactionReceipts).toHaveLength(0);
});
