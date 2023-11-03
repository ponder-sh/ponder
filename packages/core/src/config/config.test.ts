import { http } from "viem";
import { test } from "vitest";

import { createConfig } from "./config";
import { abiSimple } from "./config.test-d";

test("createConfig enforces matching network names", () => {
  createConfig({
    networks: [
      { name: "mainnet", chainId: 1, transport: http("http://127.0.0.1:8545") },
    ],
    contracts: [
      {
        name: "BaseRegistrarImplementation",
        network: [{ name: "mainnet" }],
        abi: [],
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    ],
  });
});

test("createConfig() has strict events inferred from abi", () => {
  createConfig({
    networks: [
      { name: "mainnet", chainId: 1, transport: http("http://127.0.0.1:8545") },
    ],
    contracts: [
      {
        name: "BaseRegistrarImplementation",
        network: [{ name: "mainnet" }],
        abi: abiSimple,
        event: ["Approve"],
        address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
        startBlock: 16370000,
        endBlock: 16370020,
        maxBlockRange: 10,
      },
    ],
  });
});
