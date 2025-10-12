import { type AddressInfo, createServer } from "node:net";
import { buildLogFactory } from "@/build/factory.js";
import { factory } from "@/config/address.js";
import type {
  Chain,
  EventCallback,
  Factory,
  FilterAddress,
  IndexingFunctions,
  LogEvent,
  SetupCallback,
  Source,
  Status,
  SyncBlock,
  SyncLog,
  SyncTransaction,
  SyncTransactionReceipt,
  TransactionFilter,
} from "@/internal/types.js";
import {
  syncBlockToInternal,
  syncLogToInternal,
  syncTransactionReceiptToInternal,
  syncTransactionToInternal,
} from "@/runtime/events.js";
import {
  defaultBlockFilterInclude,
  defaultLogFilterInclude,
  defaultTraceFilterInclude,
  defaultTransactionFilterInclude,
  defaultTransactionReceiptInclude,
  defaultTransferFilterInclude,
} from "@/runtime/filter.js";
import { EVENT_TYPES, encodeCheckpoint } from "@/utils/checkpoint.js";
import { decodeEventLog } from "@/utils/decodeEventLog.js";
import {
  type Address,
  type Chain as ViemChain,
  hexToNumber,
  toEventSelector,
} from "viem";
import { http, createPublicClient, createTestClient, getAbiItem } from "viem";
import { mainnet } from "viem/chains";
import { vi } from "vitest";
import { erc20ABI, factoryABI, pairABI } from "./generated.js";

// Anvil test setup adapted from @viem/anvil `example-vitest` repository.
// https://github.com/wagmi-dev/anvil.js/tree/main/examples/example-vitest

// ID of the current test worker. Used by the `@viem/anvil` proxy server.
export const poolId = Number(process.env.VITEST_POOL_ID ?? 1);

export const anvil = {
  ...mainnet, // We are using a mainnet fork for testing.
  id: 1, // We configured our anvil instance to use `1` as the chain id (see `globalSetup.ts`);
  rpcUrls: {
    default: {
      http: [`http://127.0.0.1:8545/${poolId}`],
      webSocket: [`ws://127.0.0.1:8545/${poolId}`],
    },
    public: {
      http: [`http://127.0.0.1:8545/${poolId}`],
      webSocket: [`ws://127.0.0.1:8545/${poolId}`],
    },
  },
} as const satisfies ViemChain;

export const testClient = createTestClient({
  chain: anvil,
  mode: "anvil",
  transport: http(),
});

export const publicClient = createPublicClient({
  chain: anvil,
  transport: http(),
});

export const getErc20IndexingBuild = <
  includeCallTraces extends boolean = false,
>(params: {
  address: Address;
  includeCallTraces?: includeCallTraces;
  includeTransactionReceipts?: boolean;
}): includeCallTraces extends true
  ? {
      indexingFunctions: [
        IndexingFunctions[number],
        IndexingFunctions[number],
        IndexingFunctions[number],
      ];
      eventCallbacks: [EventCallback, EventCallback];
      setupCallbacks: [SetupCallback];
      sources: [Source];
    }
  : {
      indexingFunctions: [IndexingFunctions[number], IndexingFunctions[number]];
      eventCallbacks: [EventCallback];
      setupCallbacks: [SetupCallback];
      sources: [Source];
    } => {
  const indexingFunctions = params.includeCallTraces
    ? ([
        { name: "Erc20.transfer()", fn: vi.fn() },
        {
          name: "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
          fn: vi.fn(),
        },
        { name: "Erc20:setup", fn: vi.fn() },
      ] satisfies IndexingFunctions)
    : ([
        {
          name: "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
          fn: vi.fn(),
        },
        { name: "Erc20:setup", fn: vi.fn() },
      ] satisfies IndexingFunctions);

  const eventCallbacks = params.includeCallTraces
    ? ([
        {
          filter: {
            type: "trace",
            chainId: 1,
            fromAddress: undefined,
            toAddress: params.address,
            callType: "CALL",
            functionSelector: toEventSelector(
              getAbiItem({ abi: erc20ABI, name: "transfer" }),
            ),
            includeReverted: false,
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
            address: params.address,
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
            address: params.address,
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

  const sources = [
    {
      name: "Erc20",
      type: "contract",
      chain: "mainnet",
      address: params.address,
      startBlock: undefined,
      endBlock: undefined,
      abi: erc20ABI,
      includeCallTraces: params.includeCallTraces,
      includeTransactionReceipts: params.includeTransactionReceipts,
    },
  ] satisfies [Source];

  // @ts-ignore
  return { indexingFunctions, eventCallbacks, setupCallbacks, sources };
};

export const getErc20LogEvent = ({
  blockData,
  eventCallback,
}: {
  blockData: {
    block: SyncBlock;
    transaction: SyncTransaction;
    transactionReceipt: SyncTransactionReceipt;
    log: SyncLog;
  };
  eventCallback: EventCallback;
}): LogEvent => {
  const checkpoint = encodeCheckpoint({
    blockTimestamp: hexToNumber(blockData.block.timestamp),
    chainId: anvil.id,
    blockNumber: hexToNumber(blockData.block.number),
    transactionIndex: hexToNumber(blockData.transaction.transactionIndex),
    eventType: EVENT_TYPES.logs,
    eventIndex: 0,
  });
  return {
    type: "log",
    chain: getChain(),
    eventCallback,
    checkpoint,
    event: {
      id: checkpoint,
      args: decodeEventLog({
        // @ts-ignore
        abiItem: eventCallback.abiItem,
        topics: blockData.log.topics,
        data: blockData.log.data,
      }),
      block: syncBlockToInternal({ block: blockData.block }),
      transaction: syncTransactionToInternal({
        transaction: blockData.transaction,
      }),
      transactionReceipt: eventCallback.filter.hasTransactionReceipt
        ? syncTransactionReceiptToInternal({
            transactionReceipt: blockData.transactionReceipt,
          })
        : undefined,
      log: syncLogToInternal({ log: blockData.log }),
    },
  };
};

export const getPairWithFactoryIndexingBuild = <
  includeCallTraces extends boolean = false,
>(params: {
  address: Address;
  includeCallTraces?: includeCallTraces;
  includeTransactionReceipts?: boolean;
}): includeCallTraces extends true
  ? {
      indexingFunctions: [
        IndexingFunctions[number],
        IndexingFunctions[number],
        IndexingFunctions[number],
      ];
      eventCallbacks: [EventCallback, EventCallback];
      setupCallbacks: [SetupCallback];
      sources: [Source];
    }
  : {
      indexingFunctions: [IndexingFunctions[number], IndexingFunctions[number]];
      eventCallbacks: [EventCallback];
      setupCallbacks: [SetupCallback];
      sources: [Source];
    } => {
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

  const pairAddress = buildLogFactory({
    chainId: 1,
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
            fromAddress: undefined,
            toAddress: pairAddress,
            callType: "CALL",
            functionSelector: toEventSelector(
              getAbiItem({ abi: pairABI, name: "swap" }),
            ),
            includeReverted: false,
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

  const sources = [
    {
      name: "Pair",
      type: "contract",
      chain: "mainnet",
      startBlock: undefined,
      endBlock: undefined,
      abi: pairABI,
      includeCallTraces: params.includeCallTraces,
      includeTransactionReceipts: params.includeTransactionReceipts,
    },
  ] satisfies [Source];

  // @ts-ignore
  return { indexingFunctions, eventCallbacks, setupCallbacks, sources };
};

export const getBlocksIndexingBuild = (params: {
  interval: number;
}): {
  indexingFunctions: [IndexingFunctions[number]];
  eventCallbacks: [EventCallback];
  sources: [Source];
} => {
  const indexingFunctions = [{ name: "Blocks:block", fn: vi.fn() }] satisfies [
    IndexingFunctions[number],
  ];

  const eventCallbacks = [
    {
      filter: {
        type: "block",
        chainId: 1,
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

  const sources = [
    {
      name: "Blocks",
      type: "block",
      chain: "mainnet",
      startBlock: undefined,
      endBlock: undefined,
    },
  ] satisfies [Source];

  // @ts-ignore
  return { indexingFunctions, eventCallbacks, sources };
};

export const getAccountsIndexingBuild = (params: {
  address: Address;
}): {
  indexingFunctions: [
    IndexingFunctions[number],
    IndexingFunctions[number],
    IndexingFunctions[number],
    IndexingFunctions[number],
  ];
  eventCallbacks: [EventCallback, EventCallback, EventCallback, EventCallback];
  sources: [Source];
} => {
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

  const eventCallbacks = [
    {
      filter: {
        type: "transaction",
        chainId: 1,
        fromAddress: undefined,
        toAddress: params.address,
        includeReverted: false,
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
        fromAddress: params.address,
        toAddress: undefined,
        includeReverted: false,
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
        fromAddress: undefined,
        toAddress: params.address,
        includeReverted: false,
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
        fromAddress: params.address,
        toAddress: undefined,
        includeReverted: false,
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

  const sources = [
    {
      name: "Accounts",
      type: "account",
      chain: "mainnet",
      address: params.address,
      startBlock: undefined,
      endBlock: undefined,
    },
  ] satisfies [Source];

  return { indexingFunctions, eventCallbacks, sources };
};

export const getChain = (params?: {
  finalityBlockCount?: number;
}) => {
  return {
    name: "mainnet",
    id: 1,
    rpc: `http://127.0.0.1:8545/${poolId}`,
    pollingInterval: 1_000,
    finalityBlockCount: params?.finalityBlockCount ?? 1,
    disableCache: false,
    viemChain: anvil,
  } satisfies Chain;
};

export function getFreePort(): Promise<number> {
  return new Promise((res) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => res(port));
    });
  });
}

export async function waitForIndexedBlock({
  port,
  chainName,
  block,
}: {
  port: number;
  chainName: string;
  block: { number: number };
}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out while waiting for the indexed block."));
    }, 5_000);
    const interval = setInterval(async () => {
      const response = await fetch(`http://localhost:${port}/status`);
      if (response.status === 200) {
        const status = (await response.json()) as Status;
        const sb = status[chainName]?.block;
        if (sb !== undefined && sb.number >= block.number) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve(undefined);
        }
      }
    }, 20);
  });
}
