import { type AddressInfo, createServer } from "node:net";
import { createConfig } from "@/config/config.js";
import type { Network } from "@/config/networks.js";
import type { Status } from "@/sync/index.js";
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
        factory: {
          address: params.address,
          event: getAbiItem({ abi: factoryABI, name: "PairCreated" }),
          parameter: "pair",
        },
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

export async function waitForIndexedBlock(
  port: number,
  networkName: string,
  blockNumber: number,
) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out while waiting for the indexed block."));
    }, 5_000);
    const interval = setInterval(async () => {
      const response = await fetch(`http://localhost:${port}/status`);
      if (response.status === 200) {
        const status = (await response.json()) as Status | null;
        const statusBlockNumber = status
          ? status[networkName]?.block?.number
          : undefined;
        if (
          statusBlockNumber !== undefined &&
          statusBlockNumber >= blockNumber
        ) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve(undefined);
        }
      }
    }, 20);
  });
}

export async function postGraphql(port: number, query: string) {
  const response = await fetch(`http://localhost:${port}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: `query { ${query} }` }),
  });
  return response;
}

export async function getMetrics(port: number) {
  const response = await fetch(`http://localhost:${port}/metrics`);
  return await response.text();
}
