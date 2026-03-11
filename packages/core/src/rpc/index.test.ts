import { context, setupAnvil, setupCommon } from "@/_test/setup.js";
import { simulateBlock } from "@/_test/simulate.js";
import { getChain } from "@/_test/utils.js";
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

test("createRpc() does not retry null round error (code 12)", async () => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  const fetchSpy = vi.spyOn(globalThis, "fetch");

  fetchSpy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: 12, message: "requested epoch was a null round" },
        id: 1,
      }),
    ),
  );

  await expect(
    rpc.request({ method: "eth_getBlockByNumber", params: ["0x100", true] }),
  ).rejects.toThrow();

  // Should only have been called once (no retries for null rounds)
  expect(fetchSpy).toHaveBeenCalledTimes(1);
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
