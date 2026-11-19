import { hexToNumber, numberToHex } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import {
  context,
  setupAnvil,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { getBlocksIndexingBuild, getChain, testClient } from "@/_test/utils.js";
import { eth_getBlockByNumber } from "@/rpc/actions.js";
import { createRpc } from "@/rpc/index.js";
import { createSyncStore } from "@/sync-store/index.js";
import { getFragments } from "./fragments.js";
import { type CachedIntervals, getLocalSyncProgress } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

async function setupProgress(start: number, end?: number) {
  const { database, syncStore } = await setupDatabaseServices();
  const chain = getChain();
  const rpc = createRpc({ chain, common: context.common });
  const genesisSnapshot = await testClient.snapshot();
  await testClient.mine({ blocks: 3 });
  const blocks = await Promise.all(
    [0, 1, 2, 3].map((number) =>
      eth_getBlockByNumber(rpc, [numberToHex(number), false]),
    ),
  );
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  const filters = eventCallbacks.map(({ filter }) => filter);
  const cachedIntervals: CachedIntervals = new Map();
  for (const filter of filters) {
    filter.fromBlock = start;
    filter.toBlock = end;
    cachedIntervals.set(
      filter,
      getFragments(filter).map(({ fragment }) => ({ fragment, intervals: [] })),
    );
  }
  return {
    database,
    blocks,
    genesisSnapshot,
    params: {
      common: context.common,
      chain,
      rpc,
      syncStore,
      filters,
      cachedIntervals,
      finalizedBlock: blocks[3]!,
    },
  };
}

test.each([
  { start: 0, end: undefined },
  { start: 1, end: undefined },
  { start: 0, end: 1 },
  { start: 1, end: 1 },
])(
  "startup reuses finalized diagnostics after pruning (start $start, end $end)",
  async ({ start, end }) => {
    const { database, blocks, params } = await setupProgress(start, end);
    const first = await getLocalSyncProgress(params);
    const request = params.rpc.request.bind(params.rpc);
    const requestSpy = vi
      .spyOn(params.rpc, "request")
      .mockImplementation((body, options) => {
        if (
          body.method === "eth_getBlockByNumber" &&
          hexToNumber(body.params[0] as `0x${string}`) < 2
        ) {
          throw new Error("Requested block was pruned");
        }
        return request(body, options);
      });
    // A new store and progress object must recover from persisted data, not memory.
    params.syncStore = createSyncStore({
      common: context.common,
      qb: database.syncQB,
    });
    for (const fragments of params.cachedIntervals.values()) {
      for (const fragment of fragments)
        fragment.intervals = [[start, end ?? 2]];
    }
    const recovered = await getLocalSyncProgress(params);
    expect(recovered.start).toEqual(first.start);
    expect(recovered.getCheckpoint({ tag: "start" })).toBe(
      first.getCheckpoint({ tag: "start" }),
    );
    expect(recovered.end).toEqual(end === undefined ? undefined : blocks[end]);
    expect(recovered.current).toEqual(blocks[end ?? 2]);
    expect(
      requestSpy.mock.calls.every(
        ([body]) =>
          body.method !== "eth_getBlockByNumber" ||
          hexToNumber(body.params[0] as `0x${string}`) >= 2,
      ),
    ).toBe(true);
  },
);

test("startup persists a finalized block on cache miss", async () => {
  const { blocks, params } = await setupProgress(1);
  const progress = await getLocalSyncProgress(params);
  const [cached] = await params.syncStore.getRpcRequestResults({
    requests: [{ method: "eth_getBlockByNumber", params: ["0x1", false] }],
    chainId: params.chain.id,
    cacheNamespace: "sync_progress:",
  });
  expect(progress.start).toEqual(blocks[1]);
  expect(cached === undefined ? undefined : JSON.parse(cached)).toEqual({
    ...blocks[1],
    transactions: [],
  });
});

test("startup does not cache an invalid block response", async () => {
  const { blocks, params } = await setupProgress(1);
  // A malformed wire response deliberately falls outside the typed RPC schema.
  vi.spyOn(params.rpc, "request").mockResolvedValue(
    JSON.parse(JSON.stringify({ ...blocks[1], hash: undefined })),
  );
  await expect(getLocalSyncProgress(params)).rejects.toThrow(
    "'block.hash' is a required property",
  );
  expect(
    await params.syncStore.getRpcRequestResults({
      requests: [{ method: "eth_getBlockByNumber", params: ["0x1", false] }],
      chainId: params.chain.id,
      cacheNamespace: "sync_progress:",
    }),
  ).toEqual([undefined]);
});

test("startup bypasses existing cached headers when RPC caching is disabled", async () => {
  const { blocks, params } = await setupProgress(1);
  await params.syncStore.insertRpcRequestResults({
    requests: [
      {
        request: { method: "eth_getBlockByNumber", params: ["0x1", false] },
        blockNumber: 1,
        result: JSON.stringify(blocks[1]),
      },
    ],
    chainId: params.chain.id,
    cacheNamespace: "sync_progress:",
  });
  params.chain.cacheRpcRequests = false;
  const cacheSpy = vi.spyOn(params.syncStore, "getRpcRequestResults");
  vi.spyOn(params.rpc, "request").mockRejectedValue(
    new Error("Requested block was pruned"),
  );
  await expect(getLocalSyncProgress(params)).rejects.toThrow(
    "Requested block was pruned",
  );
  expect(cacheSpy).not.toHaveBeenCalled();
});

test("startup refetches unfinalized headers after a reorg", async () => {
  const { blocks, genesisSnapshot, params } = await setupProgress(1);
  params.finalizedBlock = blocks[0]!;
  const first = await getLocalSyncProgress(params);
  await testClient.revert({ id: genesisSnapshot });
  await testClient.setNextBlockTimestamp({
    timestamp: BigInt(first.start.timestamp) + 100n,
  });
  await testClient.mine({ blocks: 3 });
  const recovered = await getLocalSyncProgress(params);
  expect(recovered.start.hash).not.toBe(first.start.hash);
  expect(recovered.start.timestamp).not.toBe(first.start.timestamp);
  expect(
    await params.syncStore.getRpcRequestResults({
      requests: [{ method: "eth_getBlockByNumber", params: ["0x1", false] }],
      chainId: params.chain.id,
      cacheNamespace: "sync_progress:",
    }),
  ).toEqual([undefined]);
});

test("startup does not reuse an ordinary RPC cache entry from before a reorg", async () => {
  const { blocks, params } = await setupProgress(1);
  const stale = {
    ...blocks[1],
    hash: `0x${"11".repeat(32)}`,
    transactions: [],
  };
  await params.syncStore.insertRpcRequestResults({
    requests: [
      {
        request: { method: "eth_getBlockByNumber", params: ["0x1", false] },
        blockNumber: 1,
        result: JSON.stringify(stale),
      },
    ],
    chainId: params.chain.id,
  });
  const requestSpy = vi.spyOn(params.rpc, "request");
  const progress = await getLocalSyncProgress(params);
  expect(progress.start).toEqual(blocks[1]);
  expect(requestSpy).toHaveBeenCalled();
  expect(
    await params.syncStore.getRpcRequestResults({
      requests: [{ method: "eth_getBlockByNumber", params: ["0x1", false] }],
      chainId: params.chain.id,
    }),
  ).toEqual([JSON.stringify(stale)]);
});

test("startup diagnostic cache is scoped by chain ID", async () => {
  const { params } = await setupProgress(1);
  await getLocalSyncProgress(params);
  params.chain = { ...params.chain, id: 2 };
  const requestSpy = vi.spyOn(params.rpc, "request");
  const progress = await getLocalSyncProgress(params);
  expect(requestSpy).toHaveBeenCalled();
  const [cached] = await params.syncStore.getRpcRequestResults({
    requests: [{ method: "eth_getBlockByNumber", params: ["0x1", false] }],
    chainId: 2,
    cacheNamespace: "sync_progress:",
  });
  expect(cached === undefined ? undefined : JSON.parse(cached)).toEqual({
    ...progress.start,
    transactions: [],
  });
});
