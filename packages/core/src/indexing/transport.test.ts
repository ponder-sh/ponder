import { getFunctionSelector, http, toHex, Transport } from "viem";
import { assertType, beforeEach, expect, test, vi } from "vitest";

import { usdcContractConfig } from "@/_test/constants";
import { setupSyncStore } from "@/_test/setup";
import { anvil } from "@/_test/utils";

import { ponderTransport } from "./transport";

beforeEach((context) => setupSyncStore(context));

test("default", ({ syncStore }) => {
  const transport = ponderTransport({
    transport: http("https://mockapi.com/rpc"),
    syncStore,
  });

  assertType<Transport>(transport);

  expect(transport({})).toMatchInlineSnapshot(`
    {
      "config": {
        "key": "custom",
        "name": "Custom Provider",
        "request": [Function],
        "retryCount": 3,
        "retryDelay": 150,
        "timeout": undefined,
        "type": "custom",
      },
      "request": [Function],
      "value": undefined,
    }
  `);
});

test("eth_call", async ({ syncStore }) => {
  const transport = ponderTransport({
    transport: http(),
    syncStore,
  })({
    chain: anvil,
  });

  const response1 = await transport.request({
    method: "eth_call",
    params: [
      {
        data: getFunctionSelector("totalSupply()"),
        to: usdcContractConfig.address,
      },
      toHex(16375000n),
    ],
  });

  expect(response1).toBeDefined();

  const callSpy = vi.spyOn(syncStore, "insertRpcRequestResult");

  const response2 = await transport.request({
    method: "eth_call",
    params: [
      {
        data: getFunctionSelector("totalSupply()"),
        to: usdcContractConfig.address,
      },
      toHex(16375000n),
    ],
  });

  expect(response1).toBe(response2);

  expect(callSpy).toHaveBeenCalledTimes(0);
});

test("eth_getBalance", async ({ syncStore }) => {
  const transport = ponderTransport({
    transport: http(),
    syncStore,
  })({
    chain: anvil,
  });

  const response1 = await transport.request({
    method: "eth_getBalance",
    params: [usdcContractConfig.address, toHex(16375000n)],
  });

  expect(response1).toBeDefined();

  const callSpy = vi.spyOn(syncStore, "insertRpcRequestResult");

  const response2 = await transport.request({
    method: "eth_getBalance",
    params: [usdcContractConfig.address, toHex(16375000n)],
  });

  expect(response1).toBe(response2);

  expect(callSpy).toHaveBeenCalledTimes(0);
});

test("eth_getStorageAt", async ({ syncStore }) => {
  const transport = ponderTransport({
    transport: http(),
    syncStore,
  })({
    chain: anvil,
  });

  const response1 = await transport.request({
    method: "eth_getStorageAt",
    params: [usdcContractConfig.address, toHex(3), toHex(16375000n)],
  });

  expect(response1).toBeDefined();

  const callSpy = vi.spyOn(syncStore, "insertRpcRequestResult");

  const response2 = await transport.request({
    method: "eth_getStorageAt",
    params: [usdcContractConfig.address, toHex(3), toHex(16375000n)],
  });

  expect(response1).toBe(response2);

  expect(callSpy).toHaveBeenCalledTimes(0);
});

test("eth_getCode", async ({ syncStore }) => {
  const transport = ponderTransport({
    transport: http(),
    syncStore,
  })({
    chain: anvil,
  });

  const response1 = await transport.request({
    method: "eth_getCode",
    params: [usdcContractConfig.address, toHex(16375000n)],
  });

  expect(response1).toBeDefined();

  const callSpy = vi.spyOn(syncStore, "insertRpcRequestResult");

  const response2 = await transport.request({
    method: "eth_getCode",
    params: [usdcContractConfig.address, toHex(16375000n)],
  });

  expect(response1).toBe(response2);

  expect(callSpy).toHaveBeenCalledTimes(0);
});

test("fallback method", async ({ syncStore }) => {
  const transport = ponderTransport({
    transport: http(),
    syncStore,
  })({
    chain: anvil,
  });

  expect(await transport.request({ method: "eth_blockNumber" })).toBeDefined();
});
