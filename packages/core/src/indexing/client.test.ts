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
  simulateBlock,
} from "@/_test/simulate.js";
import {
  getBlocksIndexingBuild,
  getChain,
  getErc20IndexingBuild,
  getSimulatedEvent,
  publicClient,
} from "@/_test/utils.js";
import { createRpc } from "@/rpc/index.js";
import {
  type Hex,
  decodeFunctionResult,
  encodeFunctionData,
  multicall3Abi,
  parseEther,
} from "viem";
import { toHex } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import { createCachedViemClient } from "./client.js";
import { getEventCount } from "./index.js";

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

  const blockData = await simulateBlock();
  const { eventCallbacks, indexingFunctions } = getBlocksIndexingBuild({
    interval: 1,
  });

  const { syncStore } = await setupDatabaseServices(context);

  const event = getSimulatedEvent({
    eventCallback: eventCallbacks[0],
    blockData,
  });

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: getEventCount(indexingFunctions),
  });

  cachedViemClient.event = event;

  const request = cachedViemClient.getClient(chain).request;

  const response1 = await request({
    method: "eth_getBlockByNumber",
    params: [toHex(blockData.block.number), false],
  });

  expect(response1).toBeDefined();

  const insertSpy = vi.spyOn(syncStore, "insertRpcRequestResults");
  const getSpy = vi.spyOn(syncStore, "getRpcRequestResults");

  const response2 = await request({
    method: "eth_getBlockByNumber",
    params: [toHex(blockData.block.number), false],
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
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const { syncStore } = await setupDatabaseServices(context);
  const blockNumber = await publicClient.getBlockNumber();
  const block = await publicClient.getBlock({ blockNumber: blockNumber });

  const event = getSimulatedEvent({
    eventCallback: eventCallbacks[0],
    blockData,
  });

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: getEventCount(indexingFunctions),
  });

  cachedViemClient.event = event;

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

  const blockData = await simulateBlock();
  const { eventCallbacks, indexingFunctions } = getBlocksIndexingBuild({
    interval: 1,
  });

  const { syncStore } = await setupDatabaseServices(context);

  const event = getSimulatedEvent({
    eventCallback: eventCallbacks[0],
    blockData,
  });

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: getEventCount(indexingFunctions),
  });

  cachedViemClient.event = event;

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

  const blockData = await simulateBlock();
  const { eventCallbacks, indexingFunctions } = getBlocksIndexingBuild({
    interval: 1,
  });

  const { syncStore } = await setupDatabaseServices(context);

  const event = getSimulatedEvent({
    eventCallback: eventCallbacks[0],
    blockData,
  });

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: getEventCount(indexingFunctions),
  });

  cachedViemClient.event = event;

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

  const blockData = await simulateBlock();
  const { eventCallbacks, indexingFunctions } = getBlocksIndexingBuild({
    interval: 1,
  });

  const { syncStore } = await setupDatabaseServices(context);

  const event = getSimulatedEvent({
    eventCallback: eventCallbacks[0],
    blockData,
  });

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: getEventCount(indexingFunctions),
  });

  cachedViemClient.event = event;

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
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const event = getSimulatedEvent({
    eventCallback: eventCallbacks[0],
    blockData,
  });

  const eventCount = getEventCount(indexingFunctions);

  eventCount[
    "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)"
  ] = 1;

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount,
  });
  cachedViemClient.event = event;

  let totalSupply = await cachedViemClient.getClient(chain).readContract({
    abi: erc20ABI,
    functionName: "totalSupply",
    address,
  });

  expect(totalSupply).toBe(parseEther("1"));

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
  const { address: erc20 } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { syncStore } = await setupDatabaseServices(context);

  const { eventCallbacks, indexingFunctions } = getErc20IndexingBuild({
    address: erc20,
  });
  const event = getSimulatedEvent({
    eventCallback: eventCallbacks[0],
    blockData,
  });

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: getEventCount(indexingFunctions),
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

test("readContract() action retry", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { syncStore } = await setupDatabaseServices(context);

  const { eventCallbacks, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const requestSpy = vi.spyOn(rpc, "request");

  requestSpy.mockReturnValueOnce(Promise.resolve("0x"));

  const event = getSimulatedEvent({
    eventCallback: eventCallbacks[0],
    blockData,
  });

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: getEventCount(indexingFunctions),
  });

  cachedViemClient.event = event;

  await cachedViemClient.getClient(chain).readContract({
    abi: erc20ABI,
    functionName: "totalSupply",
    address,
  });

  expect(requestSpy).toHaveBeenCalledTimes(2);
});

test("readContract() with immutable cache", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { syncStore } = await setupDatabaseServices(context);

  const { eventCallbacks, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const requestSpy = vi.spyOn(rpc, "request");

  const event = getSimulatedEvent({
    eventCallback: eventCallbacks[0],
    blockData,
  });

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: getEventCount(indexingFunctions),
  });

  cachedViemClient.event = event;

  const result = await cachedViemClient.getClient(chain).readContract({
    abi: erc20ABI,
    functionName: "totalSupply",
    address,
    cache: "immutable",
  });

  expect(result).toMatchInlineSnapshot("1000000000000000000n");

  expect(requestSpy).toBeCalledWith(
    {
      method: "eth_call",
      params: [expect.any(Object), "latest"],
    },
    expect.any(Object),
  );
});

test("readContract() with no retry empty response", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { syncStore } = await setupDatabaseServices(context);

  const { eventCallbacks, indexingFunctions } = getErc20IndexingBuild({
    address,
  });

  const requestSpy = vi.spyOn(rpc, "request");

  requestSpy.mockReturnValueOnce(Promise.resolve("0x"));

  const event = getSimulatedEvent({
    eventCallback: eventCallbacks[0],
    blockData,
  });

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: getEventCount(indexingFunctions),
  });

  cachedViemClient.event = event;

  await expect(() =>
    cachedViemClient.getClient(chain).readContract({
      abi: erc20ABI,
      functionName: "totalSupply",
      address,
      retryEmptyResponse: false,
    }),
  ).rejects.toThrow();
});

test("getBlock() action retry", async (context) => {
  const chain = getChain();
  const rpc = createRpc({
    chain,
    common: context.common,
  });

  const blockData = await simulateBlock();

  const { syncStore } = await setupDatabaseServices(context);

  const { eventCallbacks, indexingFunctions } = getBlocksIndexingBuild({
    interval: 1,
  });

  const requestSpy = vi.spyOn(rpc, "request");

  requestSpy.mockReturnValueOnce(Promise.resolve(null));

  const event = getSimulatedEvent({
    eventCallback: eventCallbacks[0],
    blockData,
  });

  const cachedViemClient = createCachedViemClient({
    common: context.common,
    indexingBuild: { chains: [chain], rpcs: [rpc] },
    syncStore,
    eventCount: getEventCount(indexingFunctions),
  });

  cachedViemClient.event = event;

  await cachedViemClient.getClient(chain).getBlock({ blockNumber: 1n });

  expect(requestSpy).toHaveBeenCalledTimes(2);
});
