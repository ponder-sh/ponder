import { createClient, http, toHex } from "viem";
import { beforeEach, expect, test, vi } from "vitest";

import { uniswapV3PoolFactoryConfig } from "@/_test/constants";
import { setupEventStore } from "@/_test/setup";
import { anvil } from "@/_test/utils";

import { buildGetStorageAt } from "./getStorageAt";
import { ponderTransport } from "./transport";

beforeEach((context) => setupEventStore(context));

test("getStorageAt() no cache", async ({ eventStore }) => {
  const client = createClient({
    chain: anvil,
    transport: ponderTransport({ transport: http(), eventStore }),
  });

  const getStorageAt = buildGetStorageAt({
    getCurrentBlockNumber: () => 16375000n,
  });

  const storage = await getStorageAt(client, {
    address: uniswapV3PoolFactoryConfig.criteria.address,
    slot: toHex(3),
  });

  expect(storage).toBe(
    "0x0000000000000000000000001a9c8182c09f50c8318d769245bea52c32be35bc"
  );
});

test("getStorageAt() with cache", async ({ eventStore }) => {
  const client = createClient({
    chain: anvil,
    transport: ponderTransport({ transport: http(), eventStore }),
  });

  const callSpy = vi.spyOn(eventStore, "insertRpcRequestResult");

  const getStorageAt = buildGetStorageAt({
    getCurrentBlockNumber: () => 16375000n,
  });

  let storage = await getStorageAt(client, {
    address: uniswapV3PoolFactoryConfig.criteria.address,
    slot: toHex(3),
  });

  expect(storage).toBe(
    "0x0000000000000000000000001a9c8182c09f50c8318d769245bea52c32be35bc"
  );
  storage = await getStorageAt(client, {
    address: uniswapV3PoolFactoryConfig.criteria.address,
    slot: toHex(3),
  });

  expect(storage).toBe(
    "0x0000000000000000000000001a9c8182c09f50c8318d769245bea52c32be35bc"
  );
  expect(callSpy).toHaveBeenCalledTimes(1);
});
