import { createClient, http } from "viem";
import { beforeEach, expect, test } from "vitest";

import { usdcContractConfig } from "@/_test/constants";
import { setupEventStore } from "@/_test/setup";
import { anvil } from "@/_test/utils";

import { buildMulticall } from "./multicall";
import { ponderTransport } from "./transport";

beforeEach((context) => setupEventStore(context));

const usdcTotalSupply16375000 = 40921687992499550n;

test("multicall() no cache", async ({ eventStore }) => {
  const client = createClient({
    chain: anvil,
    transport: ponderTransport({ transport: http(), eventStore }),
  });

  const multicall = buildMulticall({
    getCurrentBlockNumber: () => 16375000n,
  });

  const totalSupply = await multicall(client, {
    allowFailure: false,
    contracts: [
      {
        abi: usdcContractConfig.abi,
        functionName: "totalSupply",
        address: usdcContractConfig.address,
      },
    ],
  });

  expect(totalSupply).toBe(usdcTotalSupply16375000);
});

test("multicall() with cache", async ({ eventStore }) => {
  const client = createClient({
    chain: anvil,
    transport: ponderTransport({ transport: http(), eventStore }),
  });

  const multicall = buildMulticall({
    getCurrentBlockNumber: () => 16375000n,
  });

  let totalSupply = await multicall(client, {
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

  totalSupply = await multicall(client, {
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
