import { setupAnvil, setupCommon } from "@/_test/setup.js";
import { getChain } from "@/_test/utils.js";
import { wait } from "@/utils/wait.js";
import { beforeEach, test, vi } from "vitest";
import { createRpc } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

test("createRpc()", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    common: context.common,
    chain,
  });

  await rpc.request({ method: "eth_blockNumber" });
});

test("createRpc() handles rate limiting", async (context) => {
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

test("https://github.com/ponder-sh/ponder/pull/2143", async (context) => {
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
