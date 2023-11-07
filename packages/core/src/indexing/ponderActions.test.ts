import { keccak256, toHex } from "viem/utils";
import { expect, test } from "vitest";

import {
  uniswapV3PoolFactoryConfig,
  usdcContractConfig,
} from "@/_test/constants";
import { publicClient } from "@/_test/utils";

import { ponderActions } from "./ponderActions";

const client = publicClient.extend(ponderActions(() => 16375000n));

const usdcTotalSupply16375000 = 40921687992499550n;

test("getBalance()", async () => {
  const balance = await client.getBalance({
    address: "0xA0Cf798816D4b9b9866b5330EEa46a18382f251e",
  });

  expect(balance).toBe(398806329552690329n);
});

test("getBytecode()", async () => {
  const bytecode = await client.getBytecode({
    address: usdcContractConfig.address,
  });

  expect(bytecode).toBeTruthy();
  expect(keccak256(bytecode!)).toBe(
    "0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505"
  );
});

test("getStorageAt()", async () => {
  const storage = await client.getStorageAt({
    address: uniswapV3PoolFactoryConfig.criteria.address,
    slot: toHex(3),
  });

  expect(storage).toBe(
    "0x0000000000000000000000001a9c8182c09f50c8318d769245bea52c32be35bc"
  );
});

test("multicall()", async () => {
  const totalSupply = await client.multicall({
    allowFailure: false,
    contracts: [
      {
        abi: usdcContractConfig.abi,
        functionName: "totalSupply",
        address: usdcContractConfig.address,
      },
    ],
  });

  expect(totalSupply).toMatchObject([usdcTotalSupply16375000]);
});

test("readContract()", async () => {
  const totalSupply = await client.readContract({
    abi: usdcContractConfig.abi,
    functionName: "totalSupply",
    address: usdcContractConfig.address,
  });

  expect(totalSupply).toBe(usdcTotalSupply16375000);
});
