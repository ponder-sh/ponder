import { type AddressInfo, Socket, createServer } from "node:net";
import { buildLogFactory } from "@/build/factory.js";
import { factory } from "@/config/address.js";
import type { Common } from "@/internal/common.js";
import type {
  Chain,
  Contract,
  Event,
  EventCallback,
  Factory,
  FilterAddress,
  IndexingFunctions,
  SetupCallback,
  Status,
  TransactionFilter,
} from "@/internal/types.js";
import {
  buildEvents,
  decodeEvents,
  syncBlockToInternal,
  syncLogToInternal,
  syncTraceToInternal,
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
import { toLowerCase } from "@/utils/lowercase.js";
import {
  type Address,
  type Chain as ViemChain,
  toEventSelector,
  toFunctionSelector,
} from "viem";
import { http, createPublicClient, createTestClient, getAbiItem } from "viem";
import { mainnet } from "viem/chains";
import { vi } from "vitest";
import { erc20ABI, factoryABI, pairABI } from "./generated.js";
import type {
  mintErc20,
  simulateBlock,
  swapPair,
  transferErc20,
  transferEth,
} from "./simulate.js";

// Anvil test setup adapted from @viem/anvil `example-vitest` repository.
// https://github.com/wagmi-dev/anvil.js/tree/main/examples/example-vitest

// ID of the current test worker. Used by the `@viem/anvil` proxy server.

export const poolId = Number(
  // process.env.VITEST_POOL_ID ?? Math.floor(Math.random() * 99999),
  process.env.VITEST_POOL_ID ?? 1,
);

export const isBunTest = "bun" in process.versions;

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

export function stubGlobal<Key extends keyof typeof globalThis>(
  key: Key,
  value: (typeof globalThis)[Key],
): () => void {
  const g = globalThis as any;

  const hadOwnProperty = Object.prototype.hasOwnProperty.call(g, key);
  const original = g[key];

  g[key] = value;

  return () => {
    if (hadOwnProperty) {
      g[key] = original;
    } else {
      // If it didn't exist before, remove it entirely
      delete g[key];
    }
  };
}

export const isListening = (port: number, host = "127.0.0.1") =>
  new Promise<boolean>((resolve) => {
    const socket = new Socket();

    // If it connects, something is listening
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    // If it errors with ECONNREFUSED, nothing is listening
    socket.once("error", () => {
      resolve(false);
    });

    // Timeout = treat as closed
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });

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

  // @ts-ignore
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

  // @ts-ignore
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
        sourceId: "Accounts",
        fromAddress: toLowerCase(params.address),
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
        sourceId: "Accounts",
        fromAddress: undefined,
        toAddress: toLowerCase(params.address),
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
        sourceId: "Accounts",
        fromAddress: toLowerCase(params.address),
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

export const getSimulatedEvent = ({
  eventCallback,
  blockData,
}: {
  eventCallback: EventCallback;
  blockData:
    | Awaited<ReturnType<typeof simulateBlock>>
    | Awaited<ReturnType<typeof mintErc20>>
    | Awaited<ReturnType<typeof transferErc20>>
    | Awaited<ReturnType<typeof transferEth>>
    | Awaited<ReturnType<typeof swapPair>>;
}): Event => {
  const rawEvents = buildEvents({
    eventCallbacks: [eventCallback],
    blocks: [syncBlockToInternal({ block: blockData.block })],
    // @ts-ignore
    logs: blockData.log ? [syncLogToInternal({ log: blockData.log })] : [],
    // @ts-ignore
    transactions: blockData.transaction
      ? // @ts-ignore
        [syncTransactionToInternal({ transaction: blockData.transaction })]
      : [],
    // @ts-ignore
    transactionReceipts: blockData.transactionReceipt
      ? [
          syncTransactionReceiptToInternal({
            // @ts-ignore
            transactionReceipt: blockData.transactionReceipt,
          }),
        ]
      : [],
    // @ts-ignore
    traces: blockData.trace
      ? // @ts-ignore
        [syncTraceToInternal({ trace: blockData.trace })]
      : [],
    childAddresses: new Map(),
    chainId: 1,
  });

  const events = decodeEvents(
    {} as Common,
    getChain(),
    [eventCallback],
    rawEvents,
  );

  if (events.length !== 1) {
    throw new Error("getSimulatedEvent() failed to construct the event");
  }

  return events[0]!;
};

export const getChain = (params?: {
  finalityBlockCount?: number;
}) => {
  return {
    name: "mainnet",
    id: 1,
    rpc: `http://127.0.0.1:8545/${poolId}`,
    ws: undefined,
    pollingInterval: 1_000,
    finalityBlockCount: params?.finalityBlockCount ?? 1,
    disableCache: false,
    ethGetLogsBlockRange: undefined,
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

export function getRejectionValue(func: () => Promise<any>): Promise<any> {
  return func()
    .then(() => {
      throw Error("expected promise to reject");
    })
    .catch((rejection) => {
      return rejection;
    });
}
