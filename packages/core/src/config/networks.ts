import {
  AlchemyProvider,
  StaticJsonRpcProvider,
} from "@ethersproject/providers";

import { ResolvedPonderConfig } from "@/config/buildPonderConfig";
import { CachedProvider } from "@/config/CachedProvider";
import { CacheStore } from "@/db/cache/cacheStore";

export type EvmNetwork = {
  name: string;
  chainId: number;
  provider: StaticJsonRpcProvider;
};

export type Network = EvmNetwork;

const providersByChainId: Record<number, StaticJsonRpcProvider | undefined> =
  {};

export const buildNetworks = ({
  config,
  cacheStore,
}: {
  config: ResolvedPonderConfig;
  cacheStore: CacheStore;
}) => {
  const networks = config.networks.map(({ name, rpcUrl, chainId }) => {
    let provider = providersByChainId[chainId];
    if (!provider) {
      // TODO: make rpcUrl required in config, handle the codegen error issue differently
      if (rpcUrl) {
        provider = new CachedProvider(cacheStore, rpcUrl, chainId);
      } else {
        // The default provider will not actually work in a meaningful way.
        provider = new AlchemyProvider(chainId);
      }
      providersByChainId[chainId] = provider;
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
