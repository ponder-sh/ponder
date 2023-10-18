import { createPublicClient, fallback, http, webSocket } from "viem";
import { mainnet } from "viem/chains";
import { expect, test } from "vitest";

import {
  getDefaultMaxBlockRange,
  getRpcUrlsForClient,
  isRpcUrlPublic,
} from "./networks";

test("getRpcUrlsForClient handles default RPC URL", () => {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(),
  });

  const rpcUrls = getRpcUrlsForClient({ client });

  expect(rpcUrls).toMatchObject([undefined]);
});

test("getRpcUrlsForClient should handle an http transport", () => {
  const client = createPublicClient({
    transport: http("http://localhost:8545"),
  });

  const rpcUrls = getRpcUrlsForClient({ client });

  expect(rpcUrls).toMatchObject(["http://localhost:8545"]);
});

test.fails("getRpcUrlsForClient should handle a websocket transport", () => {
  const client = createPublicClient({
    transport: webSocket("wss://localhost:8545"),
  });

  const rpcUrls = getRpcUrlsForClient({ client });

  expect(rpcUrls).toMatchObject(["wss://localhost:8545"]);
});

test("getRpcUrlsForClient should handle a fallback containing an http transport", () => {
  const client = createPublicClient({
    transport: fallback([http("http://localhost:8545")]),
  });

  const rpcUrls = getRpcUrlsForClient({ client });

  expect(rpcUrls).toMatchObject(["http://localhost:8545"]);
});

test("getRpcUrlsForClient should handle a fallback containing multiple http transports", () => {
  const client = createPublicClient({
    transport: fallback([
      http("http://localhost:8545"),
      http("https://eth-mainnet.g.alchemy.com/v2/abc"),
    ]),
  });

  const rpcUrls = getRpcUrlsForClient({ client });

  expect(rpcUrls).toMatchObject([
    "http://localhost:8545",
    "https://eth-mainnet.g.alchemy.com/v2/abc",
  ]);
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
