import type { PonderConfig } from "@/cli/readPonderConfig";
import type { CacheStore } from "@/db/cache/cacheStore";
import { CachedProvider } from "@/networks/CachedProvider";

import type { EvmNetwork } from "./evm";

const cachedProvidersByChainId: Record<number, CachedProvider | undefined> = {};

export const buildNetworks = ({
  config,
  cacheStore,
}: {
  config: PonderConfig;
  cacheStore: CacheStore;
}) => {
  const networks = config.networks.map(({ name, rpcUrl, chainId }) => {
    // TODO: Throw this error near the beginning of Ponder.backfill() instead,
    // and probably catch it in the "user error" handler.
    // if (rpcUrl === undefined || rpcUrl === "") {
    //   throw new Error(`Invalid or missing RPC URL for network: ${name}`);
    // }

    if (chainId === undefined || typeof chainId !== "number") {
      throw new Error(`Invalid or missing chain ID for network: ${name}`);
    }

    let provider = cachedProvidersByChainId[chainId];
    if (!provider) {
      provider = new CachedProvider(cacheStore, rpcUrl, chainId);
      cachedProvidersByChainId[chainId] = provider;
    }

    const network: EvmNetwork = {
      name: name,
      chainId: chainId,
      rpcUrl: rpcUrl,
      provider: provider,
    };

    return network;
  });

  return { networks };
};
