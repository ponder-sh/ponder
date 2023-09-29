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
  let client: PublicClient | undefined = clients[network.chainId];
  let transport: Transport | undefined = network.transport;

  if (!transport) {
    // By default, viem uses a public RPC provider on that chain. For example, eth mainnet it uses https://cloudflare-eth.com.
    transport = http();
  }

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
    transport,
    client,
    pollingInterval: network.pollingInterval ?? 1_000,
    defaultMaxBlockRange: getDefaultMaxBlockRange(network, client),
    maxRpcRequestConcurrency: network.maxRpcRequestConcurrency ?? 10,
    finalityBlockCount: getFinalityBlockCount(network),
  };

  return resolvedNetwork;
}

export function getDefaultMaxBlockRange(
  network: {
    chainId: number;
  },
  client: PublicClient
) {
  const rpcUrls = getTransportUrls(client);
  const isQuickNode = rpcUrls.some((url) => url.includes("quicknode"));

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
      maxBlockRange = isQuickNode ? 10_000 : 50_000;
      break;
    // Polygon.
    case 137:
    case 80001:
      maxBlockRange = isQuickNode ? 10_000 : 50_000;
      break;
    // Arbitrum.
    case 42161:
    case 421613:
      maxBlockRange = isQuickNode ? 10_000 : 50_000;
      break;
    default:
      maxBlockRange = isQuickNode ? 10_000 : 50_000;
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

/**
 * Returns an array of transport URLs for the given public client.
 *
 * @param publicClient viem public client.
 * @returns Array of transport URLs.
 */
export function getTransportUrls(publicClient: PublicClient): string[] {
  const transport = publicClient?.transport;
  const urls = [];

  /**
   * There are three cases to consider:
   * 1. The transport is a fallback transport, which is an array of transports. Check for http urls.
   * 2. The transport is a single transport.
   * 3. The transport is a web socket transport and does not have a URL. This seems to be an issue with viem not setting the URL for web socket transports.
   */

  if (transport?.url) {
    urls.push(transport.url);
  } else {
    if (transport?.transports) {
      for (const t of transport.transports) {
        if (t?.value && t.value?.url) {
          urls.push(t.value.url);
        }
      }
    }
  }

  return urls;
}
