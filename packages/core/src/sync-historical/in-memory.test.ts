import { createWalletClient, http, zeroHash } from "viem";
import { parseEther } from "viem/utils";
import { beforeEach, expect, test, vi } from "vitest";
import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import {
  context,
  setupAnvil,
  setupCachedIntervals,
  setupChildAddresses,
  setupCleanup,
  setupCommon,
} from "@/_test/setup.js";
import {
  createPair,
  deployErc20,
  deployFactory,
  mintErc20,
  simulateBlock,
  swapPair,
  transferErc20,
  transferEth,
} from "@/_test/simulate.js";
import {
  anvil,
  getAccountsIndexingBuild,
  getBlocksIndexingBuild,
  getChain,
  getErc20IndexingBuild,
  getPairWithFactoryIndexingBuild,
  testClient,
} from "@/_test/utils.js";
import type { Factory, Filter, LogFilter } from "@/internal/types.js";
import { createRpc, type RequestParameters } from "@/rpc/index.js";
import {
  getRequiredIntervalsWithFilters,
  type IntervalWithFilter,
} from "@/runtime/index.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import type { Interval } from "@/utils/interval.js";
import { toLowerCase } from "@/utils/lowercase.js";
import {
  createInMemoryHistoricalSync,
  mergeGeneratorIntervals,
} from "./in-memory.js";

type EthGetLogsRequest = Extract<RequestParameters, { method: "eth_getLogs" }>;

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupCleanup);

test("createInMemoryHistoricalSync()", async () => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddress: setupChildAddresses(eventCallbacks),
  });

  expect(historicalSync).toBeDefined();
});

test("syncBlockData() with log filter", async () => {
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

  const { eventCallbacks } = getErc20IndexingBuild({
    address,
  });

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddress: setupChildAddresses(eventCallbacks),
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 2],
    filters: eventCallbacks.map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const blockData = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  expect(blockData).toHaveLength(1);
  expect(blockData[0]!.cursor).toBe(2);
  expect(blockData[0]!.blocks).toHaveLength(1);
  expect(blockData[0]!.logs).toHaveLength(1);
  expect(blockData[0]!.transactions).toHaveLength(1);
  expect(blockData[0]!.transactionReceipts).toHaveLength(0);
});

test("syncBlockData() with log filter and transaction receipts", async () => {
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

  const { eventCallbacks } = getErc20IndexingBuild({
    address,
    includeTransactionReceipts: true,
  });

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddress: setupChildAddresses(eventCallbacks),
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 2],
    filters: eventCallbacks.map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const blockData = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  expect(blockData).toHaveLength(1);
  expect(blockData[0]!.logs).toHaveLength(1);
  expect(blockData[0]!.transactionReceipts).toHaveLength(1);
});

test("syncBlockData() skips transaction receipts for zero-hash logs", async () => {
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

  const { eventCallbacks } = getErc20IndexingBuild({
    address,
    includeTransactionReceipts: true,
  });

  const requestSpy = vi.spyOn(rpc, "request");
  const request = async (request: any) => {
    const result = await rpc.request(request);
    if (request.method === "eth_getLogs") {
      return (result as { transactionHash: string }[]).map((log) => ({
        ...log,
        transactionHash: zeroHash,
      }));
    }
    return result;
  };

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc: {
      ...rpc,
      // @ts-expect-error
      request,
    },
    childAddress: setupChildAddresses(eventCallbacks),
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 2],
    filters: eventCallbacks.map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const blockData = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  expect(blockData).toHaveLength(1);
  expect(blockData[0]!.logs).toHaveLength(1);
  expect(blockData[0]!.transactions).toHaveLength(0);
  expect(blockData[0]!.transactionReceipts).toHaveLength(0);

  const receiptRequests = requestSpy.mock.calls.filter(
    ([request]) =>
      request.method === "eth_getBlockReceipts" ||
      request.method === "eth_getTransactionReceipt",
  );
  expect(receiptRequests).toHaveLength(0);
});

test("syncBlockData() dedupes logs matched by many log filters", async () => {
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

  const eventCallbacks = [
    ...getErc20IndexingBuild({ address }).eventCallbacks,
    ...getErc20IndexingBuild({ address }).eventCallbacks,
  ];

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddress: setupChildAddresses(eventCallbacks),
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 2],
    filters: eventCallbacks.map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const blockData = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  expect(blockData).toHaveLength(1);
  expect(blockData[0]!.logs).toHaveLength(1);
  expect(blockData[0]!.transactions).toHaveLength(1);
});

test("syncBlockData() with block filter", async () => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  await simulateBlock();
  await simulateBlock();
  await simulateBlock();

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddress: setupChildAddresses(eventCallbacks),
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 3],
    filters: eventCallbacks.map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const blockData = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  expect(blockData).toHaveLength(3);
  expect(blockData.map(({ cursor }) => cursor)).toStrictEqual([1, 2, 3]);
  expect(blockData.flatMap(({ blocks }) => blocks)).toHaveLength(3);
});

test("syncBlockData() with log factory", async () => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployFactory({ sender: ALICE });
  const { address: pair } = await createPair({
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

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({
    address,
  });

  const spy = vi.spyOn(rpc, "request");

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddress: setupChildAddresses(eventCallbacks),
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 3],
    filters: eventCallbacks.map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const blockData = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  expect(blockData.flatMap(({ logs }) => logs)).toHaveLength(1);

  // `eth_getLogs` for the child filter is narrowed to the child address
  const topic0 = (eventCallbacks[0]!.filter as LogFilter).topic0;
  const childLogsRequests = spy.mock.calls
    .map(([request]) => request)
    .filter(
      (request): request is EthGetLogsRequest =>
        request.method === "eth_getLogs" &&
        (request as EthGetLogsRequest).params[0].topics?.[0] === topic0,
    );
  expect(childLogsRequests.length).toBeGreaterThan(0);
  for (const request of childLogsRequests) {
    expect(request.params[0].address).toStrictEqual([toLowerCase(pair)]);
  }
});

test.each(["contract start block", "crash recovery"])(
  "syncBlockData() with log factory starting earlier than %s",
  async (scenario) => {
    // Note: One block per "eth_getLogs" page puts the factory's first page before
    // the contract's start block.
    const chain = {
      ...getChain({ rpcRequestCache: false }),
      ethGetLogsBlockRange: 1,
    };
    const rpc = createRpc({ chain, common: context.common });

    const { address } = await deployFactory({ sender: ALICE });
    const { address: pair } = await createPair({
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

    const { eventCallbacks } = getPairWithFactoryIndexingBuild({ address });
    const filter = eventCallbacks[0]!.filter as LogFilter;
    filter.fromBlock = scenario === "contract start block" ? 3 : 0;

    const historicalSync = createInMemoryHistoricalSync({
      common: context.common,
      chain,
      rpc,
      childAddress: setupChildAddresses(eventCallbacks),
    });
    const requiredIntervals = getRequiredIntervalsWithFilters({
      interval: [0, 3],
      filters: [filter],
      cachedIntervals: setupCachedIntervals(eventCallbacks),
    });
    // Crash recovery can move the required interval beyond the configured start.
    requiredIntervals.intervals[0]!.interval[0] = 3;
    expect(requiredIntervals.factoryIntervals[0]!.interval).toStrictEqual([
      0, 3,
    ]);

    const blockData = await drainAsyncGenerator(
      historicalSync.syncBlockData({
        requiredIntervals: requiredIntervals.intervals,
        requiredFactoryIntervals: requiredIntervals.factoryIntervals,
      }),
    );

    expect(blockData.map(({ cursor }) => cursor)).toStrictEqual([3]);
    expect(blockData.flatMap(({ logs }) => logs)).toHaveLength(1);
    expect(blockData[0]!.logs[0]!.address).toBe(toLowerCase(pair));
  },
);

test("syncBlockData() with trace factory waits for child addresses", async () => {
  // Note: One block per "eth_getLogs" page, so the trace filter must wait for the
  // factory to reach each block.
  const chain = { ...getChain(), ethGetLogsBlockRange: 1 };
  const rpc = createRpc({ chain, common: context.common });

  const { address } = await deployFactory({ sender: ALICE });
  const { address: pair } = await createPair({
    factory: address,
    sender: ALICE,
  });
  const { trace } = await swapPair({
    pair,
    amount0Out: 1n,
    amount1Out: 1n,
    to: ALICE,
    sender: ALICE,
  });

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({
    address,
    includeCallTraces: true,
  });

  const request = async (request: any) => {
    if (request.method === "debug_traceBlockByNumber") {
      if (request.params[0] === "0x3") {
        return [{ txHash: trace.transactionHash, result: trace.trace }];
      }
      return [];
    }
    return rpc.request(request);
  };

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc: {
      ...rpc,
      // @ts-expect-error
      request,
    },
    childAddress: setupChildAddresses(eventCallbacks),
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 3],
    filters: eventCallbacks
      .filter(({ filter }) => filter.type === "trace")
      .map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const result = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  const traces = result.flatMap(({ traces }) => traces);
  expect(traces).toHaveLength(1);
  expect(traces[0]!.to).toBe(toLowerCase(pair));
});

test("syncBlockData() fetches child addresses without required intervals", async () => {
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { address } = await deployFactory({ sender: ALICE });
  const { address: pair } = await createPair({
    factory: address,
    sender: ALICE,
  });

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({ address });
  const filter = eventCallbacks[0]!.filter as LogFilter<Factory>;
  const childAddress = setupChildAddresses(eventCallbacks);

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddress,
  });

  // Note: The contract `startBlock` is after the finalized block, but the factory
  // `startBlock` is not.
  const blockData = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: [],
      requiredFactoryIntervals: [{ factory: filter.address, interval: [1, 2] }],
    }),
  );

  expect(blockData).toHaveLength(0);
  expect(childAddress.get(filter.address.id)!.get(toLowerCase(pair))).toBe(2);
});

test("syncBlockData() with log factory and no address", async () => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployFactory({ sender: ALICE });
  const { address: pair } = await createPair({
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

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({
    address,
  });

  // @ts-expect-error
  eventCallbacks[0].filter.address.address = undefined;

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddress: setupChildAddresses(eventCallbacks),
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 3],
    filters: eventCallbacks.map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const blockData = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  expect(blockData.flatMap(({ logs }) => logs)).toHaveLength(1);
});

test("syncBlockData() with log factory error", async () => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployFactory({ sender: ALICE });
  const { address: pair } = await createPair({
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

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({
    address,
  });

  // @ts-expect-error
  eventCallbacks[0].filter.address.address = undefined;
  // @ts-expect-error
  // Invalid child address location causes extracting child address to throw an error
  eventCallbacks[0].filter.address.childAddressLocation = "topic3";

  const childAddresses = setupChildAddresses(eventCallbacks);
  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddress: childAddresses,
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 3],
    filters: eventCallbacks.map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const blockData = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  expect(blockData.flatMap(({ logs }) => logs)).toHaveLength(0);
  // @ts-expect-error
  expect(childAddresses.get(eventCallbacks[0].filter.address.id)!.size).toBe(0);
});

test("syncBlockData() with trace filter", async () => {
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

  const request = async (request: any) => {
    if (request.method === "debug_traceBlockByNumber") {
      if (request.params[0] === "0x1") return Promise.resolve([]);
      if (request.params[0] === "0x2") return Promise.resolve([]);
      if (request.params[0] === "0x3") {
        return Promise.resolve([
          {
            txHash: blockData.trace.transactionHash,
            result: blockData.trace.trace,
          },
        ]);
      }
    }

    return rpc.request(request);
  };

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc: {
      ...rpc,
      // @ts-expect-error
      request,
    },
    childAddress: setupChildAddresses(eventCallbacks),
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 3],
    filters: eventCallbacks
      .filter(({ filter }) => filter.type === "trace")
      .map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const result = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  const traces = result.flatMap(({ traces }) => traces);
  expect(traces).toHaveLength(1);
  expect(result.flatMap(({ transactions }) => transactions)).toHaveLength(1);
});

test("syncBlockData() with transaction filter", async () => {
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

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddress: setupChildAddresses(eventCallbacks),
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 1],
    filters: eventCallbacks
      .filter(({ filter }) => filter.type === "transaction")
      .map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const blockData = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  expect(blockData).toHaveLength(1);
  expect(blockData[0]!.transactions).toHaveLength(1);
  expect(blockData[0]!.transactionReceipts).toHaveLength(1);
});

test("syncBlockData() with transfer filter", async () => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const blockData = await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getAccountsIndexingBuild({
    address: ALICE,
  });

  const request = async (request: any) => {
    if (request.method === "debug_traceBlockByNumber") {
      if (request.params[0] === "0x1") {
        return Promise.resolve([
          {
            txHash: blockData.trace.transactionHash,
            result: blockData.trace.trace,
          },
        ]);
      }
    }

    return rpc.request(request);
  };

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc: {
      ...rpc,
      // @ts-expect-error
      request,
    },
    childAddress: setupChildAddresses(eventCallbacks),
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 1],
    filters: eventCallbacks
      .filter(({ filter }) => filter.type === "transfer")
      .map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const result = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  expect(result).toHaveLength(1);
  expect(result[0]!.transactions).toHaveLength(1);
  expect(result[0]!.traces).toHaveLength(1);
});

test("syncBlockData() with many filters", async () => {
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

  const { eventCallbacks: erc20EventCallbacks } = getErc20IndexingBuild({
    address,
  });

  const { eventCallbacks: blocksEventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddress: setupChildAddresses([
      ...erc20EventCallbacks,
      ...blocksEventCallbacks,
    ]),
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 2],
    filters: [...erc20EventCallbacks, ...blocksEventCallbacks].map(
      ({ filter }) => filter,
    ),
    cachedIntervals: setupCachedIntervals([
      ...erc20EventCallbacks,
      ...blocksEventCallbacks,
    ]),
  });
  const blockData = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  expect(blockData.map(({ cursor }) => cursor)).toStrictEqual([1, 2]);
  expect(blockData.flatMap(({ logs }) => logs)).toHaveLength(1);
  expect(blockData.flatMap(({ blocks }) => blocks)).toHaveLength(2);
});

test("syncBlockData() handles many factory addresses", async () => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  context.common.options.factoryAddressCountThreshold = 10;

  const { address } = await deployFactory({ sender: ALICE });

  for (let i = 0; i < 10; i++) {
    await createPair({ factory: address, sender: ALICE });
  }

  const { address: pair } = await createPair({
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

  const { eventCallbacks } = getPairWithFactoryIndexingBuild({
    address,
  });

  const spy = vi.spyOn(rpc, "request");

  const childAddresses = setupChildAddresses(eventCallbacks);
  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddress: childAddresses,
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 13],
    filters: eventCallbacks.map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const blockData = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  expect(blockData.flatMap(({ logs }) => logs)).toHaveLength(1);
  // @ts-expect-error
  expect(childAddresses.get(eventCallbacks[0].filter.address.id)!.size).toBe(
    11,
  );

  // `eth_getLogs` for the child filter is not narrowed above the threshold
  const topic0 = (eventCallbacks[0]!.filter as LogFilter).topic0;
  const childLogsRequests = spy.mock.calls
    .map(([request]) => request)
    .filter(
      (request): request is EthGetLogsRequest =>
        request.method === "eth_getLogs" &&
        (request as EthGetLogsRequest).params[0].topics?.[0] === topic0,
    );
  expect(childLogsRequests.length).toBeGreaterThan(0);
  for (const request of childLogsRequests) {
    expect(request.params[0].address).toBeUndefined();
  }
});

test("syncBlockData() yields ordered block data", async () => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address: erc20A } = await deployErc20({ sender: ALICE });
  const { address: erc20B } = await deployErc20({ sender: ALICE });

  // Note: One block with an eth transfer and two erc20 mints, in that order.
  const walletClient = createWalletClient({
    chain: anvil,
    transport: http(),
    account: ALICE,
  });
  await walletClient.sendTransaction({ to: BOB, value: parseEther("1") });
  await walletClient.writeContract({
    abi: erc20ABI,
    functionName: "mint",
    address: erc20A,
    args: [ALICE, parseEther("1")],
  });
  await walletClient.writeContract({
    abi: erc20ABI,
    functionName: "mint",
    address: erc20B,
    args: [ALICE, parseEther("1")],
  });
  await testClient.mine({ blocks: 1 });

  // Note: The erc20 log filters are in reverse order, so logs are fetched out of order.
  const eventCallbacks = [
    ...getErc20IndexingBuild({
      address: erc20B,
      includeTransactionReceipts: true,
    }).eventCallbacks,
    ...getErc20IndexingBuild({
      address: erc20A,
      includeTransactionReceipts: true,
    }).eventCallbacks,
    ...getAccountsIndexingBuild({ address: ALICE }).eventCallbacks.filter(
      ({ filter }) => filter.type === "transaction",
    ),
    ...getBlocksIndexingBuild({ interval: 1 }).eventCallbacks,
  ];

  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain,
    rpc,
    childAddress: setupChildAddresses(eventCallbacks),
  });

  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval: [1, 3],
    filters: eventCallbacks.map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const blockData = await drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );

  expect(blockData.map(({ cursor }) => cursor)).toStrictEqual([1, 2, 3]);
  expect(blockData[2]!.logs.map(({ logIndex }) => logIndex)).toStrictEqual([
    0, 1,
  ]);
  expect(
    blockData[2]!.transactions.map(({ transactionIndex }) => transactionIndex),
  ).toStrictEqual([0, 1, 2]);
  expect(
    blockData[2]!.transactionReceipts.map(
      ({ transactionIndex }) => transactionIndex,
    ),
  ).toStrictEqual([0, 1, 2]);
});

const createIntervalGenerators = (
  intervals: { interval: Interval; yields: Interval[] }[],
) => {
  const filterGenerators = new Map<
    IntervalWithFilter,
    AsyncGenerator<Interval>
  >();
  for (const { interval, yields } of intervals) {
    filterGenerators.set(
      { filter: {} as Filter, interval },
      (async function* () {
        yield* yields;
      })(),
    );
  }
  return filterGenerators;
};

test("mergeGeneratorIntervals()", async () => {
  const intervals = await drainAsyncGenerator(
    mergeGeneratorIntervals(
      createIntervalGenerators([
        {
          interval: [1, 10],
          yields: [
            [1, 4],
            [5, 10],
          ],
        },
        {
          interval: [1, 10],
          yields: [
            [1, 2],
            [3, 6],
            [7, 10],
          ],
        },
      ]),
    ),
  );

  expect(intervals).toStrictEqual([
    [1, 2],
    [3, 4],
    [5, 6],
    [7, 10],
  ]);
});

test("mergeGeneratorIntervals() with different intervals", async () => {
  const intervals = await drainAsyncGenerator(
    mergeGeneratorIntervals(
      createIntervalGenerators([
        { interval: [1, 5], yields: [[1, 5]] },
        { interval: [3, 10], yields: [[3, 10]] },
      ]),
    ),
  );

  expect(intervals).toStrictEqual([
    [1, 5],
    [6, 10],
  ]);
});

test("mergeGeneratorIntervals() with no generators", async () => {
  const intervals = await drainAsyncGenerator(
    mergeGeneratorIntervals(createIntervalGenerators([])),
  );

  expect(intervals).toStrictEqual([]);
});
