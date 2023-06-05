import { createPublicClient, http, PublicClient } from "viem";
import { mainnet } from "viem/chains";

import { ResolvedPonderConfig } from "@/config/ponderConfig";

export type Network = {
  name: string;
  chainId: number;
  client: PublicClient;
  rpcUrl?: string;
  pollingInterval: number;
  defaultMaxBlockRange: number;
  finalityBlockCount: number;
};

const clients: Record<number, PublicClient | undefined> = {};

export function buildNetwork({
  network,
}: {
  network: ResolvedPonderConfig["networks"][0];
}) {
  let client = clients[network.chainId];

  if (!client) {
    client = createPublicClient({
      transport: http(network.rpcUrl),
      chain: {
        ...mainnet,
        name: network.name,
        id: network.chainId,
        network: network.name,
      },
    });
    clients[network.chainId] = client;
  }

  const resolvedNetwork: Network = {
    name: network.name,
    chainId: network.chainId,
    client,
    rpcUrl: network.rpcUrl,
    pollingInterval: network.pollingInterval ?? 1_000,
    defaultMaxBlockRange: getDefaultMaxBlockRange(network),
    // TODO: Get this from a list of known finality block counts, then
    // fallback to a default.
    finalityBlockCount: 10,
  };

  return resolvedNetwork;
}

function getDefaultMaxBlockRange(network: {
  rpcUrl?: string;
  chainId: number;
}) {
  // Quicknode enforces a hard limit of 10_000.
  if (network.rpcUrl !== undefined && network.rpcUrl.includes("quiknode.pro")) {
    return 10_000;
  }

  // Otherwise (e.g. Alchemy) use an optimistically high block limit and lean
  // on the error handler to resolve failures.

  let maxBlockRange: number;
  switch (network.chainId) {
    // Mainnet.
    case 1:
    case 3:
    case 4:
    case 5:
    case 42:
    case 11155111:
      maxBlockRange = 2_000;
      break;
    // Optimism.
    case 10:
    case 420:
      maxBlockRange = 50_000;
      break;
    // Polygon.
    case 137:
    case 80001:
      maxBlockRange = 50_000;
      break;
    // Arbitrum.
    case 42161:
    case 421613:
      maxBlockRange = 50_000;
      break;
    default:
      maxBlockRange = 50_000;
  }

  return maxBlockRange;
}
