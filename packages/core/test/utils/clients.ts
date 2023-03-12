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

export async function setup() {
  await testClient.reset({
    blockNumber: BigInt(parseInt(process.env.ANVIL_BLOCK_NUMBER!)),
    jsonRpcUrl: process.env.ANVIL_FORK_URL,
  });

  await testClient.setAutomine(false);
  await testClient.setIntervalMining({ interval: 0 });
}
