import { ALICE } from "@/_test/constants.js";
import { erc20ABI, revertABI } from "@/_test/generated.js";
import {
  setupAnvil,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import {
  deployErc20,
  deployMulticall,
  deployRevert,
  mintErc20,
} from "@/_test/simulate.js";
import { anvil, getNetwork, publicClient } from "@/_test/utils.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import {
  type Hex,
  type Transport,
  decodeFunctionResult,
  encodeFunctionData,
  multicall3Abi,
  parseEther,
} from "viem";
import { toHex } from "viem";
import { assertType, beforeEach, expect, test, vi } from "vitest";
import { cachedTransport } from "./client.js";

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

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResults");
  const getSpy = vi.spyOn(syncStore, "getRpcRequestResults");

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

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResults");
  const getSpy = vi.spyOn(syncStore, "getRpcRequestResults");

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

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResults");
  const getSpy = vi.spyOn(syncStore, "getRpcRequestResults");

  expect(await transport.request({ method: "eth_blockNumber" })).toBeDefined();

  expect(insertSpy).toHaveBeenCalledTimes(0);
  expect(getSpy).toHaveBeenCalledTimes(0);
});

test("request() multicall", async (context) => {
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

  const { address: multicall } = await deployMulticall({ sender: ALICE });
  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const response1 = await transport.request({
    method: "eth_call",
    params: [
      {
        to: multicall,
        data: encodeFunctionData({
          abi: multicall3Abi,
          functionName: "aggregate3",
          args: [
            [
              {
                target: address,
                allowFailure: false,
                callData: encodeFunctionData({
                  abi: erc20ABI,
                  functionName: "totalSupply",
                }),
              },
            ],
          ],
        }),
      },
      "latest",
    ],
  });

  expect(response1).toBeDefined();

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResults");
  const getSpy = vi.spyOn(syncStore, "getRpcRequestResults");
  const requestSpy = vi.spyOn(requestQueue, "request");

  let result = decodeFunctionResult({
    abi: multicall3Abi,
    functionName: "aggregate3",
    data: response1 as Hex,
  });

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "returnData": "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
        "success": true,
      },
    ]
  `);

  const response2 = await transport.request({
    method: "eth_call",
    params: [
      {
        to: multicall,
        data: encodeFunctionData({
          abi: multicall3Abi,
          functionName: "aggregate3",
          args: [
            [
              {
                target: address,
                allowFailure: false,
                callData: encodeFunctionData({
                  abi: erc20ABI,
                  functionName: "totalSupply",
                }),
              },
              {
                target: address,
                allowFailure: false,
                callData: encodeFunctionData({
                  abi: erc20ABI,
                  functionName: "balanceOf",
                  args: [ALICE],
                }),
              },
            ],
          ],
        }),
      },
      "latest",
    ],
  });

  result = decodeFunctionResult({
    abi: multicall3Abi,
    functionName: "aggregate3",
    data: response2 as Hex,
  });

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "returnData": "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
        "success": true,
      },
      {
        "returnData": "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
        "success": true,
      },
    ]
  `);
  expect(insertSpy).toHaveBeenCalledTimes(1);
  expect(getSpy).toHaveBeenCalledTimes(1);
  expect(requestSpy).toHaveBeenCalledTimes(1);
});

test("request() multicall empty", async (context) => {
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

  const { address: multicall } = await deployMulticall({ sender: ALICE });

  const response = await transport.request({
    method: "eth_call",
    params: [
      {
        to: multicall,
        data: encodeFunctionData({
          abi: multicall3Abi,
          functionName: "aggregate3",
          args: [[]],
        }),
      },
      "latest",
    ],
  });

  expect(response).toBeDefined();

  const result = decodeFunctionResult({
    abi: multicall3Abi,
    functionName: "aggregate3",
    data: response as Hex,
  });

  expect(result).toMatchInlineSnapshot("[]");
});

test("request() revert", async (context) => {
  const network = getNetwork();
  const requestQueue = createRequestQueue({
    network,
    common: context.common,
  });

  const { address } = await deployRevert({ sender: ALICE });

  const { syncStore } = await setupDatabaseServices(context);

  const transport = cachedTransport({
    requestQueue,
    syncStore,
  })({
    chain: anvil,
  });

  const response1 = await transport
    .request({
      method: "eth_call",
      params: [
        {
          to: address,
          data: encodeFunctionData({
            abi: revertABI,
            functionName: "revert",
            args: [true],
          }),
        },
        "0x1",
      ],
    })
    .catch((error) => error);

  expect(response1).toBeInstanceOf(Error);
});
