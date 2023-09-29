import {
  type Chain,
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
} from "viem";
import { mainnet } from "viem/chains";

// Anvil test setup adapted from @viem/anvil `example-vitest` repository.
// https://github.com/wagmi-dev/anvil.js/tree/main/examples/example-vitest

if (!process.env.ANVIL_FORK_URL) {
  throw new Error('Missing environment variable "ANVIL_FORK_URL"');
}
export const FORK_URL = process.env.ANVIL_FORK_URL;

if (!process.env.ANVIL_FORK_BLOCK_NUMBER) {
  throw new Error('Missing environment variable "ANVIL_FORK_BLOCK_NUMBER"');
}
export const FORK_BLOCK_NUMBER = BigInt(
  Number(process.env.ANVIL_FORK_BLOCK_NUMBER)
);

export const anvil = {
  ...mainnet, // We are using a mainnet fork for testing.
  id: 1, // We configured our anvil instance to use `1` as the chain id (see `globalSetup.ts`);
  rpcUrls: {
    default: {
      http: [`http://127.0.0.1:8545`],
      webSocket: [`ws://127.0.0.1:8545`],
    },
    public: {
      http: [`http://127.0.0.1:8545`],
      webSocket: [`ws://127.0.0.1:8545`],
    },
  },
} as Chain;

export const testNetworkConfig = {
  name: "mainnet",
  chainId: anvil.id,
  transport: http(anvil.rpcUrls.default.http[0]),
  pollingInterval: 500,
};

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
});
