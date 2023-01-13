import {
  AlchemyProvider,
  StaticJsonRpcProvider,
} from "@ethersproject/providers";

import { CachedProvider } from "@/networks/CachedProvider";
import type { Ponder } from "@/Ponder";

export type EvmNetwork = {
  name: string;
  chainId: number;
  provider: StaticJsonRpcProvider;
};

export type Network = EvmNetwork;

const cachedProvidersByChainId: Record<
  number,
  StaticJsonRpcProvider | undefined
> = {};

export const buildNetworks = ({ ponder }: { ponder: Ponder }) => {
  const networks = ponder.config.networks.map(({ name, rpcUrl, chainId }) => {
    let provider = cachedProvidersByChainId[chainId];
    if (!provider) {
      if (rpcUrl) {
        provider = new CachedProvider(ponder, rpcUrl, chainId);
      } else {
        // The default provider will not actually work in a meaningful way.
        provider = new AlchemyProvider(chainId);
        ponder.emit("dev_error", {
          context: `building networks`,
          error: new Error(`RPC URL not found for network "${name}"`),
        });
      }
      cachedProvidersByChainId[chainId] = provider;
    }

    const network: EvmNetwork = {
      name: name,
      chainId: chainId,
      provider: provider,
    };

    return network;
  });

  return networks;
};
