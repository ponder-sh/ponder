import { mainnet } from "viem/chains";
import { expect, test } from "vitest";
import { isRpcUrlPublic } from "./rpcUrl.js";

test("isPublicRpcUrl returns true for Cloudflare public RPC URL", () => {
  const isPublic = isRpcUrlPublic({
    chain: mainnet,
    rpcUrl: "https://cloudflare-eth.com",
  });

  expect(isPublic).toBe(true);
});

test("isPublicRpcUrl returns false for Alchemy RPC URL", () => {
  const isPublic = isRpcUrlPublic({
    chain: mainnet,
    rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/abc",
  });

  expect(isPublic).toBe(false);
});
