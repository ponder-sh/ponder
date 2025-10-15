import { type AddressInfo, createServer } from "node:net";
import { buildLogFactory } from "@/build/factory.js";
import { factory } from "@/config/address.js";
import type { Common } from "@/internal/common.js";
import type {
  AccountMetadata,
  AccountSource,
  BlockSource,
  Chain,
  ContractMetadata,
  ContractSource,
  Event,
  Factory,
  FilterAddress,
  IndexingFunctions,
  LogFactory,
  Source,
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
import { buildAbiEvents, buildAbiFunctions } from "@/utils/abi.js";
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
      sources: [
        ContractSource<"trace", undefined, undefined, undefined>,
        ContractSource<"log", undefined, undefined, undefined>,
      ];
      indexingFunctions: IndexingFunctions;
    }
  : {
      sources: [ContractSource<"log", undefined, undefined, undefined>];
      indexingFunctions: IndexingFunctions;
    } => {
  const contractMetadata = {
    type: "contract",
    abi: erc20ABI,
    abiEvents: buildAbiEvents({ abi: erc20ABI }),
    abiFunctions: buildAbiFunctions({ abi: erc20ABI }),
    name: "Erc20",
    chain: getChain(),
  } satisfies ContractMetadata;

  const sources = params.includeCallTraces
    ? ([
        {
          filter: {
            type: "trace",
            chainId: 1,
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
          ...contractMetadata,
        },
        {
          filter: {
            type: "log",
            chainId: 1,
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
          ...contractMetadata,
        },
      ] satisfies [ContractSource, ContractSource])
    : ([
        {
          filter: {
            type: "log",
            chainId: 1,
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
          ...contractMetadata,
        },
      ] satisfies [ContractSource]);

  const indexingFunctions = params.includeCallTraces
    ? {
        "Erc20.transfer()": vi.fn(),
        "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
          vi.fn(),
        "Erc20:setup": vi.fn(),
      }
    : {
        "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)":
          vi.fn(),
        "Erc20:setup": vi.fn(),
      };

  // @ts-ignore
  return { sources, indexingFunctions };
};

export const getPairWithFactoryIndexingBuild = <
  includeCallTraces extends boolean = false,
>(params: {
  address: Address;
  includeCallTraces?: includeCallTraces;
  includeTransactionReceipts?: boolean;
}): includeCallTraces extends true
  ? {
      sources: [
        ContractSource<"trace", undefined, undefined, LogFactory>,
        ContractSource<"log", LogFactory, undefined, undefined>,
      ];
      indexingFunctions: IndexingFunctions;
    }
  : {
      sources: [ContractSource<"log", LogFactory, undefined, undefined>];
      indexingFunctions: IndexingFunctions;
    } => {
  const contractMetadata = {
    type: "contract",
    abi: pairABI,
    abiEvents: buildAbiEvents({ abi: pairABI }),
    abiFunctions: buildAbiFunctions({ abi: pairABI }),
    name: "Pair",
    chain: getChain(),
  } satisfies ContractMetadata;

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

  const sources = params.includeCallTraces
    ? ([
        {
          filter: {
            type: "trace",
            chainId: 1,
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
          ...contractMetadata,
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
          ...contractMetadata,
        },
      ] satisfies [ContractSource, ContractSource])
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
          ...contractMetadata,
        },
      ] satisfies [ContractSource]);

  const indexingFunctions = params.includeCallTraces
    ? {
        "Pair.swap()": vi.fn(),
        "Pair:Swap": vi.fn(),
        "Pair:setup": vi.fn(),
      }
    : {
        "Pair:Swap": vi.fn(),
        "Pair:setup": vi.fn(),
      };

  // @ts-ignore
  return { sources, indexingFunctions };
};

export const getBlocksIndexingBuild = (params: {
  interval: number;
}): {
  sources: [BlockSource];
  indexingFunctions: IndexingFunctions;
} => {
  const sources = [
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
      type: "block",
      name: "Blocks",
      chain: getChain(),
    },
  ] satisfies [BlockSource];

  const indexingFunctions = {
    "Blocks:block": vi.fn(),
  };

  return { sources, indexingFunctions };
};

export const getAccountsIndexingBuild = (params: {
  address: Address;
}): {
  sources: [
    AccountSource<"transaction", undefined, undefined>,
    AccountSource<"transaction", undefined, undefined>,
    AccountSource<"transfer", undefined, undefined>,
    AccountSource<"transfer", undefined, undefined>,
  ];
  indexingFunctions: IndexingFunctions;
} => {
  const accountMetadata = {
    type: "account",
    name: "Accounts",
    chain: getChain(),
  } satisfies AccountMetadata;

  const sources = [
    {
      filter: {
        type: "transaction",
        chainId: 1,
        fromAddress: undefined,
        toAddress: toLowerCase(params.address),
        includeReverted: false,
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: true,
        include: defaultTransactionFilterInclude,
      } satisfies TransactionFilter,
      ...accountMetadata,
    },
    {
      filter: {
        type: "transaction",
        chainId: 1,
        fromAddress: toLowerCase(params.address),
        toAddress: undefined,
        includeReverted: false,
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: true,
        include: defaultTransactionFilterInclude,
      } satisfies TransactionFilter,
      ...accountMetadata,
    },
    {
      filter: {
        type: "transfer",
        chainId: 1,
        fromAddress: undefined,
        toAddress: toLowerCase(params.address),
        includeReverted: false,
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: false,
        include: defaultTransferFilterInclude,
      },
      ...accountMetadata,
    },
    {
      filter: {
        type: "transfer",
        chainId: 1,
        fromAddress: toLowerCase(params.address),
        toAddress: undefined,
        includeReverted: false,
        fromBlock: undefined,
        toBlock: undefined,
        hasTransactionReceipt: false,
        include: defaultTransferFilterInclude,
      },
      ...accountMetadata,
    },
  ] satisfies [AccountSource, AccountSource, AccountSource, AccountSource];

  const indexingFunctions = {
    "Accounts:transaction:from": vi.fn(),
    "Accounts:transaction:to": vi.fn(),
    "Accounts:transfer:from": vi.fn(),
    "Accounts:transfer:to": vi.fn(),
  };

  return { sources, indexingFunctions };
};

export const getSimulatedEvent = ({
  source,
  blockData,
}: {
  source: Source;
  blockData:
    | Awaited<ReturnType<typeof simulateBlock>>
    | Awaited<ReturnType<typeof mintErc20>>
    | Awaited<ReturnType<typeof transferErc20>>
    | Awaited<ReturnType<typeof transferEth>>
    | Awaited<ReturnType<typeof swapPair>>;
}): Event => {
  const rawEvents = buildEvents({
    sources: [source],
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

  const events = decodeEvents({} as Common, [source], rawEvents);

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
