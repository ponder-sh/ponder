import type { Chain } from "viem";

/**
 * Returns `true` if the RPC URL is found in the list of public RPC URLs
 * included in viem/chains. Handles both HTTP and WebSocket RPC URLs.
 *
 * @returns Boolean indicating if the RPC URL is public.
 */
export function isRpcUrlPublic({
  chain,
  rpcUrl,
}: {
  chain: Chain;
  rpcUrl: string;
}) {
  for (const http of chain.rpcUrls.default.http) {
    if (http === rpcUrl) return true;
  }

  for (const webSocket of chain.rpcUrls.default.webSocket ?? []) {
    if (webSocket === rpcUrl) return true;
  }

  return false;
}
