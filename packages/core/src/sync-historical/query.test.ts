import { expect, test, vi } from "vitest";
import type { Common } from "@/internal/common.js";
import type { Factory, Filter } from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import { createQueryHistoricalSync } from "./query.js";

const FACTORY: `0x${string}` = "0x1111111111111111111111111111111111111111";
const CHILD: `0x${string}` = "0x2222222222222222222222222222222222222222";
const OTHER: `0x${string}` = "0x3333333333333333333333333333333333333333";
const HASH: `0x${string}` =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PARENT: `0x${string}` =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TRANSFER: `0x${string}` =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const LOGS_BLOOM = `0x${"0".repeat(512)}` as const;
const block = {
  number: "0x1",
  hash: HASH,
  parentHash: PARENT,
};

const createSyncStore = () => ({
  insertChildAddresses: vi.fn(async () => {}),
  insertBlocks: vi.fn(async () => {}),
  insertTransactions: vi.fn(async () => {}),
  insertTransactionReceipts: vi.fn(async () => {}),
  insertLogs: vi.fn(async () => {}),
  insertTraces: vi.fn(async () => {}),
});

test("persists child addresses discovered from factories", async () => {
  const factory = {
    id: "factory",
    type: "log",
    chainId: 1,
    sourceId: "Factory",
    address: FACTORY,
    eventSelector: TRANSFER,
    childAddressLocation: "topic1",
    fromBlock: 1,
    toBlock: 1,
  } as const satisfies Factory;
  const syncStore = createSyncStore();
  const rpc = {
    request: vi.fn(async () => ({
      fromBlock: block,
      toBlock: block,
      cursorBlock: block,
      data: {
        blocks: [],
        transactions: [],
        logs: [
          {
            address: FACTORY,
            blockHash: HASH,
            blockNumber: "0x1",
            data: "0x",
            logIndex: "0x0",
            topics: [
              TRANSFER,
              "0x0000000000000000000000002222222222222222222222222222222222222222",
            ],
            transactionHash: HASH,
            transactionIndex: "0x0",
          },
        ],
        traces: [],
        transfers: [],
      },
    })),
  } as unknown as Rpc;
  const logger = { debug: vi.fn(), child: () => ({}) };
  const historicalSync = createQueryHistoricalSync({
    common: { logger } as unknown as Common,
    chain: { id: 1, name: "mainnet" } as never,
    rpc,
    childAddresses: new Map([[factory.id, new Map()]]),
  });

  await drainAsyncGenerator(
    historicalSync.syncQueryBlockData({
      requiredIntervals: [],
      requiredFactoryIntervals: [{ factory, interval: [1, 1] }],
      syncStore: syncStore as unknown as SyncStore,
    }),
  );

  expect(syncStore.insertChildAddresses).toHaveBeenCalledWith(
    {
      factory,
      childAddresses: new Map([[CHILD, 1]]),
      chainId: 1,
    },
    expect.any(Object),
  );
  expect(logger.debug).toHaveBeenCalledWith(
    expect.objectContaining({
      msg: "Fetched block range data",
      chain: "mainnet",
      chain_id: 1,
      data_type: "factory_log",
      block_range: "[1,1]",
      log_count: 1,
      child_address_count: 1,
      duration: expect.any(Number),
    }),
    ["chain", "data_type", "block_range"],
  );
});

test("syncs factory-dependent filters through the factory frontier", async () => {
  const factory = {
    id: "factory",
    type: "log",
    chainId: 1,
    sourceId: "Factory",
    address: FACTORY,
    eventSelector: TRANSFER,
    childAddressLocation: "topic1",
    fromBlock: 1,
    toBlock: 2,
  } as const satisfies Factory;
  const secondBlock = { ...block, number: "0x2" as const };
  const requests: { method: string; params: unknown[] }[] = [];
  let resolveFirstFactoryPage!: (value: unknown) => void;
  let resolveSecondFactoryPage!: (value: unknown) => void;
  const firstFactoryPage = new Promise((resolve) => {
    resolveFirstFactoryPage = resolve;
  });
  const secondFactoryPage = new Promise((resolve) => {
    resolveSecondFactoryPage = resolve;
  });
  let factoryRequestCount = 0;

  const rpc = {
    request: vi.fn(
      async ({ method, params }: { method: string; params: unknown[] }) => {
        requests.push({ method, params: structuredClone(params) });
        const request = params[0] as {
          fields?: { blocks?: boolean };
          fromBlock: `0x${string}`;
        };

        if (method === "eth_queryBlocks") {
          return {
            fromBlock: block,
            toBlock: secondBlock,
            cursorBlock: secondBlock,
            data: { blocks: [] },
          };
        }

        if (method === "eth_queryLogs" && request.fields?.blocks !== true) {
          factoryRequestCount++;
          return factoryRequestCount === 1
            ? firstFactoryPage
            : secondFactoryPage;
        }

        const responseBlock = request.fromBlock === "0x1" ? block : secondBlock;
        return {
          fromBlock: responseBlock,
          toBlock: responseBlock,
          cursorBlock: responseBlock,
          data: { blocks: [], transactions: [], logs: [] },
        };
      },
    ),
  } as unknown as Rpc;
  const historicalSync = createQueryHistoricalSync({
    common: {
      logger: { debug: vi.fn(), child: () => ({}) },
      options: { factoryAddressCountThreshold: 1000 },
    } as unknown as Common,
    chain: { id: 1, name: "mainnet" } as never,
    rpc,
    childAddresses: new Map([[factory.id, new Map()]]),
  });
  const blockFilter = {
    type: "block",
    interval: 1,
    offset: 0,
  } as Filter;
  const factoryFilter = {
    type: "log",
    address: factory,
    topic0: TRANSFER,
    topic1: null,
    topic2: null,
    topic3: null,
  } as unknown as Filter;
  const generator = historicalSync.syncQueryBlockData({
    requiredIntervals: [
      { filter: blockFilter, interval: [1, 2] },
      { filter: factoryFilter, interval: [1, 2] },
    ],
    requiredFactoryIntervals: [{ factory, interval: [1, 2] }],
    syncStore: createSyncStore() as unknown as SyncStore,
  });

  const firstResult = await generator.next();
  expect(firstResult.value).toMatchObject({ filters: [blockFilter] });
  expect(
    requests.filter(({ method }) => method === "eth_queryLogs"),
  ).toHaveLength(1);

  resolveFirstFactoryPage({
    fromBlock: block,
    toBlock: secondBlock,
    cursorBlock: block,
    data: {
      logs: [
        {
          address: FACTORY,
          blockHash: HASH,
          blockNumber: "0x1",
          data: "0x",
          logIndex: "0x0",
          topics: [
            TRANSFER,
            "0x0000000000000000000000002222222222222222222222222222222222222222",
          ],
          transactionHash: HASH,
          transactionIndex: "0x0",
        },
      ],
    },
  });

  await vi.waitFor(() => {
    expect(
      requests.find(
        ({ method, params }) =>
          method === "eth_queryLogs" &&
          (params[0] as { fields?: { blocks?: boolean } }).fields?.blocks ===
            true,
      ),
    ).toMatchObject({
      params: [
        { fromBlock: "0x1", toBlock: "0x1", filter: { address: [CHILD] } },
      ],
    });
  });

  resolveSecondFactoryPage({
    fromBlock: secondBlock,
    toBlock: secondBlock,
    cursorBlock: secondBlock,
    data: {
      logs: [
        {
          address: FACTORY,
          blockHash: HASH,
          blockNumber: "0x2",
          data: "0x",
          logIndex: "0x0",
          topics: [
            TRANSFER,
            "0x0000000000000000000000003333333333333333333333333333333333333333",
          ],
          transactionHash: HASH,
          transactionIndex: "0x0",
        },
      ],
    },
  });
  await drainAsyncGenerator(generator);

  expect(
    requests.find(
      ({ method, params }) =>
        method === "eth_queryLogs" &&
        (params[0] as { fromBlock?: string }).fromBlock === "0x2" &&
        (params[0] as { fields?: { blocks?: boolean } }).fields?.blocks ===
          true,
    ),
  ).toMatchObject({
    params: [
      {
        fromBlock: "0x2",
        toBlock: "0x2",
        filter: { address: [CHILD, OTHER] },
      },
    ],
  });
});

const queryRequests = async (
  filters: Filter[],
  childAddresses: Map<string, Map<`0x${string}`, number>> = new Map(),
) => {
  const requests: { method: string; params: unknown[] }[] = [];
  const rpc = {
    request: vi.fn(async (request: { method: string; params: unknown[] }) => {
      requests.push(request);
      return {
        fromBlock: block,
        toBlock: block,
        cursorBlock: block,
        data: {
          blocks: [],
          transactions: [],
          logs: [],
          traces: [],
          transfers: [],
        },
      };
    }),
  } as unknown as Rpc;
  const logger = { debug: vi.fn(), child: () => ({}) };
  const historicalSync = createQueryHistoricalSync({
    common: {
      logger,
      options: { factoryAddressCountThreshold: 1000 },
    } as unknown as Common,
    chain: { id: 1 } as never,
    rpc,
    childAddresses,
  });

  await drainAsyncGenerator(
    historicalSync.syncQueryBlockData({
      requiredIntervals: filters.map((filter) => ({
        filter,
        interval: [1, 1],
      })),
      requiredFactoryIntervals: [],
      syncStore: createSyncStore() as unknown as SyncStore,
    }),
  );

  return requests;
};

test("query requests send address filters without batching", async () => {
  const addresses = Array.from(
    { length: 51 },
    (_, index) => `0x${index.toString(16).padStart(40, "0")}` as const,
  );
  const requests = await queryRequests([
    {
      type: "transaction",
      fromAddress: addresses,
      toAddress: CHILD,
    } as Filter,
    {
      type: "log",
      address: addresses,
      topic0: TRANSFER,
      topic1: null,
      topic2: null,
      topic3: null,
    } as Filter,
    {
      type: "trace",
      fromAddress: CHILD,
      toAddress: addresses,
      functionSelector: "0x12345678",
    } as unknown as Filter,
    {
      type: "transfer",
      fromAddress: addresses,
      toAddress: addresses,
    } as Filter,
  ]);

  const transactionRequests = requests.filter(
    ({ method }) => method === "eth_queryTransactions",
  );
  expect(transactionRequests).toHaveLength(1);
  expect(transactionRequests[0]!.params[0]).toMatchObject({
    filter: { from: addresses, to: CHILD },
  });

  const logRequests = requests.filter(
    ({ method }) => method === "eth_queryLogs",
  );
  expect(logRequests).toHaveLength(1);
  expect(logRequests[0]!.params[0]).toMatchObject({
    filter: { address: addresses, topics: [TRANSFER] },
  });

  const traceRequests = requests.filter(
    ({ method }) => method === "eth_queryTraces",
  );
  expect(traceRequests).toHaveLength(1);
  expect(traceRequests[0]!.params[0]).toMatchObject({
    filter: { from: CHILD, to: addresses, selector: "0x12345678" },
  });

  const transferRequests = requests.filter(
    ({ method }) => method === "eth_queryTransfers",
  );
  expect(transferRequests).toHaveLength(1);
  expect(transferRequests[0]!.params[0]).toMatchObject({
    filter: { from: addresses, to: addresses },
  });
});

test("query requests skip empty address filters", async () => {
  const factory = {
    id: "factory",
    type: "log",
    chainId: 1,
    sourceId: "Factory",
    address: FACTORY,
    eventSelector: TRANSFER,
    childAddressLocation: "topic1",
    fromBlock: 1,
    toBlock: 1,
  } as const satisfies Factory;

  const requests = await queryRequests(
    [
      {
        type: "transaction",
        fromAddress: [],
        toAddress: CHILD,
      } as unknown as Filter,
      {
        type: "log",
        address: [],
        topic0: TRANSFER,
        topic1: null,
        topic2: null,
        topic3: null,
      } as unknown as Filter,
      {
        type: "trace",
        fromAddress: CHILD,
        toAddress: [],
        functionSelector: "0x12345678",
      } as unknown as Filter,
      {
        type: "transfer",
        fromAddress: CHILD,
        toAddress: [],
      } as unknown as Filter,
      {
        type: "log",
        address: factory,
        topic0: TRANSFER,
        topic1: null,
        topic2: null,
        topic3: null,
      } as unknown as Filter,
    ],
    new Map([[factory.id, new Map()]]),
  );

  expect(requests).toStrictEqual([]);
});

test("query requests omit the address filter at the factory address count threshold", async () => {
  const factory = {
    id: "factory",
    type: "log",
    chainId: 1,
    sourceId: "Factory",
    address: FACTORY,
    eventSelector: TRANSFER,
    childAddressLocation: "topic1",
    fromBlock: 1,
    toBlock: 1,
  } as const satisfies Factory;
  const requests: { method: string; params: unknown[] }[] = [];
  const rpc = {
    request: vi.fn(async (request: { method: string; params: unknown[] }) => {
      requests.push(request);
      return {
        fromBlock: block,
        toBlock: block,
        cursorBlock: block,
        data: { blocks: [], transactions: [], logs: [] },
      };
    }),
  } as unknown as Rpc;
  const historicalSync = createQueryHistoricalSync({
    common: {
      logger: { debug: vi.fn(), child: () => ({}) },
      // Note: matches the threshold with a single child address.
      options: { factoryAddressCountThreshold: 1 },
    } as unknown as Common,
    chain: { id: 1, name: "mainnet" } as never,
    rpc,
    childAddresses: new Map([[factory.id, new Map([[CHILD, 1]])]]),
  });

  await drainAsyncGenerator(
    historicalSync.syncQueryBlockData({
      requiredIntervals: [
        {
          filter: {
            type: "log",
            address: factory,
            topic0: TRANSFER,
            topic1: null,
            topic2: null,
            topic3: null,
          } as unknown as Filter,
          interval: [1, 1],
        },
      ],
      requiredFactoryIntervals: [],
      syncStore: createSyncStore() as unknown as SyncStore,
    }),
  );

  expect(requests).toHaveLength(1);
  expect(
    (requests[0]!.params[0] as { filter: { address: unknown } }).filter.address,
  ).toBeUndefined();
});

test("query requests complete the interval of skipped empty address filters", async () => {
  const factory = {
    id: "factory",
    type: "log",
    chainId: 1,
    sourceId: "Factory",
    address: FACTORY,
    eventSelector: TRANSFER,
    childAddressLocation: "topic1",
    fromBlock: 1,
    toBlock: 2,
  } as const satisfies Factory;
  const rpc = { request: vi.fn() } as unknown as Rpc;
  const historicalSync = createQueryHistoricalSync({
    common: {
      logger: { debug: vi.fn(), child: () => ({}) },
      options: { factoryAddressCountThreshold: 1000 },
    } as unknown as Common,
    chain: { id: 1, name: "mainnet" } as never,
    rpc,
    childAddresses: new Map([[factory.id, new Map()]]),
  });
  const filter = {
    type: "log",
    address: factory,
    topic0: TRANSFER,
    topic1: null,
    topic2: null,
    topic3: null,
  } as unknown as Filter;

  const results = await drainAsyncGenerator(
    historicalSync.syncQueryBlockData({
      requiredIntervals: [{ filter, interval: [1, 2] }],
      requiredFactoryIntervals: [],
      syncStore: createSyncStore() as unknown as SyncStore,
    }),
  );

  expect(rpc.request).not.toHaveBeenCalled();
  expect(results).toStrictEqual([
    {
      filters: [filter],
      factories: [],
      interval: [[1, 2]],
      block: undefined,
    },
  ]);
});

test("query requests remove trailing null log topics", async () => {
  const requests = await queryRequests([
    {
      type: "log",
      address: FACTORY,
      topic0: TRANSFER,
      topic1: null,
      topic2: HASH,
      topic3: null,
    } as Filter,
  ]);

  expect(requests[0]!.params[0]).toMatchObject({
    filter: { topics: [TRANSFER, null, HASH] },
  });
});

test("query merging merges one different condition", async () => {
  const requests = await queryRequests([
    {
      type: "transaction",
      fromAddress: FACTORY,
      toAddress: CHILD,
    } as Filter,
    {
      type: "transaction",
      fromAddress: OTHER,
      toAddress: CHILD,
    } as Filter,
  ]);

  expect(requests).toHaveLength(1);
  expect(requests[0]!.params[0]).toMatchObject({
    filter: { from: [FACTORY, OTHER], to: CHILD },
  });
});

test("query merging merges a different to condition", async () => {
  const requests = await queryRequests([
    {
      type: "transaction",
      fromAddress: FACTORY,
      toAddress: CHILD,
    } as Filter,
    {
      type: "transaction",
      fromAddress: FACTORY,
      toAddress: OTHER,
    } as Filter,
  ]);

  expect(requests).toHaveLength(1);
  expect(requests[0]!.params[0]).toMatchObject({
    filter: { from: FACTORY, to: [CHILD, OTHER] },
  });
});

test("query merging preserves an unconstrained condition", async () => {
  const requests = await queryRequests([
    {
      type: "transaction",
      fromAddress: undefined,
      toAddress: CHILD,
    } as Filter,
    {
      type: "transaction",
      fromAddress: FACTORY,
      toAddress: CHILD,
    } as Filter,
  ]);

  expect(requests).toHaveLength(1);
  expect(requests[0]!.params[0]).toMatchObject({
    filter: { from: undefined, to: CHILD },
  });
});

test("query merging treats log topics as separate conditions", async () => {
  const requests = await queryRequests([
    {
      type: "log",
      address: FACTORY,
      topic0: TRANSFER,
      topic1: null,
      topic2: null,
      topic3: null,
    } as Filter,
    {
      type: "log",
      address: FACTORY,
      topic0: HASH,
      topic1: null,
      topic2: null,
      topic3: null,
    } as Filter,
  ]);

  expect(requests).toHaveLength(1);
  expect(requests[0]!.params[0]).toMatchObject({
    filter: { address: FACTORY, topics: [[TRANSFER, HASH]] },
  });
});

test("query merging merges a different log address", async () => {
  const requests = await queryRequests([
    {
      type: "log",
      address: FACTORY,
      topic0: TRANSFER,
      topic1: null,
      topic2: null,
      topic3: null,
    } as Filter,
    {
      type: "log",
      address: OTHER,
      topic0: TRANSFER,
      topic1: null,
      topic2: null,
      topic3: null,
    } as Filter,
  ]);

  expect(requests).toHaveLength(1);
  expect(requests[0]!.params[0]).toMatchObject({
    filter: { address: [FACTORY, OTHER], topics: [TRANSFER] },
  });
});

test("query merging resolves factory address metadata", async () => {
  const factory = {
    id: "factory",
    type: "log",
    chainId: 1,
    sourceId: "Factory",
    address: FACTORY,
    eventSelector: TRANSFER,
    childAddressLocation: "topic1",
    fromBlock: 1,
    toBlock: 1,
  } as const satisfies Factory;
  const requests = await queryRequests(
    [
      {
        type: "log",
        address: factory,
        topic0: TRANSFER,
        topic1: null,
        topic2: null,
        topic3: null,
      } as unknown as Filter,
      {
        type: "log",
        address: OTHER,
        topic0: TRANSFER,
        topic1: null,
        topic2: null,
        topic3: null,
      } as Filter,
    ],
    new Map([[factory.id, new Map([[CHILD, 1]])]]),
  );

  // Note: factory child addresses are resolved for each page of a request, so
  // filters with a factory address are not merged with other filters.
  expect(requests).toHaveLength(2);
  expect(
    requests.map(
      ({ params }) =>
        (params[0] as { filter: { address: `0x${string}` | `0x${string}`[] } })
          .filter.address,
    ),
  ).toEqual(expect.arrayContaining([[CHILD], OTHER]));
});

test("query merging merges one different trace condition", async () => {
  const requests = await queryRequests([
    {
      type: "trace",
      fromAddress: FACTORY,
      toAddress: CHILD,
      functionSelector: "0x12345678",
    } as unknown as Filter,
    {
      type: "trace",
      fromAddress: OTHER,
      toAddress: CHILD,
      functionSelector: "0x12345678",
    } as unknown as Filter,
  ]);

  expect(requests).toHaveLength(1);
  expect(requests[0]!.params[0]).toMatchObject({
    filter: {
      from: [FACTORY, OTHER],
      to: CHILD,
      selector: "0x12345678",
    },
  });
});

test("query merging merges one different transfer condition", async () => {
  const requests = await queryRequests([
    {
      type: "transfer",
      fromAddress: FACTORY,
      toAddress: CHILD,
    } as Filter,
    {
      type: "transfer",
      fromAddress: FACTORY,
      toAddress: OTHER,
    } as Filter,
  ]);

  expect(requests).toHaveLength(1);
  expect(requests[0]!.params[0]).toMatchObject({
    filter: { from: FACTORY, to: [CHILD, OTHER] },
  });
});

test("query merging does not merge two different conditions", async () => {
  const requests = await queryRequests([
    {
      type: "transaction",
      fromAddress: FACTORY,
      toAddress: CHILD,
    } as Filter,
    {
      type: "transaction",
      fromAddress: OTHER,
      toAddress: OTHER,
    } as Filter,
  ]);

  expect(requests).toHaveLength(2);
});

test("query merging does not merge blocks", async () => {
  const requests = await queryRequests([
    { type: "block" } as Filter,
    { type: "block" } as Filter,
  ]);

  expect(requests).toHaveLength(2);
});

test("filters and persists raw query responses", async () => {
  const fullBlock = {
    ...block,
    timestamp: "0x1",
    logsBloom: LOGS_BLOOM,
  };
  const transaction = {
    hash: HASH,
    transactionHash: HASH,
    transactionIndex: "0x0",
    blockNumber: "0x1",
    blockHash: HASH,
    from: FACTORY,
    to: CHILD,
    status: "0x1",
    type: "0x2",
  };
  const matchingLog = {
    address: FACTORY,
    blockHash: HASH,
    blockNumber: "0x1",
    data: "0x",
    logIndex: "0x0",
    topics: [TRANSFER],
    transactionHash: HASH,
    transactionIndex: "0x0",
  };
  const nonMatchingLog = {
    ...matchingLog,
    address: OTHER,
    logIndex: "0x1",
  };
  const trace = {
    blockHash: HASH,
    blockNumber: "0x1",
    transactionHash: HASH,
    transactionIndex: "0x0",
    traceAddress: [],
    subcalls: "0x0",
    status: "0x0",
    type: "CALL",
    from: FACTORY,
    to: CHILD,
    input: "0x12345678",
    value: "0x0",
  };
  const transfer = {
    blockHash: HASH,
    blockNumber: "0x1",
    transactionHash: HASH,
    transactionIndex: "0x0",
    traceAddress: [0],
    status: "0x0",
    from: FACTORY,
    to: CHILD,
    value: "0x1",
  };
  const envelope = {
    fromBlock: block,
    toBlock: block,
    cursorBlock: block,
  };
  const rpc = {
    request: vi.fn(async ({ method }: { method: string }) => {
      switch (method) {
        case "eth_queryBlocks":
          return { ...envelope, data: { blocks: [fullBlock] } };
        case "eth_queryTransactions":
          return {
            ...envelope,
            data: { blocks: [fullBlock], transactions: [transaction] },
          };
        case "eth_queryLogs":
          return {
            ...envelope,
            data: {
              blocks: [fullBlock],
              transactions: [transaction],
              logs: [matchingLog, nonMatchingLog],
            },
          };
        case "eth_queryTraces":
          return {
            ...envelope,
            data: {
              blocks: [fullBlock],
              transactions: [transaction],
              traces: [trace],
            },
          };
        case "eth_queryTransfers":
          return {
            ...envelope,
            data: {
              blocks: [fullBlock],
              transactions: [transaction],
              transfers: [transfer],
            },
          };
        default:
          throw new Error(`Unexpected method ${method}`);
      }
    }),
  } as unknown as Rpc;
  const syncStore = createSyncStore();
  const logger = { debug: vi.fn(), child: () => ({}) };
  const historicalSync = createQueryHistoricalSync({
    common: { logger } as unknown as Common,
    chain: { id: 1, name: "mainnet" } as never,
    rpc,
    childAddresses: new Map(),
  });
  const filters = [
    { type: "block", interval: 1, offset: 0 },
    {
      type: "transaction",
      fromAddress: FACTORY,
      toAddress: CHILD,
    },
    {
      type: "log",
      address: FACTORY,
      topic0: TRANSFER,
      topic1: null,
      topic2: null,
      topic3: null,
    },
    {
      type: "trace",
      fromAddress: FACTORY,
      toAddress: CHILD,
      functionSelector: "0x12345678",
    },
    {
      type: "transfer",
      fromAddress: FACTORY,
      toAddress: CHILD,
    },
  ] as unknown as Filter[];

  const results = await drainAsyncGenerator(
    historicalSync.syncQueryBlockData({
      requiredIntervals: filters.map((filter) => ({
        filter,
        interval: [1, 1],
      })),
      requiredFactoryIntervals: [],
      syncStore: syncStore as unknown as SyncStore,
    }),
  );
  const tip = results.findLast(({ block }) => block !== undefined)?.block;

  expect(tip?.number).toBe("0x1");
  expect(syncStore.insertBlocks).toHaveBeenCalledTimes(5);
  expect(syncStore.insertTransactions).toHaveBeenCalledTimes(4);
  expect(syncStore.insertTransactionReceipts).toHaveBeenCalledTimes(4);
  expect(syncStore.insertLogs).toHaveBeenCalledTimes(1);
  expect(syncStore.insertTraces).toHaveBeenCalledTimes(2);
  expect(syncStore.insertBlocks).toHaveBeenCalledWith(
    {
      blocks: [
        expect.objectContaining({
          number: "0x1",
          transactions: undefined,
        }),
      ],
      chainId: 1,
    },
    expect.any(Object),
  );
  expect(syncStore.insertTransactions).toHaveBeenCalledWith(
    {
      transactions: [expect.objectContaining({ hash: HASH, type: "0x2" })],
      chainId: 1,
    },
    expect.any(Object),
  );
  expect(syncStore.insertTransactionReceipts).toHaveBeenCalledWith(
    {
      transactionReceipts: [
        expect.objectContaining({
          transactionHash: HASH,
          status: "0x1",
          type: "0x2",
        }),
      ],
      chainId: 1,
    },
    expect.any(Object),
  );
  expect(syncStore.insertLogs).toHaveBeenCalledWith(
    { logs: [expect.objectContaining({ address: FACTORY })], chainId: 1 },
    expect.any(Object),
  );
  expect(syncStore.insertTraces).toHaveBeenNthCalledWith(
    1,
    {
      traces: [
        expect.objectContaining({
          trace: expect.objectContaining({
            transactionHash: HASH,
            trace: expect.objectContaining({
              error: "execution reverted",
              input: "0x12345678",
              subcalls: 0,
            }),
          }),
          block: expect.objectContaining({ number: "0x1" }),
          transaction: expect.objectContaining({ hash: HASH }),
        }),
      ],
      chainId: 1,
    },
    expect.any(Object),
  );
  expect(syncStore.insertTraces).toHaveBeenNthCalledWith(
    2,
    {
      traces: [
        expect.objectContaining({
          trace: expect.objectContaining({
            transactionHash: HASH,
            trace: expect.objectContaining({
              error: "execution reverted",
              input: "0x",
              subcalls: 0,
            }),
          }),
          block: expect.objectContaining({ number: "0x1" }),
          transaction: expect.objectContaining({ hash: HASH }),
        }),
      ],
      chainId: 1,
    },
    expect.any(Object),
  );
  expect(logger.debug).toHaveBeenCalledWith(
    expect.objectContaining({
      msg: "Fetched block data",
      chain: "mainnet",
      chain_id: 1,
      data_type: "transaction",
      block_range: "[1,1]",
      block_count: expect.any(Number),
      transaction_count: expect.any(Number),
      receipt_count: expect.any(Number),
      duration: expect.any(Number),
    }),
    ["chain", "data_type", "block_range"],
  );
  expect(logger.debug).toHaveBeenCalledWith(
    expect.objectContaining({ data_type: "log", log_count: 1 }),
    ["chain", "data_type", "block_range"],
  );
  expect(logger.debug).toHaveBeenCalledWith(
    expect.objectContaining({ data_type: "trace", trace_count: 1 }),
    ["chain", "data_type", "block_range"],
  );
  expect(logger.debug).toHaveBeenCalledWith(
    expect.objectContaining({
      data_type: "transfer",
      transfer_count: 1,
    }),
    ["chain", "data_type", "block_range"],
  );
});

test("prefetches the next query page while processing the current page", async () => {
  const firstBlock = {
    ...block,
    number: "0x1" as const,
    timestamp: "0x1" as const,
    logsBloom: LOGS_BLOOM,
  };
  const secondBlock = {
    ...block,
    number: "0x2" as const,
    timestamp: "0x2" as const,
    logsBloom: LOGS_BLOOM,
  };
  const requests: { method: string; params: unknown[] }[] = [];
  let requestCount = 0;

  const rpc = {
    request: vi.fn(async (request: { method: string; params: unknown[] }) => {
      requests.push(request);
      const cursorBlock = requestCount++ === 0 ? firstBlock : secondBlock;
      return {
        fromBlock: firstBlock,
        toBlock: secondBlock,
        cursorBlock,
        data: { blocks: [cursorBlock] },
      };
    }),
  } as unknown as Rpc;

  let resolveFirstPage!: () => void;
  const firstPage = new Promise<void>((resolve) => {
    resolveFirstPage = resolve;
  });
  let firstPageProcessing!: () => void;
  const processingStarted = new Promise<void>((resolve) => {
    firstPageProcessing = resolve;
  });
  const syncStore = {
    ...createSyncStore(),
    insertBlocks: vi.fn(
      async ({ blocks }: { blocks: { number: string }[] }) => {
        if (blocks.some(({ number }) => number === "0x1")) {
          firstPageProcessing();
          await firstPage;
        }
      },
    ),
  };
  const logger = { debug: vi.fn(), child: () => ({}) };
  const historicalSync = createQueryHistoricalSync({
    common: { logger } as unknown as Common,
    chain: { id: 1 } as never,
    rpc,
    childAddresses: new Map(),
  });

  const generator = historicalSync.syncQueryBlockData({
    requiredIntervals: [
      {
        filter: { type: "block", interval: 1, offset: 0 } as Filter,
        interval: [1, 2],
      },
    ],
    requiredFactoryIntervals: [],
    syncStore: syncStore as unknown as SyncStore,
  });
  const firstResult = generator.next();

  await processingStarted;
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({
    method: "eth_queryBlocks",
    params: [{ fromBlock: "0x2", toBlock: "0x2" }],
  });

  resolveFirstPage();
  expect((await firstResult).done).toBe(false);
  expect((await generator.next()).done).toBe(false);
  expect((await generator.next()).done).toBe(true);
});
