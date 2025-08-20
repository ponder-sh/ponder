// import { randomUUID } from "node:crypto";
// import { mkdirSync, readdirSync } from "node:fs";
// import os from "node:os";
// import path from "node:path";
// import { run } from "@/index.js";
// import { rimrafSync } from "rimraf";
import { expect, test } from "vitest";
import { PUBLIC_ETHERSCAN_API_KEY, getEtherscanApiUrl } from "./etherscan.js";

test("getEtherscanApiUrl handles etherscan.io", async () => {
  const url = await getEtherscanApiUrl(
    "etherscan.io",
    PUBLIC_ETHERSCAN_API_KEY,
  );
  expect(url.toString()).toBe("https://api.etherscan.io/v2/api?chainid=1");
});

test("getEtherscanApiUrl handles basescan.org", async () => {
  const url = await getEtherscanApiUrl(
    "basescan.org",
    PUBLIC_ETHERSCAN_API_KEY,
  );
  expect(url.toString()).toBe("https://api.etherscan.io/v2/api?chainid=8453");
});

test("getEtherscanApiUrl handles a chain not found in viem/chains", async () => {
  const url = await getEtherscanApiUrl(
    "explorer.redstone.xyz",
    PUBLIC_ETHERSCAN_API_KEY,
  );
  expect(url.toString()).toBe("https://api.blockscout.com/api?chainid=1");
});

// TODO: More chains and explorers
