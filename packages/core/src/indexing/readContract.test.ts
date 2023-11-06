import { expect, test } from "vitest";

import { usdcContractConfig } from "@/_test/constants";
import { publicClient } from "@/_test/utils";

import { buildReadContract } from "./readContract";

test("read contract", async () => {
  const readContract = buildReadContract({
    getCurrentBlockNumber: () => 16375000n,
  });

  const totalSupply = await readContract(publicClient, {
    abi: usdcContractConfig.abi,
    functionName: "totalSupply",
    address: usdcContractConfig.address,
  });

  expect(totalSupply).toBe(40921687992499550n);
});

test.todo("read contract with cache hit");
