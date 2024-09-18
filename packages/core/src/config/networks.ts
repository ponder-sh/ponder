import { chains } from "@/utils/chains.js";
import type { Chain, Client, Transport } from "viem";

export type Network = {
  name: string;
  chainId: number;
  chain: Chain;
  transport: ReturnType<Transport>;
  pollingInterval: number;
  maxRequestsPerSecond: number;
  finalityBlockCount: number;
  disableCache: boolean;
};

/**
 * Returns the number of blocks that must pass before a block is considered final.
 * Note that a value of `0` indicates that blocks are considered final immediately.
 *
 * @param network The network to get the finality block count for.
 * @returns The finality block count.
 */
export function getFinalityBlockCount({ chainId }: { chainId: number }) {
  let finalityBlockCount: number;
  switch (chainId) {
    // Mainnet and mainnet testnets.
    case 1:
    case 3:
    case 4:
    case 5:
    case 42:
    case 11155111:
      finalityBlockCount = 65;
      break;
    // Polygon.
    case 137:
    case 80001:
      finalityBlockCount = 200;
      break;
    // Arbitrum.
    case 42161:
    case 42170:
    case 421611:
    case 421613:
      finalityBlockCount = 240;
      break;
    default:
      // Assume a 2-second block time, e.g. OP stack chains.
      finalityBlockCount = 30;
  }

  return finalityBlockCount;
}

/**
 * Returns the list of RPC URLs backing a Transport.
 *
 * @param transport A viem Transport.
 * @returns Array of RPC URLs.
 */
export async function getRpcUrlsForClient(parameters: {
  transport: Transport;
  chain: Chain;
}) {
  // This is how viem converts a Transport into the Client.transport type.
  const { config, value } = parameters.transport({
    chain: parameters.chain,
    pollingInterval: 4_000, // default viem value
    retryCount: 0,
  });
  const transport = { ...config, ...value } as Client["transport"];

  async function getRpcUrlsForTransport(transport: Client["transport"]) {
    switch (transport.type) {
      case "http": {
        return [transport.url ?? parameters.chain.rpcUrls.default.http[0]];
      }
      case "webSocket": {
        try {
          const socket = await transport.getSocket();
          return [socket.url];
        } catch (e) {
          const symbol = Object.getOwnPropertySymbols(e).find(
            (symbol) => symbol.toString() === "Symbol(kTarget)",
          );
          if (!symbol) return [];
          const url = (e as any)[symbol]?._url;
          if (!url) return [];
          return [url.replace(/\/$/, "")];
        }
      }
      case "fallback": {
        // This is how viem converts a TransportConfig into the Client.transport type.
        const fallbackTransports = transport.transports.map((t: any) => ({
          ...t.config,
          ...t.value,
        })) as Client["transport"][];

        const urls: (string | undefined)[] = [];
        for (const fallbackTransport of fallbackTransports) {
          urls.push(...(await getRpcUrlsForTransport(fallbackTransport)));
        }

        return urls;
      }
      default: {
        // TODO: Consider logging a warning here. This will catch "custom" and unknown transports,
        // which we might not want to support.
        return [];
      }
    }
  }

  return getRpcUrlsForTransport(transport);
}

let publicRpcUrls: Set<string> | undefined = undefined;

/**
 * Returns `true` if the RPC URL is found in the list of public RPC URLs
 * included in viem/chains. Handles both HTTP and WebSocket RPC URLs.
 *
 * @param rpcUrl An RPC URL.
 * @returns Boolean indicating if the RPC URL is public.
 */
export function isRpcUrlPublic(rpcUrl: string | undefined) {
  if (rpcUrl === undefined) return true;

  if (!publicRpcUrls) {
    // By default, viem uses `chain.default.{http|webSocket}.[0]` if it exists.
    publicRpcUrls = Object.values(chains).reduce<Set<string>>((acc, chain) => {
      chain.rpcUrls.default.http.forEach((httpRpcUrl) => {
        acc.add(httpRpcUrl);
      });

      (
        (chain.rpcUrls.default as unknown as { webSocket?: string[] })
          .webSocket ?? []
      ).forEach((webSocketRpcUrl) => {
        acc.add(webSocketRpcUrl);
      });

      return acc;
    }, new Set<string>());
  }

  return publicRpcUrls.has(rpcUrl);
}
