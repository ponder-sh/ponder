import {
  type Chain,
  type HttpTransport,
  type PublicClient,
  type TestClient,
  type WalletClient,
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
} from "viem";
import { mainnet } from "viem/chains";

// Anvil test setup adapted from @viem/anvil `example-vitest` repository.
// https://github.com/wagmi-dev/anvil.js/tree/main/examples/example-vitest

// ID of the current test worker. Used by the `@viem/anvil` proxy server.
export const poolId = Number(process.env.VITEST_POOL_ID ?? 1);

export const anvil: Chain = {
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
};

export const testNetworkConfig = {
  name: "mainnet",
  chainId: anvil.id,
  transport: http(anvil.rpcUrls.default.http[0]),
  pollingInterval: 500,
};

export const testClient: TestClient<"anvil", HttpTransport, Chain> =
  createTestClient({
    chain: anvil,
    mode: "anvil",
    transport: http(),
  });

export const publicClient: PublicClient<HttpTransport, Chain> =
  createPublicClient({
    chain: anvil,
    transport: http(),
  });

export const walletClient: WalletClient<HttpTransport, Chain> =
  createWalletClient({
    chain: anvil,
    transport: http(),
  });
