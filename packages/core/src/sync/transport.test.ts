import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { anvil, publicClient } from "@/_test/utils.js";
import type { Transport } from "viem";
import { toHex } from "viem";
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
        "retryCount": 0,
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

test("request() block dependent method", async (context) => {
  const { requestQueues } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const blockNumber = await publicClient.getBlockNumber();

  const transport = cachedTransport({
    requestQueue: requestQueues[0],
    syncStore,
  })({
    chain: anvil,
  });

  const response1 = await transport.request({
    method: "eth_getBlockByNumber",
    params: [toHex(blockNumber), false],
  });

  expect(response1).toBeDefined;

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResult");
  const getSpy = vi.spyOn(syncStore, "getRpcRequestResult");

  const response2 = await transport.request({
    method: "eth_getBlockByNumber",
    params: [toHex(blockNumber), false],
  });

  expect(response1).toStrictEqual(response2);

  expect(insertSpy).toHaveBeenCalledTimes(0);
  expect(getSpy).toHaveBeenCalledTimes(1);

  await cleanup();
});

test("request() non-block dependent method", async (context) => {
  const { requestQueues } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const block = await publicClient.getBlock({ blockNumber: 2n });

  const transport = cachedTransport({
    requestQueue: requestQueues[0],
    syncStore,
  })({
    chain: anvil,
  });

  const response1 = await transport.request({
    method: "eth_getTransactionByHash",
    params: [block.transactions[0]!],
  });

  expect(response1).toBeDefined;

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResult");
  const getSpy = vi.spyOn(syncStore, "getRpcRequestResult");

  const response2 = await transport.request({
    method: "eth_getTransactionByHash",
    params: [block.transactions[0]!],
  });

  expect(response1).toStrictEqual(response2);

  expect(insertSpy).toHaveBeenCalledTimes(0);
  expect(getSpy).toHaveBeenCalledTimes(1);

  await cleanup();
});

test("request() non-cached method", async (context) => {
  const { requestQueues } = context;
  const { syncStore, cleanup } = await setupDatabaseServices(context);
  const transport = cachedTransport({
    requestQueue: requestQueues[0],
    syncStore,
  })({
    chain: anvil,
  });

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResult");
  const getSpy = vi.spyOn(syncStore, "getRpcRequestResult");

  expect(await transport.request({ method: "eth_blockNumber" })).toBeDefined();

  expect(insertSpy).toHaveBeenCalledTimes(0);
  expect(getSpy).toHaveBeenCalledTimes(0);

  await cleanup();
});
