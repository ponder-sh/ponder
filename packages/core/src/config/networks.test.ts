import { http, fallback, webSocket } from "viem";
import { mainnet } from "viem/chains";
import { expect, test } from "vitest";
import { getRpcUrlsForClient, isRpcUrlPublic } from "./networks.js";

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
