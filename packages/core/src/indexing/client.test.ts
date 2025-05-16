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
import { getChain, publicClient } from "@/_test/utils.js";
import type { LogEvent } from "@/internal/types.js";
import { createRpc } from "@/rpc/index.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import {
  type Hex,
  decodeFunctionResult,
  encodeFunctionData,
  multicall3Abi,
  parseEther,
  zeroAddress,
} from "viem";
import { toHex } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import { createCachedViemClient } from "./client.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

test("request() block dependent method", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { syncStore } = await setupDatabaseServices(context);
  const blockNumber = await publicClient.getBlockNumber();

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: {},
  });

  const request = cachedViemClient.getClient(chain).request;

  const response1 = await request({
    method: "eth_getBlockByNumber",
    params: [toHex(blockNumber), false],
  });

  expect(response1).toBeDefined();

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResults");
  const getSpy = vi.spyOn(syncStore, "getRpcRequestResults");

  const response2 = await request({
    method: "eth_getBlockByNumber",
    params: [toHex(blockNumber), false],
  });

  expect(response1).toStrictEqual(response2);

  expect(insertSpy).toHaveBeenCalledTimes(0);
  expect(getSpy).toHaveBeenCalledTimes(1);
});

test("request() non-block dependent method", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
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

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: {},
  });

  const request = cachedViemClient.getClient(chain).request;

  const response1 = await request({
    method: "eth_getTransactionByHash",
    params: [block.transactions[0]!],
  });

  expect(response1).toBeDefined;

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResults");
  const getSpy = vi.spyOn(syncStore, "getRpcRequestResults");

  const response2 = await request({
    method: "eth_getTransactionByHash",
    params: [block.transactions[0]!],
  });

  expect(response1).toStrictEqual(response2);

  expect(insertSpy).toHaveBeenCalledTimes(0);
  expect(getSpy).toHaveBeenCalledTimes(1);
});

test("request() non-cached method", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { syncStore } = await setupDatabaseServices(context);
  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: {},
  });

  const request = cachedViemClient.getClient(chain).request;

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResults");
  const getSpy = vi.spyOn(syncStore, "getRpcRequestResults");

  expect(await request({ method: "eth_blockNumber" })).toBeDefined();

  expect(insertSpy).toHaveBeenCalledTimes(0);
  expect(getSpy).toHaveBeenCalledTimes(0);
});

test("request() multicall", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { syncStore } = await setupDatabaseServices(context);

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: {},
  });

  const request = cachedViemClient.getClient(chain).request;

  const { address: multicall } = await deployMulticall({ sender: ALICE });
  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const response1 = await request({
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
  const requestSpy = vi.spyOn(rpc, "request");

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

  const response2 = await request({
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
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { syncStore } = await setupDatabaseServices(context);

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: {},
  });

  const request = cachedViemClient.getClient(chain).request;

  const { address: multicall } = await deployMulticall({ sender: ALICE });

  const response = await request({
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

test("prefetch() uses profile metadata", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { syncStore } = await setupDatabaseServices(context);

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "Contract:Event",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: {
        from: zeroAddress,
        to: ALICE,
        amount: parseEther("1"),
      },
      log: {
        address,
      } as LogEvent["event"]["log"],
      block: { number: 1n } as LogEvent["event"]["block"],
      transaction: {} as LogEvent["event"]["transaction"],
    },
  } satisfies LogEvent;

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: { "Contract:Event": 1 },
  });
  cachedViemClient.event = event;

  let totalSupply = await cachedViemClient.getClient(chain).readContract({
    abi: erc20ABI,
    functionName: "totalSupply",
    address,
  });

  expect(totalSupply).toBe(parseEther("0"));

  event.event.block.number = 2n;
  cachedViemClient.event = event;

  await cachedViemClient.prefetch({
    events: [event],
  });

  const requestSpy = vi.spyOn(rpc, "request");
  const getSpy = vi.spyOn(syncStore, "getRpcRequestResults");

  totalSupply = await cachedViemClient.getClient(chain).readContract({
    abi: erc20ABI,
    functionName: "totalSupply",
    address,
  });

  expect(totalSupply).toBe(parseEther("1"));

  expect(requestSpy).toHaveBeenCalledTimes(0);
  expect(getSpy).toHaveBeenCalledTimes(0);
});

test("request() revert", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployRevert({ sender: ALICE });

  const { syncStore } = await setupDatabaseServices(context);

  const event = {
    type: "log",
    chainId: 1,
    checkpoint: ZERO_CHECKPOINT_STRING,
    name: "Contract:Event",
    event: {
      id: ZERO_CHECKPOINT_STRING,
      args: {
        from: zeroAddress,
        to: ALICE,
        amount: parseEther("1"),
      },
      log: {
        address,
      } as LogEvent["event"]["log"],
      block: { number: 1n } as LogEvent["event"]["block"],
      transaction: {} as LogEvent["event"]["transaction"],
    },
  } satisfies LogEvent;

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: { "Contract:Event": 1 },
  });
  cachedViemClient.event = event;

  const request = cachedViemClient.getClient(chain).request;

  const response1 = await request({
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
  }).catch((error) => error);

  expect(response1).toBeInstanceOf(Error);
});
