import { type AddressInfo, createServer } from "node:net";
import { factory } from "@/config/address.js";
import { createConfig } from "@/config/index.js";
import type { Chain, EventCallback, Source, Status } from "@/internal/types.js";
import {
  defaultLogFilterInclude,
  defaultTraceFilterInclude,
  defaultTransactionReceiptInclude,
} from "@/runtime/filter.js";
import { type Address, type Chain as ViemChain, toEventSelector } from "viem";
import { http, createPublicClient, createTestClient, getAbiItem } from "viem";
import { mainnet } from "viem/chains";
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

export const getBlockNumber = async () =>
  publicClient.getBlockNumber().then(Number);

export const getErc20ConfigAndIndexingFunctions = (params: {
  address: Address;
  includeCallTraces?: boolean;
  includeTransactionReceipts?: boolean;
}) => {
  const config = createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: `http://127.0.0.1:8545/${poolId}`,
      },
    },
    contracts: {
      Erc20: {
        abi: erc20ABI,
        chain: "mainnet",
        address: params.address,
        includeCallTraces: params.includeCallTraces,
        includeTransactionReceipts: params.includeTransactionReceipts,
      },
    },
  });

  const indexingFunctions = params.includeCallTraces
    ? [
        { name: "Erc20.transfer()", fn: () => {} },
        {
          name: "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
          fn: () => {},
        },
      ]
    : [
        {
          name: "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
          fn: () => {},
        },
      ];

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
              getAbiItem({ abi: erc20ABI, name: "Transfer" }),
            ),
            includeReverted: false,
            fromBlock: undefined,
            toBlock: undefined,
            hasTransactionReceipt: false,
            include: defaultTraceFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          name: "Erc20.transfer()",
          fn: () => {},
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
            hasTransactionReceipt: false,
            include: defaultLogFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          name: "Erc20.transfer()",
          fn: () => {},
          chain: getChain(),
          type: "contract",
          abiItem: getAbiItem({ abi: erc20ABI, name: "transfer" }),
          metadata: {
            safeName: "transfer()",
            abi: erc20ABI,
          },
        },
      ] satisfies [EventCallback, EventCallback])
    : ([
        {
          filter: {
            type: "trace",
            chainId: 1,
            fromAddress: undefined,
            toAddress: params.address,
            callType: "CALL",
            functionSelector: toEventSelector(
              getAbiItem({ abi: erc20ABI, name: "Transfer" }),
            ),
            includeReverted: false,
            fromBlock: undefined,
            toBlock: undefined,
            hasTransactionReceipt: false,
            include: defaultTraceFilterInclude.concat(
              params.includeTransactionReceipts
                ? defaultTransactionReceiptInclude.map(
                    (value) => `transactionReceipt.${value}` as const,
                  )
                : [],
            ),
          },
          name: "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
          fn: () => {},
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

  const sources = [
    {
      name: "Erc20",
      type: "contract",
      chain: "mainnet",
      startBlock: undefined,
      endBlock: undefined,
      abi: erc20ABI,
      includeCallTraces: params.includeCallTraces,
      includeTransactionReceipts: params.includeTransactionReceipts,
    },
  ] satisfies [Source];

  return { config, indexingFunctions, eventCallbacks, sources };
};

export const getPairWithFactoryConfigAndIndexingFunctions = (params: {
  address: Address;
  includeCallTraces?: boolean;
  includeTransactionReceipts?: boolean;
}) => {
  const config = createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: `http://127.0.0.1:8545/${poolId}`,
      },
    },
    contracts: {
      Pair: {
        abi: pairABI,
        chain: "mainnet",
        address: factory({
          address: params.address,
          event: getAbiItem({ abi: factoryABI, name: "PairCreated" }),
          parameter: "pair",
        }),
        includeCallTraces: params.includeCallTraces,
        includeTransactionReceipts: params.includeTransactionReceipts,
      },
    },
  });

  const rawIndexingFunctions = params.includeCallTraces
    ? [
        { name: "Pair.swap()", fn: () => {} },
        { name: "Pair:Swap", fn: () => {} },
      ]
    : [{ name: "Pair:Swap", fn: () => {} }];

  return { config, rawIndexingFunctions };
};

export const getBlocksConfigAndIndexingFunctions = (params: {
  interval: number;
}) => {
  const config = createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: `http://127.0.0.1:8545/${poolId}`,
      },
    },
    blocks: {
      Blocks: {
        chain: "mainnet",
        interval: params.interval,
      },
    },
  });

  const rawIndexingFunctions = [{ name: "Blocks:block", fn: () => {} }];

  return { config, rawIndexingFunctions };
};

export const getAccountsConfigAndIndexingFunctions = (params: {
  address: Address;
}) => {
  const config = createConfig({
    chains: {
      mainnet: {
        id: 1,
        rpc: `http://127.0.0.1:8545/${poolId}`,
      },
    },
    accounts: {
      Accounts: {
        chain: "mainnet",
        address: params.address,
      },
    },
  });

  const rawIndexingFunctions = [
    { name: "Accounts:transaction:from", fn: () => {} },
    { name: "Accounts:transaction:to", fn: () => {} },
    { name: "Accounts:transfer:from", fn: () => {} },
    { name: "Accounts:transfer:to", fn: () => {} },
  ];

  return { config, rawIndexingFunctions };
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
