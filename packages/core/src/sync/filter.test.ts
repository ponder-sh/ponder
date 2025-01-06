import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import { setupAnvil, setupCommon } from "@/_test/setup.js";
import {
  createPair,
  deployErc20,
  deployFactory,
  mintErc20,
  transferErc20,
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
import type {
  BlockFilter,
  LogFactory,
  LogFilter,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import type { SyncLog, SyncTrace } from "@/types/sync.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import { _eth_getBlockByNumber, _eth_getLogs } from "@/utils/rpc.js";
import {
  type Address,
  encodeFunctionData,
  encodeFunctionResult,
  parseEther,
  zeroAddress,
  zeroHash,
} from "viem";
import { beforeEach, expect, test } from "vitest";
import {
  getChildAddress,
  isBlockFilterMatched,
  isLogFactoryMatched,
  isLogFilterMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
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

test("isLogFactoryMatched()", async (context) => {
  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { address } = await deployFactory({ sender: ALICE });
  await createPair({
    factory: address,
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

  const filter = sources[0]!.filter as LogFilter<LogFactory>;

  const rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });

  let isMatched = isLogFactoryMatched({
    filter: filter.address,
    log: rpcLogs[0]!,
  });
  expect(isMatched).toBe(true);

  filter.address.address = [filter.address.address as Address];

  isMatched = isLogFactoryMatched({
    filter: filter.address,
    log: rpcLogs[0]!,
  });
  expect(isMatched).toBe(true);

  rpcLogs[0]!.topics[0] = zeroHash;

  isMatched = isLogFactoryMatched({
    filter: filter.address,
    log: rpcLogs[0]!,
  });
  expect(isMatched).toBe(false);
});

test("isLogFilterMatched()", async (context) => {
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

  const filter = sources[0]!.filter as LogFilter<undefined>;

  const rpcLogs = await _eth_getLogs(requestQueue, {
    fromBlock: 2,
    toBlock: 2,
  });

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 2,
  });

  let isMatched = isLogFilterMatched({
    filter,
    block: rpcBlock,
    log: rpcLogs[0]!,
  });
  expect(isMatched).toBe(true);

  filter.topic0 = null;

  isMatched = isLogFilterMatched({
    filter,
    block: rpcBlock,
    log: rpcLogs[0]!,
  });
  expect(isMatched).toBe(true);

  rpcLogs[0]!.address = zeroAddress;

  isMatched = isLogFilterMatched({
    filter,
    block: rpcBlock,
    log: rpcLogs[0]!,
  });
  expect(isMatched).toBe(false);
});

test("isBlockFilterMatched", async (context) => {
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

  const filter = sources[0]!.filter as BlockFilter;

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 0,
  });

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

test("isTransactionFilterMatched()", async (context) => {
  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  await transferEth({
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

  // transaction:from
  const filter = sources[1]!.filter as TransactionFilter<undefined, undefined>;

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
  });

  let isMatched = isTransactionFilterMatched({
    filter,
    block: rpcBlock,
    transaction: rpcBlock.transactions[0]!,
  });
  expect(isMatched).toBe(true);

  rpcBlock.transactions[0]!.from = zeroAddress;

  isMatched = isTransactionFilterMatched({
    filter,
    block: rpcBlock,
    transaction: rpcBlock.transactions[0]!,
  });
  expect(isMatched).toBe(false);
});

test("isTransferFilterMatched()", async (context) => {
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

  // transfer:from
  const filter = sources[3]!.filter as TransferFilter<undefined, undefined>;

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 1,
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

  let isMatched = isTransferFilterMatched({
    filter,
    block: rpcBlock,
    trace: rpcTrace.trace,
  });
  expect(isMatched).toBe(true);

  rpcTrace.trace.value = "0x0";

  isMatched = isTransferFilterMatched({
    filter,
    block: rpcBlock,
    trace: rpcTrace.trace,
  });
  expect(isMatched).toBe(false);
});

test("isTraceFilterMatched()", async (context) => {
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
  const { hash } = await transferErc20({
    erc20: address,
    to: BOB,
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

  const filter = sources[1]!.filter as TraceFilter<undefined, undefined>;

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

  const rpcBlock = await _eth_getBlockByNumber(requestQueue, {
    blockNumber: 3,
  });

  let isMatched = isTraceFilterMatched({
    filter,
    block: rpcBlock,
    trace: rpcTrace.trace,
  });
  expect(isMatched).toBe(true);

  filter.functionSelector = undefined;

  isMatched = isTraceFilterMatched({
    filter,
    block: rpcBlock,
    trace: rpcTrace.trace,
  });
  expect(isMatched).toBe(true);

  rpcTrace.trace.to = zeroAddress;

  isMatched = isTraceFilterMatched({
    filter,
    block: rpcBlock,
    trace: rpcTrace.trace,
  });
  expect(isMatched).toBe(false);
});
