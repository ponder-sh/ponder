import { CachedProvider } from "@/core/indexer/CachedProvider";
import type { PonderConfig } from "@/core/readPonderConfig";
import type { CacheStore } from "@/stores/baseCacheStore";

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
    if (rpcUrl === undefined || rpcUrl === "") {
      throw new Error(`Invalid or missing RPC URL for network: ${name}`);
    }

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
    };

    return network;
  });

  return { networks };
};
