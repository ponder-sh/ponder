import { ALICE } from "@/_test/constants.js";
import { setupAnvil, setupCommon } from "@/_test/setup.js";
import {
  createPair,
  deployErc20,
  deployFactory,
  mintErc20,
} from "@/_test/simulate.js";
import {
  getBlocksConfigAndIndexingFunctions,
  getErc20ConfigAndIndexingFunctions,
  getNetwork,
  getPairWithFactoryConfigAndIndexingFunctions,
} from "@/_test/utils.js";
import { buildConfigAndIndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import type { BlockFilter, LogFactory, LogFilter } from "@/sync/source.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import { _eth_getBlockByNumber, _eth_getLogs } from "@/utils/rpc.js";
import { type Address, parseEther, zeroAddress, zeroHash } from "viem";
import { beforeEach, expect, test } from "vitest";
import {
  isBlockFilterMatched,
  isLogFactoryMatched,
  isLogFilterMatched,
} from "./filter.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

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
    options: {
      ponderDir: "",
      rootDir: "",
    },
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
    options: {
      ponderDir: "",
      rootDir: "",
    },
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
    options: {
      ponderDir: "",
      rootDir: "",
    },
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

test.todo("isTransactionFilterMatched()");

test.todo("isTransferFilterMatched()");

test.todo("isTraceFilterMatched()");
