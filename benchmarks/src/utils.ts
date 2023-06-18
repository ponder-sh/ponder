import {
  type Chain,
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
} from "viem";
import { mainnet } from "viem/chains";

import { FORK_BLOCK_NUMBER, FORK_URL, vitalik } from "./constants";

// Anvil test setup adapted from @viem/anvil `example-vitest` repository.
// https://github.com/wagmi-dev/anvil.js/tree/main/examples/example-vitest

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
  rpcUrl: anvil.rpcUrls.default.http[0],
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

/**
 * Resets the Anvil instance to the defaults.
 *
 * ```ts
 * // Add this to any test suite that uses the test client.
 * beforeEach(async () => {
 *   return await resetTestClient();
 * })
 * ```
 */
export async function resetTestClient() {
  await testClient.impersonateAccount({ address: vitalik.address });
  await testClient.setAutomine(false);

  return async () => {
    await testClient.reset({
      jsonRpcUrl: FORK_URL,
      blockNumber: FORK_BLOCK_NUMBER,
    });
  };
}
