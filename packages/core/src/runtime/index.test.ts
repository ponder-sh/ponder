import {
  ALICE,
  EMPTY_BLOCK_FILTER,
  EMPTY_LOG_FILTER,
} from "@/_test/constants.js";
import {
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { setupAnvil } from "@/_test/setup.js";
import { deployErc20, mintErc20 } from "@/_test/simulate.js";
import {
  getBlocksIndexingBuild,
  getChain,
  getErc20IndexingBuild,
} from "@/_test/utils.js";
import type {
  BlockFilter,
  Event,
  Filter,
  Fragment,
  LogFilter,
} from "@/internal/types.js";
import { _eth_getBlockByNumber } from "@/rpc/actions.js";
import { createRpc } from "@/rpc/index.js";
import { encodeCheckpoint } from "@/utils/checkpoint.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import type { Interval } from "@/utils/interval.js";
import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
import { parseEther } from "viem";
import { beforeEach, expect, test } from "vitest";
import {
  syncBlockToInternal,
  syncLogToInternal,
  syncTransactionToInternal,
} from "./events.js";
import { getFragments } from "./fragments.js";
import { mergeAsyncGeneratorsWithEventOrder } from "./historical.js";
import {
  getCachedBlock,
  getLocalSyncProgress,
  getRequiredIntervals,
} from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("getLocalSyncProgress()", async (context) => {
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { sources } = getBlocksIndexingBuild({
    interval: 1,
  });

  const cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >();
  for (const source of sources) {
    for (const { fragment } of getFragments(source.filter)) {
      cachedIntervals.set(source.filter, [{ fragment, intervals: [] }]);
    }
  }

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 0 }),
    cachedIntervals,
  });

  expect(syncProgress.finalized.number).toBe("0x0");
  expect(syncProgress.start.number).toBe("0x0");
  expect(syncProgress.end).toBe(undefined);
  expect(syncProgress.current).toBe(undefined);
});

test("getLocalSyncProgress() future end block", async (context) => {
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });

  const { sources } = getBlocksIndexingBuild({
    interval: 1,
  });

  sources[0]!.filter.toBlock = 12;

  const cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >();
  for (const source of sources) {
    for (const { fragment } of getFragments(source.filter)) {
      cachedIntervals.set(source.filter, [{ fragment, intervals: [] }]);
    }
  }

  const syncProgress = await getLocalSyncProgress({
    common: context.common,
    sources,
    chain,
    rpc,
    finalizedBlock: await _eth_getBlockByNumber(rpc, { blockNumber: 0 }),
    cachedIntervals,
  });

  expect(syncProgress.finalized.number).toBe("0x0");
  expect(syncProgress.start.number).toBe("0x0");
  expect(syncProgress.end).toMatchInlineSnapshot(`
    {
      "hash": "0x",
      "number": "0xc",
      "parentHash": "0x",
      "timestamp": "0x2540be3ff",
    }
  `);
  expect(syncProgress.current).toBe(undefined);
});

test("getCachedBlock() no cached intervals", async () => {
  const filter = {
    ...EMPTY_BLOCK_FILTER,
    fromBlock: 0,
    toBlock: 100,
  } satisfies BlockFilter;

  const cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([[filter, []]]);

  const cachedBlock = getCachedBlock({
    filters: [filter],
    cachedIntervals,
  });

  expect(cachedBlock).toBe(undefined);
});

test("getCachedBlock() with cache", async () => {
  const filter = {
    ...EMPTY_BLOCK_FILTER,
    fromBlock: 0,
    toBlock: 100,
  } satisfies BlockFilter;

  let cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([[filter, [{ fragment: {} as Fragment, intervals: [[0, 24]] }]]]);

  let cachedBlock = getCachedBlock({
    filters: [filter],
    cachedIntervals,
  });

  expect(cachedBlock).toBe(24);

  cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([
    [
      filter,
      [
        {
          fragment: {} as Fragment,
          intervals: [
            [0, 50],
            [50, 102],
          ],
        },
      ],
    ],
  ]);

  cachedBlock = getCachedBlock({
    filters: [filter],
    cachedIntervals,
  });

  expect(cachedBlock).toBe(100);
});

test("getCachedBlock() with incomplete cache", async () => {
  const filter = {
    ...EMPTY_BLOCK_FILTER,
    fromBlock: 0,
    toBlock: 100,
  } satisfies BlockFilter;

  const cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([[filter, [{ fragment: {} as Fragment, intervals: [[1, 24]] }]]]);

  const cachedBlock = getCachedBlock({
    filters: [filter],
    cachedIntervals,
  });

  expect(cachedBlock).toBeUndefined();
});

test("getCachedBlock() with multiple filters", async () => {
  const filters = [
    {
      ...EMPTY_BLOCK_FILTER,

      fromBlock: 0,
      toBlock: 100,
    },
    {
      ...EMPTY_BLOCK_FILTER,

      offset: 1,
      fromBlock: 50,
      toBlock: 150,
    },
  ] satisfies BlockFilter[];

  let cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([
    [filters[0]!, [{ fragment: {} as Fragment, intervals: [[0, 24]] }]],
    [filters[1]!, []],
  ]);

  let cachedBlock = getCachedBlock({
    filters,
    cachedIntervals,
  });

  expect(cachedBlock).toBe(24);

  cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([
    [filters[0]!, [{ fragment: {} as Fragment, intervals: [[0, 24]] }]],
    [filters[1]!, [{ fragment: {} as Fragment, intervals: [[50, 102]] }]],
  ]);

  cachedBlock = getCachedBlock({
    filters,
    cachedIntervals,
  });

  expect(cachedBlock).toBe(24);

  cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([
    [filters[0]!, [{ fragment: {} as Fragment, intervals: [[0, 60]] }]],
    [filters[1]!, []],
  ]);

  cachedBlock = getCachedBlock({
    filters,
    cachedIntervals,
  });

  expect(cachedBlock).toBe(49);
});

test("getCachedBlock() with factory", async () => {
  const filter = {
    ...EMPTY_LOG_FILTER,
    address: {
      id: "id",
      type: "log",
      chainId: 1,
      address: "0xef2d6d194084c2de36e0dabfce45d046b37d1106",
      eventSelector:
        "0x02c69be41d0b7e40352fc85be1cd65eb03d40ef8427a0ca4596b1ead9a00e9fc",
      childAddressLocation: "topic1",
      fromBlock: 2,
      toBlock: 5,
    },
    fromBlock: 10,
    toBlock: 20,
  } satisfies LogFilter;

  let cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([[filter, [{ fragment: {} as Fragment, intervals: [[10, 20]] }]]]);

  let cachedBlock = getCachedBlock({
    filters: [filter],
    cachedIntervals,
  });

  expect(cachedBlock).toBe(1);

  cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([
    [
      filter,
      [
        {
          fragment: {} as Fragment,
          intervals: [
            [2, 5],
            [10, 18],
          ],
        },
      ],
    ],
  ]);

  cachedBlock = getCachedBlock({ filters: [filter], cachedIntervals });

  expect(cachedBlock).toBe(18);
});

test("getRequiredIntervals()", async () => {
  const filters = [
    {
      ...EMPTY_BLOCK_FILTER,

      fromBlock: 0,
      toBlock: 100,
    },
    {
      ...EMPTY_BLOCK_FILTER,

      offset: 1,
      fromBlock: 50,
      toBlock: 150,
    },
  ] satisfies BlockFilter[];

  let cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([
    [filters[0]!, [{ fragment: {} as Fragment, intervals: [[0, 24]] }]],
    [filters[1]!, []],
  ]);

  let requiredIntervals = getRequiredIntervals({
    interval: [0, 150],
    cachedIntervals,
  });

  expect(requiredIntervals).toMatchInlineSnapshot(`
    [
      [
        25,
        100,
      ],
      [
        50,
        150,
      ],
    ]
  `);

  cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([
    [filters[0]!, [{ fragment: {} as Fragment, intervals: [[0, 24]] }]],
    [filters[1]!, [{ fragment: {} as Fragment, intervals: [[50, 102]] }]],
  ]);

  requiredIntervals = getRequiredIntervals({
    interval: [0, 150],
    cachedIntervals,
  });

  expect(requiredIntervals).toMatchInlineSnapshot(`
    [
      [
        25,
        100,
      ],
      [
        103,
        150,
      ],
    ]
  `);

  cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([
    [filters[0]!, [{ fragment: {} as Fragment, intervals: [[0, 60]] }]],
    [filters[1]!, []],
  ]);

  requiredIntervals = getRequiredIntervals({
    interval: [0, 150],
    cachedIntervals,
  });

  expect(requiredIntervals).toMatchInlineSnapshot(`
    [
      [
        61,
        100,
      ],
      [
        50,
        150,
      ],
    ]
  `);
});

test("getRequiredIntervals() with factory", async () => {
  const filter = {
    ...EMPTY_LOG_FILTER,
    address: {
      id: "id",
      type: "log",
      chainId: 1,
      address: "0xef2d6d194084c2de36e0dabfce45d046b37d1106",
      eventSelector:
        "0x02c69be41d0b7e40352fc85be1cd65eb03d40ef8427a0ca4596b1ead9a00e9fc",
      childAddressLocation: "topic1",
      fromBlock: 2,
      toBlock: 5,
    },
    fromBlock: 10,
    toBlock: 20,
  } satisfies LogFilter;

  let cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([[filter, [{ fragment: {} as Fragment, intervals: [[2, 18]] }]]]);

  let requiredIntervals = getRequiredIntervals({
    interval: [2, 20],
    cachedIntervals,
  });

  expect(requiredIntervals).toMatchInlineSnapshot(`
    [
      [
        19,
        20,
      ],
    ]
  `);

  cachedIntervals = new Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >([[filter, [{ fragment: {} as Fragment, intervals: [[4, 18]] }]]]);

  requiredIntervals = getRequiredIntervals({
    interval: [2, 20],
    cachedIntervals,
  });

  expect(requiredIntervals).toMatchInlineSnapshot(`
    [
      [
        2,
        20,
      ],
    ]
  `);
});

test.todo("getRequiredIntervalsWithFilters()");

test("mergeAsyncGeneratorsWithEventOrder()", async () => {
  const p1 = promiseWithResolvers<{
    events: Event[];
    checkpoint: string;
    blockRange: [number, number];
  }>();
  const p2 = promiseWithResolvers<{
    events: Event[];
    checkpoint: string;
    blockRange: [number, number];
  }>();
  const p3 = promiseWithResolvers<{
    events: Event[];
    checkpoint: string;
    blockRange: [number, number];
  }>();
  const p4 = promiseWithResolvers<{
    events: Event[];
    checkpoint: string;
    blockRange: [number, number];
  }>();

  async function* generator1() {
    yield await p1.promise;
    yield await p2.promise;
  }

  async function* generator2() {
    yield await p3.promise;
    yield await p4.promise;
  }

  const createCheckpoint = (i: number) =>
    encodeCheckpoint({
      blockTimestamp: BigInt(i),
      chainId: 0n,
      blockNumber: BigInt(i),
      transactionIndex: 0n,
      eventType: 0,
      eventIndex: 0n,
    });

  const generator = mergeAsyncGeneratorsWithEventOrder([
    generator1(),
    generator2(),
  ]);

  p1.resolve({
    events: [
      { checkpoint: createCheckpoint(1), chainId: 1 },
      { checkpoint: createCheckpoint(7), chainId: 1 },
    ] as Event[],
    checkpoint: createCheckpoint(10),
    blockRange: [1, 7],
  });
  p3.resolve({
    events: [
      { checkpoint: createCheckpoint(2), chainId: 2 },
      { checkpoint: createCheckpoint(5), chainId: 2 },
    ] as Event[],
    checkpoint: createCheckpoint(6),
    blockRange: [2, 5],
  });

  await new Promise((res) => setTimeout(res));

  p4.resolve({
    events: [
      { checkpoint: createCheckpoint(8), chainId: 2 },
      { checkpoint: createCheckpoint(11), chainId: 2 },
    ] as Event[],
    checkpoint: createCheckpoint(20),
    blockRange: [8, 11],
  });
  p2.resolve({
    events: [
      { checkpoint: createCheckpoint(8), chainId: 1 },
      { checkpoint: createCheckpoint(13), chainId: 1 },
    ] as Event[],
    checkpoint: createCheckpoint(20),
    blockRange: [8, 13],
  });

  await new Promise((res) => setTimeout(res));

  const results = await drainAsyncGenerator(generator);

  expect(results).toMatchInlineSnapshot(`
    [
      [
        {
          "blockRange": [
            1,
            1,
          ],
          "chainId": 1,
          "checkpoint": "000000000100000000000000000000000000000001000000000000000000000000000000000",
          "events": [
            {
              "chainId": 1,
              "checkpoint": "000000000100000000000000000000000000000001000000000000000000000000000000000",
            },
          ],
        },
        {
          "blockRange": [
            2,
            5,
          ],
          "chainId": 2,
          "checkpoint": "000000000600000000000000000000000000000006000000000000000000000000000000000",
          "events": [
            {
              "chainId": 2,
              "checkpoint": "000000000200000000000000000000000000000002000000000000000000000000000000000",
            },
            {
              "chainId": 2,
              "checkpoint": "000000000500000000000000000000000000000005000000000000000000000000000000000",
            },
          ],
        },
      ],
      [
        {
          "blockRange": [
            1,
            7,
          ],
          "chainId": 1,
          "checkpoint": "000000001000000000000000000000000000000010000000000000000000000000000000000",
          "events": [
            {
              "chainId": 1,
              "checkpoint": "000000000700000000000000000000000000000007000000000000000000000000000000000",
            },
          ],
        },
        {
          "blockRange": [
            8,
            8,
          ],
          "chainId": 2,
          "checkpoint": "000000000800000000000000000000000000000008000000000000000000000000000000000",
          "events": [
            {
              "chainId": 2,
              "checkpoint": "000000000800000000000000000000000000000008000000000000000000000000000000000",
            },
          ],
        },
      ],
      [
        {
          "blockRange": [
            8,
            13,
          ],
          "chainId": 1,
          "checkpoint": "000000002000000000000000000000000000000020000000000000000000000000000000000",
          "events": [
            {
              "chainId": 1,
              "checkpoint": "000000000800000000000000000000000000000008000000000000000000000000000000000",
            },
            {
              "chainId": 1,
              "checkpoint": "000000001300000000000000000000000000000013000000000000000000000000000000000",
            },
          ],
        },
        {
          "blockRange": [
            8,
            11,
          ],
          "chainId": 2,
          "checkpoint": "000000002000000000000000000000000000000020000000000000000000000000000000000",
          "events": [
            {
              "chainId": 2,
              "checkpoint": "000000001100000000000000000000000000000011000000000000000000000000000000000",
            },
          ],
        },
      ],
    ]
  `);
});

test("historical events match realtime events", async (context) => {
  const { syncStore } = await setupDatabaseServices(context);

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { sources } = getErc20IndexingBuild({
    address,
    includeTransactionReceipts: true,
  });

  await syncStore.insertBlocks({ blocks: [blockData.block], chainId: 1 });
  await syncStore.insertTransactions({
    transactions: [blockData.transaction],
    chainId: 1,
  });
  await syncStore.insertLogs({
    logs: [blockData.log],
    chainId: 1,
  });

  const { logs: historicalLogs } = await syncStore.getEventData({
    filters: [sources[0]!.filter],
    fromBlock: 0,
    toBlock: 10,
    chainId: 1,
    limit: 3,
  });

  const realtimeBlockData = [
    {
      block: syncBlockToInternal({ block: blockData.block }),
      logs: [syncLogToInternal({ log: blockData.log })],
      transactions: syncTransactionToInternal({
        transaction: blockData.transaction,
      }),
      transactionReceipts: [],
      traces: [],
    },
  ];

  // Note: blocks and transactions are not asserted because they are non deterministic

  expect(historicalLogs).toMatchInlineSnapshot(`
    [
      {
        "address": "0x5fbdb2315678afecb367f032d93f642f64180aa3",
        "blockNumber": 2,
        "data": "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
        "logIndex": 0,
        "removed": false,
        "topic0": undefined,
        "topic1": undefined,
        "topic2": undefined,
        "topic3": undefined,
        "topics": [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          null,
        ],
        "transactionIndex": 0,
      },
    ]
  `);

  expect(realtimeBlockData[0]!.logs).toMatchInlineSnapshot(`
    [
      {
        "address": "0x5fbdb2315678afecb367f032d93f642f64180aa3",
        "blockNumber": 2,
        "data": "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
        "logIndex": 0,
        "removed": false,
        "topics": [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        ],
        "transactionIndex": 0,
      },
    ]
  `);
});
