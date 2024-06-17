import { http, fallback, webSocket } from "viem";
import { mainnet } from "viem/chains";
import { expect, test } from "vitest";

import {
  getDefaultMaxBlockRange,
  getRpcUrlsForClient,
  isRpcUrlPublic,
} from "./networks.js";

test("getRpcUrlsForClient handles default RPC URL", async () => {
  const rpcUrls = await getRpcUrlsForClient({
    transport: http(),
    chain: mainnet,
  });

  expect(rpcUrls).toMatchObject(["https://cloudflare-eth.com"]);
});

test("getRpcUrlsForClient should handle an http transport", async () => {
  const rpcUrls = await getRpcUrlsForClient({
    transport: http("http://localhost:8545"),
    chain: mainnet,
  });

  expect(rpcUrls).toMatchObject(["http://localhost:8545"]);
});

test("getRpcUrlsForClient should handle a websocket transport", async () => {
  const rpcUrls = await getRpcUrlsForClient({
    transport: webSocket("wss://localhost:8545"),
    chain: mainnet,
  });

  expect(rpcUrls).toMatchObject(["wss://localhost:8545"]);
});

test("getRpcUrlsForClient should handle a fallback containing an http transport", async () => {
  const rpcUrls = await getRpcUrlsForClient({
    transport: fallback([http("http://localhost:8545")]),
    chain: mainnet,
  });

  expect(rpcUrls).toMatchObject(["http://localhost:8545"]);
});

test("getDefaultMaxBlockRange should return 2_000 for mainnet", () => {
  const maxBlockRange = getDefaultMaxBlockRange({
    chainId: 1,
    rpcUrls: ["https://eth-mainnet.g.alchemy.com/v2/abc"],
  });

  expect(maxBlockRange).toBe(2_000);
});

test("getDefaultMaxBlockRange should return 50_000 for optimism", () => {
  const maxBlockRange = getDefaultMaxBlockRange({
    chainId: 10,
    rpcUrls: ["https://eth-optimism.g.alchemy.com/v2/abc"],
  });

  expect(maxBlockRange).toBe(50_000);
});

test("getDefaultMaxBlockRange should override quicknode RPC URLs to 10_000", () => {
  const maxBlockRange = getDefaultMaxBlockRange({
    chainId: 10,
    rpcUrls: ["https://blah.quiknode.pro/abc"],
  });

  expect(maxBlockRange).toBe(10_000);
});

test("getDefaultMaxBlockRange should use lesser value even if overriden", () => {
  const maxBlockRange = getDefaultMaxBlockRange({
    chainId: 1,
    rpcUrls: ["https://blah.quiknode.pro/abc"],
  });

  expect(maxBlockRange).toBe(2_000);
});

test("getDefaultMaxBlockRange should return 50_000 for unknown chain ID", () => {
  const maxBlockRange = getDefaultMaxBlockRange({
    chainId: 1234,
    rpcUrls: [],
  });

  expect(maxBlockRange).toBe(50_000);
});

test("isPublicRpcUrl returns true for undefined RPC URL", () => {
  const isPublic = isRpcUrlPublic(undefined);

  expect(isPublic).toBe(true);
});

test("isPublicRpcUrl returns true for Cloudflare public RPC URL", () => {
  const isPublic = isRpcUrlPublic("https://cloudflare-eth.com");

  expect(isPublic).toBe(true);
});

test("isPublicRpcUrl returns false for Alchemy RPC URL", () => {
  const isPublic = isRpcUrlPublic("https://eth-mainnet.g.alchemy.com/v2/abc");

  expect(isPublic).toBe(false);
});
