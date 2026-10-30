import {
  type Address,
  encodeEventTopics,
  encodeFunctionData,
  getAbiItem,
  type Hex,
  numberToHex,
  padHex,
  parseEther,
  toEventSelector,
  toHex,
  zeroAddress,
  zeroHash,
} from "viem";
import { expect, test } from "vitest";
import { erc20ABI, factoryABI } from "@/_test/abis.js";
import { ALICE, BOB, EMPTY_LOG_FILTER } from "@/_test/constants.js";
import {
  getAccountsIndexingBuild,
  getBlocksIndexingBuild,
  getErc20IndexingBuild,
  getPairWithFactoryIndexingBuild,
} from "@/_test/utils.js";
import type {
  BlockFilter,
  Factory,
  FactoryId,
  LogFactory,
  LogFilter,
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import { ADDRESS_CHUNK_SIZE } from "@/rpc/actions.js";
import type { IntervalWithFilter } from "@/runtime/index.js";
import { toLowerCase } from "@/utils/lowercase.js";
import {
  getChildAddress,
  isBlockFilterMatched,
  isLogFactoryMatched,
  isLogFilterMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
  mergeLogFiltersToBlockRequest,
  mergeLogFiltersToRequests,
} from "./filter.js";

const ERC20_ADDRESS: Address = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const FACTORY_ADDRESS: Address = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
const PAIR_ADDRESS: Address = "0xa16e02e87b7454126e5e10d957a927a7f5b5d2be";

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

test("isLogFactoryMatched()", () => {
  const log = {
    address: FACTORY_ADDRESS,
    topics: encodeEventTopics({
      abi: factoryABI,
      eventName: "PairCreated",
      args: { pair: PAIR_ADDRESS },
    }),
    data: padHex(toHex(1n), { size: 32 }),
    blockNumber: "0x2",
  } as unknown as SyncLog;

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({
    address: FACTORY_ADDRESS,
  });

  const filter = eventCallbacks[0]!.filter as LogFilter<Factory>;

  let isMatched = isLogFactoryMatched({ factory: filter.address, log });
  expect(isMatched).toBe(true);

  filter.address.address = [filter.address.address as Address];

  isMatched = isLogFactoryMatched({ factory: filter.address, log });
  expect(isMatched).toBe(true);

  filter.address.address = undefined;

  isMatched = isLogFactoryMatched({ factory: filter.address, log });
  expect(isMatched).toBe(true);

  log.topics[0] = zeroHash;

  isMatched = isLogFactoryMatched({ factory: filter.address, log });
  expect(isMatched).toBe(false);
});

test("isLogFilterMatched()", () => {
  const log = {
    address: ERC20_ADDRESS,
    topics: encodeEventTopics({
      abi: erc20ABI,
      eventName: "Transfer",
      args: { from: zeroAddress, to: ALICE },
    }),
    data: padHex(toHex(parseEther("1")), { size: 32 }),
    blockNumber: "0x2",
  } as unknown as SyncLog;

  const { eventCallbacks } = getErc20IndexingBuild({
    address: ERC20_ADDRESS,
  });

  const filter = eventCallbacks[0]!.filter as LogFilter;

  let isMatched = isLogFilterMatched({ filter, log });
  expect(isMatched).toBe(true);

  log.address = zeroAddress;

  isMatched = isLogFilterMatched({ filter, log });
  expect(isMatched).toBe(false);
});

test("isBlockFilterMatched", () => {
  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const filter = eventCallbacks[0]!.filter as BlockFilter;

  const block = { number: "0x0" } as unknown as SyncBlock;

  let isMatched = isBlockFilterMatched({ filter, block });
  expect(isMatched).toBe(true);

  filter.interval = 2;
  filter.offset = 1;

  isMatched = isBlockFilterMatched({ filter, block });
  expect(isMatched).toBe(false);
});

test("isTransactionFilterMatched()", () => {
  const transaction = {
    from: toLowerCase(ALICE),
    to: toLowerCase(BOB),
    blockNumber: "0x1",
  } as unknown as SyncTransaction;

  const { eventCallbacks } = getAccountsIndexingBuild({
    address: ALICE,
  });

  // transaction:from
  const filter = eventCallbacks[1]!.filter as TransactionFilter<
    undefined,
    undefined
  >;

  let isMatched = isTransactionFilterMatched({ filter, transaction });
  expect(isMatched).toBe(true);

  transaction.from = zeroAddress;

  isMatched = isTransactionFilterMatched({ filter, transaction });
  expect(isMatched).toBe(false);
});

test("isTransactionFilterMatched() with null transaction.to", () => {
  const transaction = {
    from: toLowerCase(ALICE),
    to: toLowerCase(BOB),
    blockNumber: "0x1",
  } as unknown as SyncTransaction;

  const { eventCallbacks } = getAccountsIndexingBuild({
    address: ALICE,
  });

  // transaction:to
  const filter = eventCallbacks[1]!.filter as TransactionFilter<
    undefined,
    undefined
  >;
  filter.toAddress = toLowerCase(BOB);

  let isMatched = isTransactionFilterMatched({ filter, transaction });
  expect(isMatched).toBe(true);

  transaction.to = null;

  isMatched = isTransactionFilterMatched({ filter, transaction });
  expect(isMatched).toBe(false);
});

test("isTransferFilterMatched()", () => {
  const block = { number: "0x1" } as unknown as SyncBlock;
  const trace = {
    type: "CALL",
    from: toLowerCase(ALICE),
    to: toLowerCase(BOB),
    gas: "0x0",
    gasUsed: "0x0",
    input: "0x",
    value: toHex(parseEther("1")),
  } as unknown as SyncTrace["trace"];

  const { eventCallbacks } = getAccountsIndexingBuild({
    address: ALICE,
  });

  // transfer:from
  const filter = eventCallbacks[3]!.filter as TransferFilter;

  let isMatched = isTransferFilterMatched({ filter, block, trace });
  expect(isMatched).toBe(true);

  // `DELEGATECALL` and `CALLCODE` frames do not move value

  for (const type of ["DELEGATECALL", "CALLCODE"] as const) {
    isMatched = isTransferFilterMatched({
      filter,
      block,
      trace: { ...trace, type },
    });
    expect(isMatched).toBe(false);
  }

  isMatched = isTransferFilterMatched({
    filter,
    block,
    trace: { ...trace, type: "CREATE" },
  });
  expect(isMatched).toBe(true);

  trace.value = "0x0";

  isMatched = isTransferFilterMatched({ filter, block, trace });
  expect(isMatched).toBe(false);
});

test("isTraceFilterMatched()", () => {
  const block = { number: "0x3" } as unknown as SyncBlock;
  const trace = {
    type: "CALL",
    from: toLowerCase(ALICE),
    to: ERC20_ADDRESS,
    gas: "0x0",
    gasUsed: "0x0",
    input: encodeFunctionData({
      abi: erc20ABI,
      functionName: "transfer",
      args: [BOB, parseEther("1")],
    }),
    value: "0x0",
  } as unknown as SyncTrace["trace"];

  const { eventCallbacks } = getErc20IndexingBuild({
    address: ERC20_ADDRESS,
    includeCallTraces: true,
  });

  const filter = eventCallbacks[0]!.filter as TraceFilter;

  let isMatched = isTraceFilterMatched({ filter, block, trace });
  expect(isMatched).toBe(true);

  isMatched = isTraceFilterMatched({
    filter,
    block,
    trace: { ...trace, type: "STATICCALL" },
  });
  expect(isMatched).toBe(false);

  trace.to = zeroAddress;

  isMatched = isTraceFilterMatched({ filter, block, trace });
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

const REQUEST_ADDRESS_A = "0x000000000000000000000000000000000000000a";
const REQUEST_ADDRESS_B = "0x000000000000000000000000000000000000000b";
const REQUEST_TOPIC_A =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REQUEST_TOPIC_B =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REQUEST_TOPIC_C =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const REQUEST_FACTORY = {
  id: "factory" as FactoryId,
  type: "log",
  chainId: 1,
  sourceId: "test",
  address: REQUEST_ADDRESS_B,
  eventSelector: REQUEST_TOPIC_C,
  childAddressLocation: "topic1",
  fromBlock: undefined,
  toBlock: undefined,
} satisfies LogFactory;

test("mergeLogFiltersToBlockRequest returns undefined for no inputs", () => {
  expect(mergeLogFiltersToBlockRequest({ logFilters: [], factories: [] })).toBe(
    undefined,
  );
});

test("mergeLogFiltersToBlockRequest returns one log filter", () => {
  const filter = {
    ...EMPTY_LOG_FILTER,
    address: REQUEST_ADDRESS_A,
    topic0: REQUEST_TOPIC_A,
    topic2: REQUEST_TOPIC_B,
  } satisfies LogFilter;

  expect(
    mergeLogFiltersToBlockRequest({ logFilters: [filter], factories: [] }),
  ).toStrictEqual({
    address: [REQUEST_ADDRESS_A],
    topics: [[REQUEST_TOPIC_A], null, [REQUEST_TOPIC_B]],
  });
});

test("mergeLogFiltersToBlockRequest unions addresses and topics", () => {
  const filterA = {
    ...EMPTY_LOG_FILTER,
    address: REQUEST_ADDRESS_A,
    topic0: REQUEST_TOPIC_A,
    topic1: REQUEST_TOPIC_C,
  } satisfies LogFilter;
  const filterB = {
    ...EMPTY_LOG_FILTER,
    address: [REQUEST_ADDRESS_A, REQUEST_ADDRESS_B],
    topic0: REQUEST_TOPIC_B,
    topic1: [REQUEST_TOPIC_C, REQUEST_TOPIC_A],
  } satisfies LogFilter;

  expect(
    mergeLogFiltersToBlockRequest({
      logFilters: [filterA, filterB],
      factories: [],
    }),
  ).toStrictEqual({
    address: [REQUEST_ADDRESS_A, REQUEST_ADDRESS_B],
    topics: [
      [REQUEST_TOPIC_A, REQUEST_TOPIC_B],
      [REQUEST_TOPIC_C, REQUEST_TOPIC_A],
    ],
  });
});

test("mergeLogFiltersToBlockRequest matches all values if one input matches all values", () => {
  const filterA = {
    ...EMPTY_LOG_FILTER,
    address: REQUEST_ADDRESS_A,
    topic0: REQUEST_TOPIC_A,
    topic1: REQUEST_TOPIC_C,
  } satisfies LogFilter;
  const filterB = {
    ...EMPTY_LOG_FILTER,
    address: undefined,
    topic0: REQUEST_TOPIC_B,
  } satisfies LogFilter;

  expect(
    mergeLogFiltersToBlockRequest({
      logFilters: [filterA, filterB],
      factories: [],
    }),
  ).toStrictEqual({
    address: undefined,
    topics: [[REQUEST_TOPIC_A, REQUEST_TOPIC_B]],
  });
});

test("mergeLogFiltersToBlockRequest matches all addresses for a factory log filter", () => {
  const filter = {
    ...EMPTY_LOG_FILTER,
    address: REQUEST_FACTORY,
    topic0: REQUEST_TOPIC_A,
  } satisfies LogFilter;

  expect(
    mergeLogFiltersToBlockRequest({
      logFilters: [filter],
      factories: [REQUEST_FACTORY],
    }),
  ).toStrictEqual({
    address: undefined,
    topics: [[REQUEST_TOPIC_A, REQUEST_TOPIC_C]],
  });
});

test("mergeLogFiltersToBlockRequest includes factories without log filters", () => {
  expect(
    mergeLogFiltersToBlockRequest({
      logFilters: [],
      factories: [REQUEST_FACTORY],
    }),
  ).toStrictEqual({
    address: [REQUEST_ADDRESS_B],
    topics: [[REQUEST_TOPIC_C]],
  });
});

test("mergeLogFiltersToBlockRequest unions factory and log filter addresses", () => {
  const filter = {
    ...EMPTY_LOG_FILTER,
    address: REQUEST_ADDRESS_A,
    topic0: REQUEST_TOPIC_A,
    topic1: REQUEST_TOPIC_B,
  } satisfies LogFilter;

  expect(
    mergeLogFiltersToBlockRequest({
      logFilters: [filter],
      factories: [REQUEST_FACTORY],
    }),
  ).toStrictEqual({
    address: [REQUEST_ADDRESS_A, REQUEST_ADDRESS_B],
    topics: [[REQUEST_TOPIC_A, REQUEST_TOPIC_C]],
  });
});

test("mergeLogFiltersToBlockRequest matches all addresses for a factory without an address", () => {
  const filter = {
    ...EMPTY_LOG_FILTER,
    address: REQUEST_ADDRESS_A,
    topic0: REQUEST_TOPIC_A,
  } satisfies LogFilter;

  expect(
    mergeLogFiltersToBlockRequest({
      logFilters: [filter],
      factories: [{ ...REQUEST_FACTORY, address: undefined }],
    }),
  ).toStrictEqual({
    address: undefined,
    topics: [[REQUEST_TOPIC_A, REQUEST_TOPIC_C]],
  });
});

test("mergeLogFiltersToBlockRequest ignores inputs with an empty address list", () => {
  const filter = {
    ...EMPTY_LOG_FILTER,
    address: [],
    topic0: REQUEST_TOPIC_A,
  } satisfies LogFilter;

  expect(
    mergeLogFiltersToBlockRequest({
      logFilters: [filter],
      factories: [{ ...REQUEST_FACTORY, address: [] }],
    }),
  ).toBe(undefined);
});

test("mergeLogFiltersToBlockRequest matches all addresses above ADDRESS_CHUNK_SIZE", () => {
  const addresses = Array.from(
    { length: ADDRESS_CHUNK_SIZE + 1 },
    (_, i) => `0x${i.toString(16).padStart(40, "0")}` as Address,
  );
  const filter = {
    ...EMPTY_LOG_FILTER,
    address: addresses,
    topic0: REQUEST_TOPIC_A,
  } satisfies LogFilter;

  expect(
    mergeLogFiltersToBlockRequest({ logFilters: [filter], factories: [] }),
  ).toStrictEqual({ address: undefined, topics: [[REQUEST_TOPIC_A]] });

  expect(
    mergeLogFiltersToBlockRequest({
      logFilters: [{ ...filter, address: addresses.slice(1) }],
      factories: [],
    })?.address,
  ).toHaveLength(ADDRESS_CHUNK_SIZE);
});

test("mergeLogFiltersToBlockRequest matches all topics above ADDRESS_CHUNK_SIZE", () => {
  const topics = Array.from(
    { length: ADDRESS_CHUNK_SIZE + 1 },
    (_, i) => `0x${i.toString(16).padStart(64, "0")}` as Hex,
  );
  const filter = {
    ...EMPTY_LOG_FILTER,
    address: REQUEST_ADDRESS_A,
    topic0: REQUEST_TOPIC_A,
    topic1: topics,
  } satisfies LogFilter;

  expect(
    mergeLogFiltersToBlockRequest({ logFilters: [filter], factories: [] }),
  ).toStrictEqual({
    address: [REQUEST_ADDRESS_A],
    topics: [[REQUEST_TOPIC_A]],
  });

  expect(
    mergeLogFiltersToBlockRequest({
      logFilters: topics.map((topic0) => ({ ...filter, topic0, topic1: null })),
      factories: [],
    }),
  ).toStrictEqual({ address: [REQUEST_ADDRESS_A], topics: undefined });
});
