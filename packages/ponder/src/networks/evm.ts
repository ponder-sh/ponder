import type { CachedProvider } from "@/core/indexer/CachedProvider";

export type EvmNetwork = {
  name: string;
  chainId: number;
  rpcUrl: string;
  provider: CachedProvider;
};
