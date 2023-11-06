import { beforeEach, expect, test } from "vitest";

import { usdcContractConfig } from "@/_test/constants";
import { setupEventStore } from "@/_test/setup";
import { publicClient } from "@/_test/utils";

import { buildReadContract } from "./readContract";

beforeEach((context) => setupEventStore(context));

const usdcTotalSupply16375000 = 40921687992499550n;

test("read contract", async ({ eventStore }) => {
  const readContract = buildReadContract({
    getCurrentBlockNumber: () => 16375000n,
    eventStore,
  });

  const totalSupply = await readContract(publicClient, {
    abi: usdcContractConfig.abi,
    functionName: "totalSupply",
    address: usdcContractConfig.address,
  });

  expect(totalSupply).toBe(usdcTotalSupply16375000);
});

test("read contract with cache hit", async ({ eventStore }) => {
  const readContract = buildReadContract({
    getCurrentBlockNumber: () => 16375000n,
    eventStore,
  });

  let totalSupply = await readContract(publicClient, {
    abi: usdcContractConfig.abi,
    functionName: "totalSupply",
    address: usdcContractConfig.address,
  });

  expect(totalSupply).toBe(usdcTotalSupply16375000);

  totalSupply = await readContract(publicClient, {
    abi: usdcContractConfig.abi,
    functionName: "totalSupply",
    address: usdcContractConfig.address,
  });

  expect(totalSupply).toBe(usdcTotalSupply16375000);
});
