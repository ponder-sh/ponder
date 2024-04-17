import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { anvil, publicClient } from "@/_test/utils.js";
import type { Transport } from "viem";
import { getFunctionSelector, toHex } from "viem";
import { assertType, beforeEach, expect, test, vi } from "vitest";
import { cachedTransport } from "./transport.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

test("default", async (context) => {
  const { requestQueues } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);

  const transport = cachedTransport({
    requestQueue: requestQueues[0],
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

  await cleanup();
});

test("eth_call", async (context) => {
  const { erc20, requestQueues } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumber = await publicClient.getBlockNumber();

  const transport = cachedTransport({
    requestQueue: requestQueues[0],
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

  await cleanup();
});

test("eth_getBalance", async (context) => {
  const { erc20, requestQueues } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumber = await publicClient.getBlockNumber();

  const transport = cachedTransport({
    requestQueue: requestQueues[0],
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

  await cleanup();
});

test("eth_getStorageAt", async (context) => {
  const { erc20, requestQueues } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumber = await publicClient.getBlockNumber();

  const transport = cachedTransport({
    requestQueue: requestQueues[0],
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

  await cleanup();
});

test("eth_getCode", async (context) => {
  const { erc20, requestQueues } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumber = await publicClient.getBlockNumber();

  const transport = cachedTransport({
    requestQueue: requestQueues[0],
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

  await cleanup();
});

test("fallback method", async (context) => {
  const { requestQueues } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const transport = cachedTransport({
    requestQueue: requestQueues[0],
    syncStore,
  })({
    chain: anvil,
  });

  expect(await transport.request({ method: "eth_blockNumber" })).toBeDefined();

  await cleanup();
});
