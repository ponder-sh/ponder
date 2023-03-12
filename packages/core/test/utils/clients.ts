import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
} from "viem";
import { localhost, mainnet } from "viem/chains";

const anvilChain = {
  ...localhost,
  id: 1,
  contracts: mainnet.contracts,
} as const;

export const publicClient = createPublicClient({
  chain: anvilChain,
  transport: http(),
});

export const walletClient = createWalletClient({
  chain: anvilChain,
  transport: http(localhost.rpcUrls.public.http[0]),
});

export const testClient = createTestClient({
  chain: anvilChain,
  mode: "anvil",
  transport: http(),
});
