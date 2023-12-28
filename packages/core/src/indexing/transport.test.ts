import type { Transport } from "viem";
import { getFunctionSelector, toHex } from "viem";
import { assertType, beforeEach, expect, test, vi } from "vitest";

import { setupAnvil, setupSyncStore } from "@/_test/setup.js";
import { anvil, publicClient } from "@/_test/utils.js";

import { ponderTransport } from "./transport.js";

beforeEach((context) => setupAnvil(context));
beforeEach((context) => setupSyncStore(context));

test("default", ({ syncStore, networks }) => {
  const transport = ponderTransport({
    requestQueue: networks[0].requestQueue,
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

test("eth_call", async ({ syncStore, erc20, networks }) => {
  const blockNumber = await publicClient.getBlockNumber();

  const transport = ponderTransport({
    requestQueue: networks[0].requestQueue,
    syncStore,
  })({
    chain: anvil,
  });

  const response1 = await transport.request({
    method: "eth_call",
    params: [
      {
        data: getFunctionSelector("totalSupply()"),
        to: erc20.address,
      },
      toHex(blockNumber),
    ],
  });

  expect(response1).toBeDefined();

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResult");

  const response2 = await transport.request({
    method: "eth_call",
    params: [
      {
        data: getFunctionSelector("totalSupply()"),
        to: erc20.address,
      },
      toHex(blockNumber),
    ],
  });

  expect(response1).toBe(response2);

  expect(insertSpy).toHaveBeenCalledTimes(0);

  const getSpy = vi.spyOn(syncStore, "getRpcRequestResult");

  const response3 = await transport.request({
    method: "eth_call",
    params: [
      {
        data: getFunctionSelector("totalSupply()"),
        to: erc20.address,
      },
      "latest",
    ],
  });

  expect(response3).toBeDefined();

  expect(getSpy).toHaveBeenCalledTimes(1);
});

test("eth_getBalance", async ({ syncStore, erc20, networks }) => {
  const blockNumber = await publicClient.getBlockNumber();

  const transport = ponderTransport({
    requestQueue: networks[0].requestQueue,
    syncStore,
  })({
    chain: anvil,
  });

  const response1 = await transport.request({
    method: "eth_getBalance",
    params: [erc20.address, toHex(blockNumber)],
  });

  expect(response1).toBeDefined();

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResult");

  const response2 = await transport.request({
    method: "eth_getBalance",
    params: [erc20.address, toHex(blockNumber)],
  });

  expect(response1).toBe(response2);

  expect(insertSpy).toHaveBeenCalledTimes(0);

  const getSpy = vi.spyOn(syncStore, "getRpcRequestResult");

  const response3 = await transport.request({
    method: "eth_getBalance",
    params: [erc20.address, "latest"],
  });

  expect(response3).toBeDefined();

  expect(getSpy).toHaveBeenCalledTimes(1);
});

test("eth_getStorageAt", async ({ syncStore, erc20, networks }) => {
  const blockNumber = await publicClient.getBlockNumber();

  const transport = ponderTransport({
    requestQueue: networks[0].requestQueue,
    syncStore,
  })({
    chain: anvil,
  });

  const response1 = await transport.request({
    method: "eth_getStorageAt",
    params: [erc20.address, toHex(3), toHex(blockNumber)],
  });

  expect(response1).toBeDefined();

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResult");

  const response2 = await transport.request({
    method: "eth_getStorageAt",
    params: [erc20.address, toHex(3), toHex(blockNumber)],
  });

  expect(response1).toBe(response2);

  expect(insertSpy).toHaveBeenCalledTimes(0);

  const getSpy = vi.spyOn(syncStore, "getRpcRequestResult");

  const response3 = await transport.request({
    method: "eth_getStorageAt",
    params: [erc20.address, toHex(3), "latest"],
  });

  expect(response3).toBeDefined();

  expect(getSpy).toHaveBeenCalledTimes(1);
});

test("eth_getCode", async ({ syncStore, erc20, networks }) => {
  const blockNumber = await publicClient.getBlockNumber();

  const transport = ponderTransport({
    requestQueue: networks[0].requestQueue,
    syncStore,
  })({
    chain: anvil,
  });

  const response1 = await transport.request({
    method: "eth_getCode",
    params: [erc20.address, toHex(blockNumber)],
  });

  expect(response1).toBeDefined();

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResult");

  const response2 = await transport.request({
    method: "eth_getCode",
    params: [erc20.address, toHex(blockNumber)],
  });

  expect(response1).toBe(response2);

  expect(insertSpy).toHaveBeenCalledTimes(0);

  const getSpy = vi.spyOn(syncStore, "getRpcRequestResult");

  const response3 = await transport.request({
    method: "eth_getCode",
    params: [erc20.address, "latest"],
  });

  expect(response3).toBeDefined();

  expect(getSpy).toHaveBeenCalledTimes(1);
});

test("fallback method", async ({ syncStore, networks }) => {
  const transport = ponderTransport({
    requestQueue: networks[0].requestQueue,
    syncStore,
  })({
    chain: anvil,
  });

  expect(await transport.request({ method: "eth_blockNumber" })).toBeDefined();
});
