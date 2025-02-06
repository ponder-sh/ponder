import { ALICE } from "@/_test/constants.js";
import {
  setupAnvil,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { deployErc20, mintErc20 } from "@/_test/simulate.js";
import { anvil, getNetwork, publicClient } from "@/_test/utils.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import { type Transport, parseEther } from "viem";
import { toHex } from "viem";
import { assertType, beforeEach, expect, test, vi } from "vitest";
import { cachedTransport } from "./transport.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("default", async (context) => {
  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { syncStore } = await setupDatabaseServices(context);

  const transport = cachedTransport({
    requestQueue,
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
});

test("request() block dependent method", async (context) => {
  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { syncStore } = await setupDatabaseServices(context);
  const blockNumber = await publicClient.getBlockNumber();

  const transport = cachedTransport({
    requestQueue,
    syncStore,
  })({
    chain: anvil,
  });

  const response1 = await transport.request({
    method: "eth_getBlockByNumber",
    params: [toHex(blockNumber), false],
  });

  expect(response1).toBeDefined();

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResult");
  const getSpy = vi.spyOn(syncStore, "getRpcRequestResult");

  const response2 = await transport.request({
    method: "eth_getBlockByNumber",
    params: [toHex(blockNumber), false],
  });

  expect(response1).toStrictEqual(response2);

  expect(insertSpy).toHaveBeenCalledTimes(0);
  expect(getSpy).toHaveBeenCalledTimes(1);
});

test("request() non-block dependent method", async (context) => {
  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { syncStore } = await setupDatabaseServices(context);
  const blockNumber = await publicClient.getBlockNumber();
  const block = await publicClient.getBlock({ blockNumber: blockNumber });

  const transport = cachedTransport({
    requestQueue,
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
});

test("request() non-cached method", async (context) => {
  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { syncStore } = await setupDatabaseServices(context);
  const transport = cachedTransport({
    requestQueue,
    syncStore,
  })({
    chain: anvil,
  });

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResult");
  const getSpy = vi.spyOn(syncStore, "getRpcRequestResult");

  expect(await transport.request({ method: "eth_blockNumber" })).toBeDefined();

  expect(insertSpy).toHaveBeenCalledTimes(0);
  expect(getSpy).toHaveBeenCalledTimes(0);
});
