import { parseEther, toHex } from "viem/utils";
import { beforeEach, expect, test } from "vitest";

import { BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import { setupAnvil } from "@/_test/setup.js";
import { publicClient } from "@/_test/utils.js";

import { type ReadOnlyClient, ponderActions } from "./ponderActions.js";

beforeEach((context) => setupAnvil(context));

const getClient = async () => {
  const blockNumber = await publicClient.getBlockNumber();
  return publicClient.extend(
    ponderActions(blockNumber) as any,
  ) as ReadOnlyClient;
};

test("getBalance()", async () => {
  const balance = await getClient().then((client) =>
    client.getBalance({
      address: BOB,
    }),
  );

  expect(balance).toBe(parseEther("10000"));
});

test("getBytecode()", async (context) => {
  const bytecode = await getClient().then((client) =>
    client.getBytecode({
      address: context.erc20.address,
    }),
  );

  expect(bytecode).toBeTruthy();
});

test("getStorageAt()", async (context) => {
  const storage = await getClient().then((client) =>
    client.getStorageAt({
      address: context.erc20.address,
      // totalSupply is in the third storage slot
      slot: toHex(2),
    }),
  );

  expect(BigInt(storage!)).toBe(parseEther("1"));
});

// Note: Kyle the local chain doesn't have a deployed instance of "multicall3"
test.todo("multicall()", async (context) => {
  const totalSupply = await getClient().then((client) =>
    client.multicall({
      allowFailure: false,
      contracts: [
        {
          abi: erc20ABI,
          functionName: "totalSupply",
          address: context.erc20.address,
        },
      ],
    }),
  );

  expect(totalSupply).toMatchObject([parseEther("1")]);
});

test("readContract()", async (context) => {
  const totalSupply = await getClient().then((client) =>
    client.readContract({
      abi: erc20ABI,
      functionName: "totalSupply",
      address: context.erc20.address,
    }),
  );

  expect(totalSupply).toBe(parseEther("1"));
});
