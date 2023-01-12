import { CachedProvider } from "@/networks/CachedProvider";
import type { Ponder } from "@/Ponder";

import type { EvmNetwork } from "./evm";

const cachedProvidersByChainId: Record<number, CachedProvider | undefined> = {};

export const buildNetworks = ({ ponder }: { ponder: Ponder }) => {
  const networks = ponder.config.networks.map(({ name, rpcUrl, chainId }) => {
    let provider = cachedProvidersByChainId[chainId];
    if (!provider) {
      provider = new CachedProvider(ponder, rpcUrl, chainId);
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
