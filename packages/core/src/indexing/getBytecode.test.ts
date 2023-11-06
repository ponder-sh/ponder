import { createClient, http, keccak256 } from "viem";
import { beforeEach, expect, test, vi } from "vitest";

import { usdcContractConfig } from "@/_test/constants";
import { setupEventStore } from "@/_test/setup";
import { anvil } from "@/_test/utils";

import { buildGetBytecode } from "./getBytecode";
import { ponderTransport } from "./transport";

beforeEach((context) => setupEventStore(context));

test("getBytecode() no cache", async ({ eventStore }) => {
  const client = createClient({
    chain: anvil,
    transport: ponderTransport({ transport: http(), eventStore }),
  });

  const getBytecode = buildGetBytecode({
    getCurrentBlockNumber: () => 16375000n,
  });

  const bytecode = await getBytecode(client, {
    address: usdcContractConfig.address,
  });

  expect(bytecode).toBeTruthy();
  expect(keccak256(bytecode!)).toBe(
    "0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505"
  );
});

test("getBytecode() with cache", async ({ eventStore }) => {
  const client = createClient({
    chain: anvil,
    transport: ponderTransport({ transport: http(), eventStore }),
  });

  const callSpy = vi.spyOn(eventStore, "insertRpcRequestResult");

  const getBytecode = buildGetBytecode({
    getCurrentBlockNumber: () => 16375000n,
  });

  let bytecode = await getBytecode(client, {
    address: usdcContractConfig.address,
  });

  expect(bytecode).toBeTruthy();
  expect(keccak256(bytecode!)).toBe(
    "0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505"
  );
  bytecode = await getBytecode(client, {
    address: usdcContractConfig.address,
  });

  expect(bytecode).toBeTruthy();
  expect(keccak256(bytecode!)).toBe(
    "0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505"
  );
  expect(callSpy).toHaveBeenCalledTimes(1);
});
