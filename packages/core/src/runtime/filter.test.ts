import {
  type Address,
  getAbiItem,
  type Hex,
  numberToHex,
  parseEther,
  toEventSelector,
  zeroAddress,
  zeroHash,
} from "viem";
import { beforeEach, expect, test } from "vitest";
import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import { context, setupAnvil, setupCommon } from "@/_test/setup.js";
import {
  createPair,
  deployErc20,
  deployFactory,
  mintErc20,
  transferErc20,
  transferEth,
} from "@/_test/simulate.js";
import {
  getAccountsIndexingBuild,
  getBlocksIndexingBuild,
  getChain,
  getErc20IndexingBuild,
  getPairWithFactoryIndexingBuild,
} from "@/_test/utils.js";
import type {
  BlockFilter,
  Factory,
  LogFactory,
  LogFilter,
  SyncLog,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import { eth_getBlockByNumber } from "@/rpc/actions.js";
import { createRpc } from "@/rpc/index.js";
import type { IntervalWithFilter } from "@/runtime/index.js";
import {
  getChildAddress,
  isBlockFilterMatched,
  isLogFactoryMatched,
  isLogFilterMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
  mergeLogFiltersToRequests,
} from "./filter.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

test("getChildAddress() topics", () => {
  const factory = {
    type: "log",
    childAddressLocation: "topic1",
  } as unknown as LogFactory;
  const log = {
    topics: [
      null,
      "0x000000000000000000000000a21a16ec22a940990922220e4ab5bf4c2310f556",
    ],
  } as unknown as SyncLog;

  expect(getChildAddress({ log, factory })).toBe(
    "0xa21a16ec22a940990922220e4ab5bf4c2310f556",
  );
});

test("getChildAddress() offset", () => {
  const factory = {
    type: "log",
    childAddressLocation: "offset32",
  } as unknown as LogFactory;
  const log = {
    data: "0x0000000000000000000000000000000000000000000000000000000017d435c9000000000000000000000000a21a16ec22a940990922220e4ab5bf4c2310f556",
  } as unknown as SyncLog;

  expect(getChildAddress({ log, factory })).toBe(
    "0xa21a16ec22a940990922220e4ab5bf4c2310f556",
  );
});

test("isLogFactoryMatched()", async () => {
  const { address } = await deployFactory({ sender: ALICE });
  const blockData = await createPair({
    factory: address,
    sender: ALICE,
  });

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({
    address,
  });

  const filter = eventCallbacks[0]!.filter as LogFilter<Factory>;

  let isMatched = isLogFactoryMatched({
    factory: filter.address,
    log: blockData.log,
  });
  expect(isMatched).toBe(true);

  filter.address.address = [filter.address.address as Address];

  isMatched = isLogFactoryMatched({
    factory: filter.address,
    log: blockData.log,
  });
  expect(isMatched).toBe(true);

  filter.address.address = undefined;

  isMatched = isLogFactoryMatched({
    factory: filter.address,
    log: blockData.log,
  });
  expect(isMatched).toBe(true);

  blockData.log.topics[0] = zeroHash;

  isMatched = isLogFactoryMatched({
    factory: filter.address,
    log: blockData.log,
  });
  expect(isMatched).toBe(false);
});

test("isLogFilterMatched()", async () => {
  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({
    address,
  });

  const filter = eventCallbacks[0]!.filter as LogFilter;

  let isMatched = isLogFilterMatched({ filter, log: blockData.log });
  expect(isMatched).toBe(true);

  blockData.log.address = zeroAddress;

  isMatched = isLogFilterMatched({ filter, log: blockData.log });
  expect(isMatched).toBe(false);
});

test("isBlockFilterMatched", async () => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const filter = eventCallbacks[0]!.filter as BlockFilter;

  const rpcBlock = await eth_getBlockByNumber(rpc, ["0x0", true]);

  let isMatched = isBlockFilterMatched({
    filter,
    block: rpcBlock,
  });
  expect(isMatched).toBe(true);

  filter.interval = 2;
  filter.offset = 1;

  isMatched = isBlockFilterMatched({
    filter,
    block: rpcBlock,
  });
  expect(isMatched).toBe(false);
});

test("isTransactionFilterMatched()", async () => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getAccountsIndexingBuild({
    address: ALICE,
  });

  // transaction:from
  const filter = eventCallbacks[1]!.filter as TransactionFilter<
    undefined,
    undefined
  >;

  const rpcBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  let isMatched = isTransactionFilterMatched({
    filter,
    transaction: rpcBlock.transactions[0]!,
  });
  expect(isMatched).toBe(true);

  rpcBlock.transactions[0]!.from = zeroAddress;

  isMatched = isTransactionFilterMatched({
    filter,
    transaction: rpcBlock.transactions[0]!,
  });
  expect(isMatched).toBe(false);
});

test("isTransactionFilterMatched() with null transaction.to", async () => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getAccountsIndexingBuild({
    address: ALICE,
  });

  // transaction:to
  const filter = eventCallbacks[1]!.filter as TransactionFilter<
    undefined,
    undefined
  >;
  filter.toAddress = BOB.toLowerCase() as Address;

  const rpcBlock = await eth_getBlockByNumber(rpc, ["0x1", true]);

  let isMatched = isTransactionFilterMatched({
    filter,
    transaction: rpcBlock.transactions[0]!,
  });
  expect(isMatched).toBe(true);

  rpcBlock.transactions[0]!.to = null;

  isMatched = isTransactionFilterMatched({
    filter,
    transaction: rpcBlock.transactions[0]!,
  });
  expect(isMatched).toBe(false);
});

test("isTransferFilterMatched()", async () => {
  const blockData = await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getAccountsIndexingBuild({
    address: ALICE,
  });

  // transfer:from
  const filter = eventCallbacks[3]!.filter as TransferFilter;

  let isMatched = isTransferFilterMatched({
    filter,
    block: blockData.block,
    trace: blockData.trace.trace,
  });
  expect(isMatched).toBe(true);

  blockData.trace.trace.value = "0x0";

  isMatched = isTransferFilterMatched({
    filter,
    block: blockData.block,
    trace: blockData.trace.trace,
  });
  expect(isMatched).toBe(false);
});

test("isTraceFilterMatched()", async () => {
  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  const blockData = await transferErc20({
    erc20: address,
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({
    address,
    includeCallTraces: true,
  });

  const filter = eventCallbacks[0]!.filter as TraceFilter;

  let isMatched = isTraceFilterMatched({
    filter,
    block: blockData.block,
    trace: blockData.trace.trace,
  });
  expect(isMatched).toBe(true);

  blockData.trace.trace.to = zeroAddress;

  isMatched = isTraceFilterMatched({
    filter,
    block: blockData.block,
    trace: blockData.trace.trace,
  });
  expect(isMatched).toBe(false);
});

const ADDRESS_A: Address = "0x1111111111111111111111111111111111111111";
const ADDRESS_B: Address = "0x2222222222222222222222222222222222222222";

const TOPIC1_ALICE: Hex = `0x${"0".repeat(24)}${ALICE.slice(2)}`;
const TOPIC1_BOB: Hex = `0x${"0".repeat(24)}${BOB.slice(2)}`;

const baseLogFilter = {
  type: "log",
  chainId: 1,
  sourceId: "Erc20",
  fromBlock: undefined,
  toBlock: undefined,
  hasTransactionReceipt: false,
  include: [] as LogFilter["include"],
};

test("mergeLogFiltersToRequests merges filters with different topic1 values into one request", () => {
  const transfer = toEventSelector(
    getAbiItem({ abi: erc20ABI, name: "Transfer" }),
  );

  const requiredIntervals: IntervalWithFilter[] = [
    {
      filter: {
        ...baseLogFilter,
        address: ADDRESS_A,
        topic0: transfer,
        topic1: TOPIC1_ALICE,
        topic2: null,
        topic3: null,
      } as LogFilter,
      interval: [1, 100],
    },
    {
      filter: {
        ...baseLogFilter,
        address: ADDRESS_A,
        topic0: transfer,
        topic1: TOPIC1_BOB,
        topic2: null,
        topic3: null,
      } as LogFilter,
      interval: [1, 100],
    },
  ];

  // Only `topic1` differs between the two filters, so they're merged into a
  // single request with `topic1` unioned into an array.
  const mergedRequests = mergeLogFiltersToRequests(
    requiredIntervals,
    new Map(),
    1000,
  );

  expect(mergedRequests).toHaveLength(1);
  expect(mergedRequests[0]!.params[0]).toMatchObject({
    address: ADDRESS_A,
    topics: [transfer, [TOPIC1_ALICE, TOPIC1_BOB]],
  });
});

test("mergeLogFiltersToRequests merges filters with different addresses into one request", () => {
  const transfer = toEventSelector(
    getAbiItem({ abi: erc20ABI, name: "Transfer" }),
  );

  const requiredIntervals: IntervalWithFilter[] = [
    {
      filter: {
        ...baseLogFilter,
        address: ADDRESS_A,
        topic0: transfer,
        topic1: null,
        topic2: null,
        topic3: null,
      } as LogFilter,
      interval: [1, 100],
    },
    {
      filter: {
        ...baseLogFilter,
        address: ADDRESS_B,
        topic0: transfer,
        topic1: null,
        topic2: null,
        topic3: null,
      } as LogFilter,
      interval: [1, 100],
    },
  ];

  // Only `address` differs between the two filters, so they're merged into a
  // single request with `address` unioned into an array.
  const mergedRequests = mergeLogFiltersToRequests(
    requiredIntervals,
    new Map(),
    1000,
  );

  expect(mergedRequests).toHaveLength(1);
  expect(mergedRequests[0]!.params[0]).toMatchObject({
    address: [ADDRESS_A, ADDRESS_B],
    topics: [transfer],
  });
});

test("mergeLogFiltersToRequests does not merge disjoint intervals into an overly wide request", () => {
  const transfer = toEventSelector(
    getAbiItem({ abi: erc20ABI, name: "Transfer" }),
  );

  const requiredIntervals: IntervalWithFilter[] = [
    {
      filter: {
        ...baseLogFilter,
        address: ADDRESS_A,
        topic0: transfer,
        topic1: null,
        topic2: null,
        topic3: null,
      } as LogFilter,
      interval: [1, 100],
    },
    {
      filter: {
        ...baseLogFilter,
        address: ADDRESS_A,
        topic0: transfer,
        topic1: null,
        topic2: null,
        topic3: null,
      } as LogFilter,
      interval: [100_000, 100_100],
    },
  ];

  // The two filters are otherwise identical, but their intervals are
  // disjoint (0% overlap), so merging them would force an unnecessarily wide
  // request that refetches ~100,000 unrelated blocks. Instead, two
  // tightly-bounded requests are kept.
  const mergedRequests = mergeLogFiltersToRequests(
    requiredIntervals,
    new Map(),
    1000,
  );

  expect(mergedRequests).toHaveLength(2);
  expect(mergedRequests.map((request) => request.params[0])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        fromBlock: numberToHex(1),
        toBlock: numberToHex(100),
      }),
      expect.objectContaining({
        fromBlock: numberToHex(100_000),
        toBlock: numberToHex(100_100),
      }),
    ]),
  );
});
