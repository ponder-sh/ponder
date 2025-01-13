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
  testClient,
} from "@/_test/utils.js";
import { buildConfigAndIndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import type {
  BlockFilter,
  Factory,
  LogFactory,
  LogFilter,
} from "@/sync/source.js";
import type { SyncTrace, SyncTransaction } from "@/types/sync.js";
import {
  decodeCheckpoint,
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
  type Address,
  encodeFunctionData,
  encodeFunctionResult,
  hexToNumber,
  parseEther,
  zeroAddress,
  zeroHash,
} from "viem";
import { beforeEach, expect, test } from "vitest";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("setup creates tables", async (context) => {
  const { cleanup, database } = await setupDatabaseServices(context);
  const tables = await database.qb.sync.introspection.getTables();
  const tableNames = tables.map((t) => t.name);

  expect(tableNames).toContain("blocks");
  expect(tableNames).toContain("logs");
  expect(tableNames).toContain("transactions");
  expect(tableNames).toContain("traces");
  expect(tableNames).toContain("transactionReceipts");

  expect(tableNames).toContain("rpc_request_results");
  await cleanup();
});

test("getIntervals() empty", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

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

  await cleanup();
});

test("getIntervals() returns intervals", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

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

  await cleanup();
});

test("getIntervals() merges intervals", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

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

  await cleanup();
});

test("getIntervals() adjacent intervals", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

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

  await cleanup();
});

test("insertIntervals() merges duplicates", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

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

  await cleanup();
});

test("insertIntervals() preserves fragments", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

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

  await cleanup();
});

test("getChildAddresses()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { address } = await deployFactory({ sender: ALICE });
  const { result } = await createPair({ factory: address, sender: ALICE });
  const rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });

  const { config, rawIndexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]! }],
    shouldUpdateCheckpoint: false,
    chainId: 1,
  });

  const filter = sources[0]!.filter as LogFilter<Factory>;

  const addresses = await syncStore.getChildAddresses({
    filter: filter.address,
    limit: 10,
  });

  expect(addresses).toHaveLength(1);
  expect(addresses[0]).toBe(result);

  await cleanup();
});

test("getChildAddresses() empty", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const { address } = await deployFactory({ sender: ALICE });

  const { config, rawIndexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  const filter = sources[0]!.filter as LogFilter<Factory>;

  const addresses = await syncStore.getChildAddresses({
    filter: filter.address,
    limit: 10,
  });

  expect(addresses).toHaveLength(0);

  await cleanup();
});

test("getChildAddresses() distinct", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { address } = await deployFactory({ sender: ALICE });
  const { result } = await createPair({ factory: address, sender: ALICE });
  const rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });

  const { config, rawIndexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]! }, { log: { ...rpcLogs[0]!, logIndex: "0x1" } }],
    shouldUpdateCheckpoint: false,
    chainId: 1,
  });

  const filter = sources[0]!.filter as LogFilter<Factory>;

  const addresses = await syncStore.getChildAddresses({
    filter: filter.address,
    limit: 10,
  });

  expect(addresses).toHaveLength(1);
  expect(addresses[0]).toBe(result);

  await cleanup();
});

test("filterChildAddresses()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { address } = await deployFactory({ sender: ALICE });
  const { result } = await createPair({ factory: address, sender: ALICE });
  const rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });

  const { config, rawIndexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]! }],
    shouldUpdateCheckpoint: false,
    chainId: 1,
  });

  const filter = sources[0]!.filter as LogFilter<Factory>;

  const addresses = await syncStore.filterChildAddresses({
    filter: filter.address,
    addresses: [address, result, zeroAddress],
  });

  expect(addresses.size).toBe(1);

  await cleanup();
});

test("insertLogs()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

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
  const rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });

  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]! }],
    shouldUpdateCheckpoint: false,
    chainId: 1,
  });

  const logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(1);

  await cleanup();
});

test("insertLogs() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

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
  const rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });

  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]! }],
    shouldUpdateCheckpoint: false,
    chainId: 1,
  });

  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]! }],
    shouldUpdateCheckpoint: false,
    chainId: 1,
  });

  const logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(1);

  await cleanup();
});

test("insertLogs() creates checkpoint", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

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
  const rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });
  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });

  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]!, block: rpcBlock }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });

  const logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  const checkpoint = decodeCheckpoint(logs[0]!.checkpoint!);

  expect(checkpoint.blockTimestamp).toBe(hexToNumber(rpcBlock.timestamp));
  expect(checkpoint.chainId).toBe(1n);
  expect(checkpoint.blockNumber).toBe(2n);
  expect(checkpoint.transactionIndex).toBe(0n);
  expect(checkpoint.eventType).toBe(5);
  expect(checkpoint.eventIndex).toBe(0n);

  await cleanup();
});

test("insertLogs() upserts checkpoint", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

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
  const rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });
  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });

  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]! }],
    shouldUpdateCheckpoint: false,
    chainId: 1,
  });

  let logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  expect(logs[0]!.checkpoint).toBe(null);

  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]!, block: rpcBlock }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });

  logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  expect(logs[0]!.checkpoint).not.toBe(null);

  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]! }],
    shouldUpdateCheckpoint: false,
    chainId: 1,
  });

  logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  expect(logs[0]!.checkpoint).not.toBe(null);

  await cleanup();
});

test("insertBlocks()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  await testClient.mine({ blocks: 1 });
  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
  });

  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  const blocks = await database.qb.sync
    .selectFrom("blocks")
    .selectAll()
    .execute();
  expect(blocks).toHaveLength(1);

  await cleanup();
});

test("insertBlocks() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  await testClient.mine({ blocks: 1 });
  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
  });

  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  const blocks = await database.qb.sync
    .selectFrom("blocks")
    .selectAll()
    .execute();
  expect(blocks).toHaveLength(1);

  await cleanup();
});

test("insertBlocks() creates checkpoint", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  await testClient.mine({ blocks: 1 });
  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
  });

  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  const blocks = await database.qb.sync
    .selectFrom("blocks")
    .selectAll()
    .execute();
  const checkpoint = decodeCheckpoint(blocks[0]!.checkpoint!);

  expect(checkpoint.blockTimestamp).toBe(hexToNumber(rpcBlock.timestamp));
  expect(checkpoint.chainId).toBe(1n);
  expect(checkpoint.blockNumber).toBe(1n);
  expect(checkpoint.transactionIndex).toBe(maxCheckpoint.transactionIndex);
  expect(checkpoint.eventType).toBe(5);
  expect(checkpoint.eventIndex).toBe(0n);

  await cleanup();
});

test("hasBlock()", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  await testClient.mine({ blocks: 1 });
  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
  });

  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  let block = await syncStore.hasBlock({
    hash: rpcBlock.hash,
  });
  expect(block).toBe(true);

  block = await syncStore.hasBlock({
    hash: zeroHash,
  });
  expect(block).toBe(false);

  await cleanup();
});

test("insertTransactions()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

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

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });
  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
    chainId: 1,
  });

  const transactions = await database.qb.sync
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(1);

  await cleanup();
});

test("insertTransactions() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

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

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });
  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
    chainId: 1,
  });
  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
    chainId: 1,
  });

  const transactions = await database.qb.sync
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(1);

  await cleanup();
});

test("hasTransaction()", async (context) => {
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

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });
  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
    chainId: 1,
  });

  let transaction = await syncStore.hasTransaction({
    hash,
  });
  expect(transaction).toBe(true);

  transaction = await syncStore.hasTransaction({
    hash: zeroHash,
  });
  expect(transaction).toBe(false);

  await cleanup();
});

test("insertTransactionReceipts()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

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

  const rpcTransactionReceipt = await _eth_getTransactionReceipt(requestQueue, {
    hash,
  });

  await syncStore.insertTransactionReceipts({
    transactionReceipts: [rpcTransactionReceipt],
    chainId: 1,
  });

  const transactionReceipts = await database.qb.sync
    .selectFrom("transactionReceipts")
    .selectAll()
    .execute();
  expect(transactionReceipts).toHaveLength(1);

  await cleanup();
});

test("insertTransactionReceipts() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

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

  const rpcTransactionReceipt = await _eth_getTransactionReceipt(requestQueue, {
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

  const transactionReceipts = await database.qb.sync
    .selectFrom("transactionReceipts")
    .selectAll()
    .execute();
  expect(transactionReceipts).toHaveLength(1);

  await cleanup();
});

test("hasTransactionReceipt()", async (context) => {
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

  const rpcTransactionReceipt = await _eth_getTransactionReceipt(requestQueue, {
    hash,
  });

  await syncStore.insertTransactionReceipts({
    transactionReceipts: [rpcTransactionReceipt],
    chainId: 1,
  });

  let transaction = await syncStore.hasTransactionReceipt({
    hash: rpcTransactionReceipt.transactionHash,
  });
  expect(transaction).toBe(true);

  transaction = await syncStore.hasTransactionReceipt({
    hash: zeroHash,
  });
  expect(transaction).toBe(false);

  await cleanup();
});

test("insertTraces()", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

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

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
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

  const traces = await database.qb.sync
    .selectFrom("traces")
    .selectAll()
    .execute();
  expect(traces).toHaveLength(1);

  await cleanup();
});

test("insertTraces() creates checkpoint", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

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

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
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

  const traces = await database.qb.sync
    .selectFrom("traces")
    .selectAll()
    .execute();
  const checkpoint = decodeCheckpoint(traces[0]!.checkpoint!);

  expect(checkpoint.blockTimestamp).toBe(hexToNumber(rpcBlock.timestamp));
  expect(checkpoint.chainId).toBe(1n);
  expect(checkpoint.blockNumber).toBe(1n);
  expect(checkpoint.transactionIndex).toBe(0n);
  expect(checkpoint.eventType).toBe(7);
  expect(checkpoint.eventIndex).toBe(0n);

  await cleanup();
});

test("insertTraces() with duplicates", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

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

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
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

  const traces = await database.qb.sync
    .selectFrom("traces")
    .selectAll()
    .execute();
  expect(traces).toHaveLength(1);

  await cleanup();
});

test("getEvents() returns events", async (context) => {
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
  const rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });

  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]!, block: rpcBlock }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });
  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
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

  const { events } = await syncStore.getEvents({
    filters: [filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(1);

  await cleanup();
});

test("getEvents() handles log filter logic", async (context) => {
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

  // noisy data
  const { address: factory } = await deployFactory({ sender: ALICE });
  await createPair({ factory, sender: ALICE });

  const { config, rawIndexingFunctions } = getErc20ConfigAndIndexingFunctions({
    address,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  let rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
    chainId: 1,
  });

  let rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });
  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]!, block: rpcBlock }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });

  // noisy data

  rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 4,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
    chainId: 1,
  });

  rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 4,
    toBlock: 4,
  });
  syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]!, block: rpcBlock }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });

  const { events } = await syncStore.getEvents({
    filters: [sources[0]!.filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(1);

  await cleanup();
});

test("getEvents() handles log factory", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { address: factory } = await deployFactory({ sender: ALICE });
  const { result: pair } = await createPair({ factory, sender: ALICE });
  await swapPair({
    pair,
    sender: ALICE,
    amount0Out: 1n,
    amount1Out: 1n,
    to: ALICE,
  });

  const { config, rawIndexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address: factory,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  // factory

  let rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
    chainId: 1,
  });

  let rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });
  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]! }],
    shouldUpdateCheckpoint: false,
    chainId: 1,
  });

  // pair

  rpcBlock = await _eth_getBlockByNumber(requestQueue, {
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

  const { events } = await syncStore.getEvents({
    filters: [sources[0]!.filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(1);

  await cleanup();
});

test("getEvents() handles multiple log factories", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { address: factory } = await deployFactory({ sender: ALICE });
  const { result: pair } = await createPair({ factory, sender: ALICE });
  await swapPair({
    pair,
    sender: ALICE,
    amount0Out: 1n,
    amount1Out: 1n,
    to: ALICE,
  });

  const { config, rawIndexingFunctions } =
    getPairWithFactoryConfigAndIndexingFunctions({
      address: factory,
    });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  // factory

  let rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
    chainId: 1,
  });

  let rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });
  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]! }],
    shouldUpdateCheckpoint: false,
    chainId: 1,
  });

  // pair

  rpcBlock = await _eth_getBlockByNumber(requestQueue, {
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

  const filter = sources[0]!.filter as LogFilter<LogFactory>;

  filter.address.address = [
    filter.address.address as Address,
    filter.address.address as Address,
    zeroAddress,
  ];

  const { events } = await syncStore.getEvents({
    filters: [filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(1);

  await cleanup();
});

test("getEvents() handles block filter logic", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  await testClient.mine({ blocks: 2 });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 2,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  let rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  const { events } = await syncStore.getEvents({
    filters: [sources[0]!.filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(1);

  await cleanup();
});

test("getEvents() handles trace filter logic", async (context) => {
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

  const { events } = await syncStore.getEvents({
    filters: sources.map((source) => source.filter),
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(1);

  await cleanup();
});

test("getEvents() handles transaction filter logic", async (context) => {
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

  const { events } = await syncStore.getEvents({
    filters: sources.map((source) => source.filter),
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(1);

  await cleanup();
});

test("getEvents() handles transfer filter logic", async (context) => {
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

  const { events } = await syncStore.getEvents({
    filters: sources.map((source) => source.filter),
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  // transaction:from and transfer:from
  expect(events).toHaveLength(2);

  await cleanup();
});

test("getEvents() handles block bounds", async (context) => {
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

  const filter = sources[0]!.filter as LogFilter<undefined>;
  filter.toBlock = 1;

  const { events } = await syncStore.getEvents({
    filters: [sources[0]!.filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 10,
  });

  expect(events).toHaveLength(0);

  await cleanup();
});

test("getEvents() pagination", async (context) => {
  const { cleanup, syncStore } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  await testClient.mine({ blocks: 2 });

  const { config, rawIndexingFunctions } = getBlocksConfigAndIndexingFunctions({
    interval: 1,
  });
  const { sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions,
  });

  let rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  const { events, cursor } = await syncStore.getEvents({
    filters: [sources[0]!.filter],
    from: encodeCheckpoint(zeroCheckpoint),
    to: encodeCheckpoint(maxCheckpoint),
    limit: 1,
  });

  expect(events).toHaveLength(1);

  const { events: events2 } = await syncStore.getEvents({
    filters: [sources[0]!.filter],
    from: cursor,
    to: encodeCheckpoint(maxCheckpoint),
    limit: 1,
  });

  expect(events2).toHaveLength(1);

  await cleanup();
});

test("pruneRpcRequestResult", async (context) => {
  const { cleanup, database, syncStore } = await setupDatabaseServices(context);

  await syncStore.insertRpcRequestResult({
    request: "0x1",
    blockNumber: 1n,
    chainId: 1,
    result: "0x1",
  });
  await syncStore.insertRpcRequestResult({
    request: "0x2",
    blockNumber: 2n,
    chainId: 1,
    result: "0x2",
  });
  await syncStore.insertRpcRequestResult({
    request: "0x3",
    blockNumber: 3n,
    chainId: 1,
    result: "0x3",
  });
  await syncStore.insertRpcRequestResult({
    request: "0x4",
    blockNumber: 4n,
    chainId: 1,
    result: "0x4",
  });

  await syncStore.pruneRpcRequestResult({
    blocks: [{ number: "0x2" }, { number: "0x4" }],
    chainId: 1,
  });

  const requestResults = await database.qb.sync
    .selectFrom("rpc_request_results")
    .selectAll()
    .execute();

  expect(requestResults).toHaveLength(2);

  await cleanup();
});

test("pruneByChain deletes blocks, logs, traces, transactions", async (context) => {
  const { syncStore, database, cleanup } = await setupDatabaseServices(context);

  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
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

  let rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });
  await syncStore.insertBlocks({ blocks: [rpcBlock], chainId: 1 });

  await syncStore.insertTransactions({
    transactions: [{ transaction: rpcBlock.transactions[0]!, block: rpcBlock }],
    chainId: 1,
  });

  let rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });
  await syncStore.insertLogs({
    logs: [{ log: rpcLogs[0]!, block: rpcBlock }],
    shouldUpdateCheckpoint: true,
    chainId: 1,
  });

  let rpcTransactionReceipt = await _eth_getTransactionReceipt(requestQueue, {
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

  rpcBlock = await _eth_getBlockByNumber(requestQueue, {
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

  rpcTransactionReceipt = await _eth_getTransactionReceipt(requestQueue, {
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

  await syncStore.pruneByChain({ chainId: 1, fromBlock: 3 });

  const logs = await database.qb.sync.selectFrom("logs").selectAll().execute();
  const blocks = await database.qb.sync
    .selectFrom("blocks")
    .selectAll()
    .execute();
  const traces = await database.qb.sync
    .selectFrom("traces")
    .selectAll()
    .execute();
  const transactions = await database.qb.sync
    .selectFrom("transactions")
    .selectAll()
    .execute();
  const transactionReceipts = await database.qb.sync
    .selectFrom("transactionReceipts")
    .selectAll()
    .execute();

  expect(logs).toHaveLength(1);
  expect(blocks).toHaveLength(1);
  expect(traces).toHaveLength(1);
  expect(transactions).toHaveLength(1);
  expect(transactionReceipts).toHaveLength(1);

  await cleanup();
});
