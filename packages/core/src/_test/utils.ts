import { type AddressInfo, createServer } from "node:net";
import { factory } from "@/config/address.js";
import { createConfig } from "@/config/index.js";
import type { Network, Status } from "@/internal/types.js";
import type { Address, Chain } from "viem";
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
} as const satisfies Chain;

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
    networks: {
      mainnet: {
        chainId: 1,
        transport: http(`http://127.0.0.1:8545/${poolId}`),
      },
    },
    contracts: {
      Erc20: {
        abi: erc20ABI,
        network: "mainnet",
        address: params.address,
        includeCallTraces: params.includeCallTraces,
        includeTransactionReceipts: params.includeTransactionReceipts,
      },
    },
  });

  const rawIndexingFunctions = params.includeCallTraces
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

  return { config, rawIndexingFunctions };
};

export const getPairWithFactoryConfigAndIndexingFunctions = (params: {
  address: Address;
  includeCallTraces?: boolean;
  includeTransactionReceipts?: boolean;
}) => {
  const config = createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http(`http://127.0.0.1:8545/${poolId}`),
      },
    },
    contracts: {
      Pair: {
        abi: pairABI,
        network: "mainnet",
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
    networks: {
      mainnet: {
        chainId: 1,
        transport: http(`http://127.0.0.1:8545/${poolId}`),
      },
    },
    blocks: {
      Blocks: {
        network: "mainnet",
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
    networks: {
      mainnet: {
        chainId: 1,
        transport: http(`http://127.0.0.1:8545/${poolId}`),
      },
    },
    accounts: {
      Accounts: {
        network: "mainnet",
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

export const getNetwork = (params?: {
  finalityBlockCount?: number;
}) => {
  return {
    name: "mainnet",
    chainId: 1,
    chain: anvil,
    transport: http(`http://127.0.0.1:8545/${poolId}`)({ chain: anvil }),
    maxRequestsPerSecond: 50,
    pollingInterval: 1_000,
    finalityBlockCount: params?.finalityBlockCount ?? 1,
    disableCache: false,
  } satisfies Network;
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
  chainId,
  block,
}: {
  port: number;
  chainId: number;
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
        const sb = status?.find((s) => s.chainId === chainId)?.block;
        if (sb !== undefined && sb.number >= block.number) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve(undefined);
        }
      }
    }, 20);
  });
}
