import type { Address, Chain } from "viem";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
} from "viem";
import { mainnet } from "viem/chains";

import { type Config, createConfig } from "@/config/config.js";
import { buildNetwork } from "@/config/networks.js";
import { buildSources, type Source } from "@/config/sources.js";
import type { Common } from "@/Ponder.js";

import { ALICE } from "./constants.js";
import { erc20ABI } from "./generated.js";

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

export const walletClient = createWalletClient({
  chain: anvil,
  transport: http(),
  account: ALICE,
});

export const config = (erc20Address: Address): Config =>
  createConfig({
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
        address: erc20Address,
      },
    },
  });

export const networks = [
  buildNetwork({
    networkName: "mainnet",
    network: { chainId: 1, transport: http(`http://127.0.0.1:8545/${poolId}`) },
    common: { logger: { warn: () => {} } } as unknown as Common,
  }),
];

export const sources = (erc20Address: Address): Source[] =>
  buildSources({ config: config(erc20Address) });
