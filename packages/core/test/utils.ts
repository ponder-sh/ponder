import { createPublicClient, createTestClient, http } from "viem";
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

export const testClient = createTestClient({
  chain: anvilChain,
  mode: "anvil",
  transport: http(),
});

export async function setup() {
  await testClient.reset({
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    blockNumber: BigInt(parseInt(process.env.ANVIL_BLOCK_NUMBER!)),
    jsonRpcUrl: process.env.ANVIL_FORK_URL,
  });
  await testClient.setAutomine(false);
  await testClient.setIntervalMining({ interval: 1 });
}
