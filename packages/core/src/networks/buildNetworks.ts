import type { PonderConfig } from "@/cli/readPonderConfig";
import { CachedProvider } from "@/networks/CachedProvider";

import type { Ponder } from "../Ponder";
import type { EvmNetwork } from "./evm";

const cachedProvidersByChainId: Record<number, CachedProvider | undefined> = {};

export const buildNetworks = ({
  config,
  ponder,
}: {
  config: PonderConfig;
  ponder: Ponder;
}) => {
  const networks = config.networks.map(({ name, rpcUrl, chainId }) => {
    if (chainId === undefined || typeof chainId !== "number") {
      ponder.emit(
        "configError",
        `Invalid or missing chain ID for network "${name}" in ponder.config.js`
      );
    }

    // This is a hack, we don't want to actually throw an error inside
    if (rpcUrl === undefined || rpcUrl === "") {
      ponder.emit(
        "configError",
        `Invalid or missing RPC URL for network "${name}" in ponder.config.js`
      );
    }

    let provider = cachedProvidersByChainId[chainId];
    if (!provider) {
      provider = new CachedProvider(ponder.cacheStore, rpcUrl, chainId);
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
