import {
  type Address,
  getAbiItem,
  toEventSelector,
  toFunctionSelector,
} from "viem";
import { mainnet } from "viem/chains";
import { vi } from "vitest";
import { buildLogFactory } from "@/build/factory.js";
import { factory } from "@/config/address.js";
import type { Common } from "@/internal/common.js";
import { createLogger } from "@/internal/logger.js";
import { MetricsService } from "@/internal/metrics.js";
import { buildOptions } from "@/internal/options.js";
import { createShutdown } from "@/internal/shutdown.js";
import type {
  Chain,
  Contract,
  EventCallback,
  Factory,
  FilterAddress,
  IndexingFunctions,
  SetupCallback,
  TransactionFilter,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import {
  defaultBlockFilterInclude,
  defaultLogFilterInclude,
  defaultTraceFilterInclude,
  defaultTransactionFilterInclude,
  defaultTransactionReceiptInclude,
  defaultTransferFilterInclude,
} from "@/runtime/filter.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { erc20ABI, factoryABI, pairABI } from "./abis.js";

export function createTestCommon(): Common {
  const cliOptions = {
    command: "start",
    config: "",
    root: "",
    logLevel: "silent",
    logFormat: "pretty",
    version: "0.0.0",
  } as const;
  const shutdown = createShutdown();
  return {
    options: buildOptions({ cliOptions }),
    logger: createLogger({ level: cliOptions.logLevel }),
    metrics: new MetricsService(),
    shutdown,
    apiShutdown: shutdown,
    buildShutdown: shutdown,
  };
}

/**
 * RPC for a chain whose latest block is `latestBlock`. Only serves
 * `eth_getBlockByNumber`, with each block's timestamp equal to its number.
 */
export function createStubRpc({ latestBlock }: { latestBlock: number }): Rpc {
  const toHash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
  return {
    hostnames: [],
    request: async ({ method, params }: { method: string; params?: any }) => {
      if (method !== "eth_getBlockByNumber") {
        throw new Error(`Unexpected RPC method ${method}`);
      }
      const number =
        params[0] === "latest" ? latestBlock : Number.parseInt(params[0], 16);
      return {
        hash: toHash(number),
        parentHash: toHash(Math.max(number - 1, 0)),
        number: `0x${number.toString(16)}`,
        timestamp: `0x${number.toString(16)}`,
        logsBloom: `0x${"0".repeat(512)}`,
        transactions: [],
      };
    },
    subscribe: () => {},
    unsubscribe: async () => {},
  } as unknown as Rpc;
}

export async function withStubbedEnv(
  env: Record<string, string | undefined>,
  testCase: () => void | Promise<void>,
) {
  const originalValues = {} as Record<string, string | undefined>;

  for (const [k, v] of Object.entries(env)) {
    originalValues[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  try {
    await testCase();
  } finally {
    for (const [k, v] of Object.entries(originalValues)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

export const getErc20IndexingBuild = <
  includeCallTraces extends boolean = false,
>(params: {
  address: Address;
  includeCallTraces?: includeCallTraces;
  includeTransactionReceipts?: boolean;
}): includeCallTraces extends true
  ? {
      eventCallbacks: [EventCallback, EventCallback];
      setupCallbacks: [SetupCallback];
      indexingFunctions: IndexingFunctions;
      contracts: { [name: string]: Contract };
    }
  : {
      eventCallbacks: [EventCallback];
      setupCallbacks: [SetupCallback];
      indexingFunctions: IndexingFunctions;
      contracts: { [name: string]: Contract };
    } => {
  const eventCallbacks = params.includeCallTraces
    ? ([
        {
          filter: {
            type: "trace",
            chainId: 1,
            sourceId: "Erc20",
            fromAddress: undefined,
            toAddress: toLowerCase(params.address),
            callType: "CALL",
            functionSelector: toFunctionSelector(
              getAbiItem({ abi: erc20ABI, name: "transfer" }),
            ),
            fromBlock: undefined,
            toBlock: undefined,
            hasTransactionReceipt: params.includeTransactionReceipts ?? false,
            include: defaultTraceFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          name: "Erc20.transfer()",
          fn: vi.fn(),
          chain: getChain(),
          type: "contract",
          abiItem: getAbiItem({ abi: erc20ABI, name: "transfer" }),
          metadata: {
            safeName: "transfer()",
            abi: erc20ABI,
          },
        },
        {
          filter: {
            type: "log",
            chainId: 1,
            sourceId: "Erc20",
            address: toLowerCase(params.address),
            topic0: toEventSelector(
              getAbiItem({ abi: erc20ABI, name: "Transfer" }),
            ),
            topic1: null,
            topic2: null,
            topic3: null,
            fromBlock: undefined,
            toBlock: undefined,
            hasTransactionReceipt: params.includeTransactionReceipts ?? false,
            include: defaultLogFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          name: "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
          fn: vi.fn(),
          chain: getChain(),
          type: "contract",
          abiItem: getAbiItem({ abi: erc20ABI, name: "Transfer" }),
          metadata: {
            safeName:
              "Transfer(address indexed from, address indexed to, uint256 amount)",
            abi: erc20ABI,
          },
        },
      ] satisfies [EventCallback, EventCallback])
    : ([
        {
          filter: {
            type: "log",
            chainId: 1,
            sourceId: "Erc20",
            address: toLowerCase(params.address),
            topic0: toEventSelector(
              getAbiItem({ abi: erc20ABI, name: "Transfer" }),
            ),
            topic1: null,
            topic2: null,
            topic3: null,
            fromBlock: undefined,
            toBlock: undefined,
            hasTransactionReceipt: params.includeTransactionReceipts ?? false,
            include: defaultLogFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          name: "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
          fn: vi.fn(),
          chain: getChain(),
          type: "contract",
          abiItem: getAbiItem({ abi: erc20ABI, name: "Transfer" }),
          metadata: {
            safeName:
              "Transfer(address indexed from, address indexed to, uint256 amount)",
            abi: erc20ABI,
          },
        },
      ] satisfies [EventCallback]);

  const setupCallbacks = [
    {
      name: "Erc20:setup",
      fn: vi.fn(),
      chain: getChain(),
      block: undefined,
    },
  ] satisfies [SetupCallback];

  const indexingFunctions = params.includeCallTraces
    ? [
        {
          name: "Erc20.transfer()",
          fn: vi.fn(),
        },
        {
          name: "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
          fn: vi.fn(),
        },
        {
          name: "Erc20:setup",
          fn: vi.fn(),
        },
      ]
    : [
        {
          name: "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
          fn: vi.fn(),
        },
        {
          name: "Erc20:setup",
          fn: vi.fn(),
        },
      ];

  const contracts = {
    Erc20: {
      abi: erc20ABI,
      address: params.address,
      startBlock: undefined,
      endBlock: undefined,
    },
  };

  // @ts-expect-error
  return { eventCallbacks, setupCallbacks, indexingFunctions, contracts };
};

export const getPairWithFactoryIndexingBuild = <
  includeCallTraces extends boolean = false,
>(params: {
  address: Address;
  includeCallTraces?: includeCallTraces;
  includeTransactionReceipts?: boolean;
}): includeCallTraces extends true
  ? {
      eventCallbacks: [EventCallback, EventCallback];
      setupCallbacks: [SetupCallback];
      indexingFunctions: IndexingFunctions;
      contracts: { [name: string]: Contract };
    }
  : {
      eventCallbacks: [EventCallback];
      setupCallbacks: [SetupCallback];
      indexingFunctions: IndexingFunctions;
      contracts: { [name: string]: Contract };
    } => {
  const pairAddress = buildLogFactory({
    chainId: 1,
    sourceId: "Pair",
    fromBlock: undefined,
    toBlock: undefined,
    ...factory({
      address: params.address,
      event: getAbiItem({ abi: factoryABI, name: "PairCreated" }),
      parameter: "pair",
    }),
  }) satisfies FilterAddress<Factory>;

  const eventCallbacks = params.includeCallTraces
    ? ([
        {
          filter: {
            type: "trace",
            chainId: 1,
            sourceId: "Pair",
            fromAddress: undefined,
            toAddress: pairAddress,
            callType: "CALL",
            functionSelector: toFunctionSelector(
              getAbiItem({ abi: pairABI, name: "swap" }),
            ),
            fromBlock: undefined,
            toBlock: undefined,
            hasTransactionReceipt: params.includeTransactionReceipts ?? false,
            include: defaultTraceFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          name: "Pair.swap()",
          fn: vi.fn(),
          chain: getChain(),
          type: "contract",
          abiItem: getAbiItem({ abi: pairABI, name: "swap" }),
          metadata: {
            safeName: "swap()",
            abi: pairABI,
          },
        },
        {
          filter: {
            type: "log",
            chainId: 1,
            sourceId: "Pair",
            address: pairAddress,
            topic0: toEventSelector(getAbiItem({ abi: pairABI, name: "Swap" })),
            topic1: null,
            topic2: null,
            topic3: null,
            fromBlock: undefined,
            toBlock: undefined,
            hasTransactionReceipt: params.includeTransactionReceipts ?? false,
            include: defaultLogFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          name: "Pair:Swap",
          fn: vi.fn(),
          chain: getChain(),
          type: "contract",
          abiItem: getAbiItem({ abi: pairABI, name: "Swap" }),
          metadata: {
            safeName: "Swap",
            abi: pairABI,
          },
        },
      ] satisfies [EventCallback, EventCallback])
    : ([
        {
          filter: {
            type: "log",
            chainId: 1,
            sourceId: "Pair",
            address: pairAddress,
            topic0: toEventSelector(getAbiItem({ abi: pairABI, name: "Swap" })),
            topic1: null,
            topic2: null,
            topic3: null,
            fromBlock: undefined,
            toBlock: undefined,
            hasTransactionReceipt: params.includeTransactionReceipts ?? false,
            include: defaultLogFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          name: "Pair:Swap",
          fn: vi.fn(),
          chain: getChain(),
          type: "contract",
          abiItem: getAbiItem({ abi: pairABI, name: "Swap" }),
          metadata: {
            safeName: "Swap",
            abi: pairABI,
          },
        },
      ] satisfies [EventCallback]);

  const setupCallbacks = [
    {
      name: "Pair:setup",
      fn: vi.fn(),
      chain: getChain(),
      block: undefined,
    },
  ] satisfies [SetupCallback];

  const indexingFunctions = params.includeCallTraces
    ? ([
        { name: "Pair.swap()", fn: vi.fn() },
        { name: "Pair:Swap", fn: vi.fn() },
        { name: "Pair:setup", fn: vi.fn() },
      ] satisfies [
        IndexingFunctions[number],
        IndexingFunctions[number],
        IndexingFunctions[number],
      ])
    : ([
        { name: "Pair:Swap", fn: vi.fn() },
        { name: "Pair:setup", fn: vi.fn() },
      ] satisfies [IndexingFunctions[number], IndexingFunctions[number]]);

  const contracts = {
    Pair: {
      abi: pairABI,
      address: params.address,
      startBlock: undefined,
      endBlock: undefined,
    },
  };

  // @ts-expect-error
  return { eventCallbacks, setupCallbacks, indexingFunctions, contracts };
};

export const getBlocksIndexingBuild = (params: {
  interval: number;
}): {
  indexingFunctions: [IndexingFunctions[number]];
  eventCallbacks: [EventCallback];
} => {
  const eventCallbacks = [
    {
      filter: {
        type: "block",
        chainId: 1,
        sourceId: "Blocks",
        interval: params.interval,
        offset: 0,
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: false,
        include: defaultBlockFilterInclude,
      },
      name: "Blocks:block",
      fn: vi.fn(),
      chain: getChain(),
      type: "block",
    },
  ] satisfies [EventCallback];

  const indexingFunctions = [{ name: "Blocks:block", fn: vi.fn() }] satisfies [
    IndexingFunctions[number],
  ];

  return { eventCallbacks, indexingFunctions };
};

export const getAccountsIndexingBuild = (params: {
  address: Address;
}): {
  eventCallbacks: [EventCallback, EventCallback, EventCallback, EventCallback];
  indexingFunctions: IndexingFunctions;
} => {
  const eventCallbacks = [
    {
      filter: {
        type: "transaction",
        chainId: 1,
        sourceId: "Accounts",
        fromAddress: undefined,
        toAddress: toLowerCase(params.address),
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: true,
        include: defaultTransactionFilterInclude,
      } satisfies TransactionFilter,
      name: "Accounts:transaction:to",
      fn: vi.fn(),
      chain: getChain(),
      type: "account",
      direction: "to",
    },
    {
      filter: {
        type: "transaction",
        chainId: 1,
        sourceId: "Accounts",
        fromAddress: toLowerCase(params.address),
        toAddress: undefined,
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: true,
        include: defaultTransactionFilterInclude,
      } satisfies TransactionFilter,
      name: "Accounts:transaction:from",
      fn: vi.fn(),
      chain: getChain(),
      type: "account",
      direction: "from",
    },
    {
      filter: {
        type: "transfer",
        chainId: 1,
        sourceId: "Accounts",
        fromAddress: undefined,
        toAddress: toLowerCase(params.address),
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: false,
        include: defaultTransferFilterInclude,
      },
      name: "Accounts:transfer:to",
      fn: vi.fn(),
      chain: getChain(),
      type: "account",
      direction: "to",
    },
    {
      filter: {
        type: "transfer",
        chainId: 1,
        sourceId: "Accounts",
        fromAddress: toLowerCase(params.address),
        toAddress: undefined,
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: false,
        include: defaultTransferFilterInclude,
      },
      name: "Accounts:transfer:from",
      fn: vi.fn(),
      chain: getChain(),
      type: "account",
      direction: "from",
    },
  ] satisfies [EventCallback, EventCallback, EventCallback, EventCallback];

  const indexingFunctions = [
    { name: "Accounts:transaction:from", fn: vi.fn() },
    { name: "Accounts:transaction:to", fn: vi.fn() },
    { name: "Accounts:transfer:from", fn: vi.fn() },
    { name: "Accounts:transfer:to", fn: vi.fn() },
  ] satisfies [
    IndexingFunctions[number],
    IndexingFunctions[number],
    IndexingFunctions[number],
    IndexingFunctions[number],
  ];

  return { eventCallbacks, indexingFunctions };
};

export const getChain = (params?: {
  reorgWindow?: number;
  cacheRpcRequests?: boolean;
}) => {
  return {
    name: "mainnet",
    id: 1,
    rpc: "http://127.0.0.1:8545",
    ws: undefined,
    pollingInterval: 1_000,
    reorgWindow: params?.reorgWindow ?? 1,
    cacheRpcRequests: params?.cacheRpcRequests ?? true,
    ethGetLogsBlockRange: undefined,
    viemChain: mainnet,
  } satisfies Chain;
};
