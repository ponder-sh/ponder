import { context, setupAnvil, setupCommon } from "@/_test/setup.js";
import { simulateBlock } from "@/_test/simulate.js";
import { getChain } from "@/_test/utils.js";
import type { SyncBlock } from "@/internal/types.js";
import { wait } from "@/utils/wait.js";
import { beforeEach, expect, test, vi } from "vitest";
import { createRpc } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

test("createRpc()", async () => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  await rpc.request({ method: "eth_blockNumber" });
});

test("createRpc() handles rate limiting", async () => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ message: "Too Many Requests" }), {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "Content-Type": "application/json" },
    }),
  );

  await rpc.request({ method: "eth_blockNumber" });
});

test("createRpc() retry BlockNotFoundError", async () => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  await simulateBlock();

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ jsonrpc: "2.0", result: null, id: 1 })),
  );

  const block = await rpc.request(
    { method: "eth_getBlockByNumber", params: ["0x1", true] },
    {
      retryNullBlockRequest: true,
    },
  );

  expect(block).not.toBeNull();
});

test("https://github.com/ponder-sh/ponder/pull/2143", async () => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 20; j++) {
      await rpc.request({ method: "eth_blockNumber" });
    }
    await wait(1000);
  }

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ message: "Too Many Requests" }), {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "Content-Type": "application/json" },
    }),
  );

  await rpc.request({ method: "eth_blockNumber" });
}, 15_000);

test("subscribe() polls with 'latest' block tag by default", async () => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  await simulateBlock();

  const requestSpy = vi.spyOn(rpc, "request");

  const blockPromise = new Promise<SyncBlock>((resolve) => {
    rpc.subscribe({
      onBlock: async (block) => {
        resolve(block as SyncBlock);
        return true;
      },
      onError: () => {},
    });
  });

  const block = await blockPromise;
  await rpc.unsubscribe();

  expect(block).toBeDefined();
  expect(block.number).toBeDefined();

  // Verify the polling request used "latest"
  const getBlockCalls = requestSpy.mock.calls.filter(
    ([params]) =>
      params.method === "eth_getBlockByNumber" &&
      params.params?.[0] === "latest",
  );
  expect(getBlockCalls.length).toBeGreaterThan(0);
});

test("subscribe() polls with 'pending' block tag when readPending is true", async () => {
  const chain = getChain({ readPending: true });
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  await simulateBlock();

  const requestSpy = vi.spyOn(rpc, "request");

  const blockPromise = new Promise<SyncBlock>((resolve) => {
    rpc.subscribe({
      onBlock: async (block) => {
        resolve(block as SyncBlock);
        return true;
      },
      onError: () => {},
    });
  });

  const block = await blockPromise;
  await rpc.unsubscribe();

  expect(block).toBeDefined();
  expect(block.number).toBeDefined();

  // Verify the polling request used "pending"
  const getBlockCalls = requestSpy.mock.calls.filter(
    ([params]) =>
      params.method === "eth_getBlockByNumber" &&
      params.params?.[0] === "pending",
  );
  expect(getBlockCalls.length).toBeGreaterThan(0);

  // Verify no "latest" calls were made for polling
  const latestCalls = requestSpy.mock.calls.filter(
    ([params]) =>
      params.method === "eth_getBlockByNumber" &&
      params.params?.[0] === "latest",
  );
  expect(latestCalls.length).toBe(0);
});

test("subscribe() polls with 'latest' when readPending is false", async () => {
  const chain = getChain({ readPending: false });
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  await simulateBlock();

  const requestSpy = vi.spyOn(rpc, "request");

  const blockPromise = new Promise<SyncBlock>((resolve) => {
    rpc.subscribe({
      onBlock: async (block) => {
        resolve(block as SyncBlock);
        return true;
      },
      onError: () => {},
    });
  });

  const block = await blockPromise;
  await rpc.unsubscribe();

  expect(block).toBeDefined();

  // Verify the polling request used "latest"
  const getBlockCalls = requestSpy.mock.calls.filter(
    ([params]) =>
      params.method === "eth_getBlockByNumber" &&
      params.params?.[0] === "latest",
  );
  expect(getBlockCalls.length).toBeGreaterThan(0);
});
