import { ALICE, BOB } from "@/_test/constants.js";
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
import { _eth_getBlockByNumber } from "@/rpc/actions.js";
import { createRpc } from "@/rpc/index.js";
import { type Address, parseEther, zeroAddress, zeroHash } from "viem";
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

test("isBlockFilterMatched", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const filter = eventCallbacks[0]!.filter as BlockFilter;

  const rpcBlock = await _eth_getBlockByNumber(rpc, {
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

  const rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 1,
  });

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

test("isTransactionFilterMatched() with null transaction.to", async (context) => {
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

  const rpcBlock = await _eth_getBlockByNumber(rpc, {
    blockNumber: 1,
  });

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
