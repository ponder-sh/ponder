import { expect, test, vi } from "vitest";
import type { Common } from "@/internal/common.js";
import type { Filter } from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import type { SyncStore } from "@/sync-store/index.js";
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
  insertBlocks: vi.fn(async () => {}),
  insertTransactions: vi.fn(async () => {}),
  insertTransactionReceipts: vi.fn(async () => {}),
  insertLogs: vi.fn(async () => {}),
  insertTraces: vi.fn(async () => {}),
});

const queryRequests = async (filters: Filter[]) => {
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
  const logger = { child: () => ({}) };
  const historicalSync = createQueryHistoricalSync({
    common: { logger } as unknown as Common,
    chain: { id: 1 } as never,
    rpc,
    childAddresses: new Map(),
  });

  await historicalSync.syncIntervalBlockData({
    interval: [1, 1],
    requiredIntervals: filters.map((filter) => ({ filter, interval: [1, 1] })),
    requiredFactoryIntervals: [],
    syncStore: createSyncStore() as unknown as SyncStore,
  });

  return requests;
};

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
  const historicalSync = createQueryHistoricalSync({
    common: { logger: { child: () => ({}) } } as unknown as Common,
    chain: { id: 1 } as never,
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

  const tip = await historicalSync.syncIntervalBlockData({
    interval: [1, 1],
    requiredIntervals: filters.map((filter) => ({
      filter,
      interval: [1, 1],
    })),
    requiredFactoryIntervals: [],
    syncStore: syncStore as unknown as SyncStore,
  });

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
});
