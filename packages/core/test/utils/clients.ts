import { createPublicClient, createTestClient, http } from "viem";
import { localhost, mainnet } from "viem/chains";
import { reset, setAutomine, setIntervalMining } from "viem/test";

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
  await reset(testClient, {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    blockNumber: BigInt(parseInt(process.env.ANVIL_BLOCK_NUMBER!)),
    jsonRpcUrl: process.env.ANVIL_FORK_URL,
  });
  await setAutomine(testClient, false);
  await setIntervalMining(testClient, { interval: 0 });
}
