import {
  type PublicClient,
  type Transport,
  createPublicClient,
  http,
} from "viem";
import { mainnet } from "viem/chains";

import type { ResolvedConfig } from "@/config/types";

export type Network = {
  name: string;
  chainId: number;
  client: PublicClient;
  rpcUrl?: string;
  transport?: Transport;
  pollingInterval: number;
  defaultMaxBlockRange: number;
  maxRpcRequestConcurrency: number;
  finalityBlockCount: number;
};

const clients: Record<number, PublicClient | undefined> = {};

export function buildNetwork({
  network,
}: {
  network: ResolvedConfig["networks"][0];
}) {
  let client = clients[network.chainId];
  const transport = network.transport
    ? network.transport
    : http(network.rpcUrl);

  if (!client) {
    client = createPublicClient({
      transport,
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
    maxRpcRequestConcurrency: network.maxRpcRequestConcurrency ?? 10,
    finalityBlockCount: getFinalityBlockCount(network),
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
    // Mainnet and mainnet testnets.
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

/**
 * Returns the number of blocks that must pass before a block is considered final.
 * Note that a value of `0` indicates that blocks are considered final immediately.
 *
 * @param network The network to get the finality block count for.
 * @returns The finality block count.
 */
function getFinalityBlockCount(network: { chainId: number }) {
  let finalityBlockCount: number;
  switch (network.chainId) {
    // Mainnet and mainnet testnets.
    case 1:
    case 3:
    case 4:
    case 5:
    case 42:
    case 11155111:
      finalityBlockCount = 32;
      break;
    // Optimism.
    case 10:
    case 420:
      finalityBlockCount = 5;
      break;
    // Polygon.
    case 137:
    case 80001:
      finalityBlockCount = 100;
      break;
    // Arbitrum.
    case 42161:
    case 421613:
      finalityBlockCount = 40;
      break;
    // Zora.
    case 7777777:
      finalityBlockCount = 5;
      break;
    default:
      finalityBlockCount = 5;
  }

  return finalityBlockCount;
}
