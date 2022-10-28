import type { CachedProvider } from "@/networks/CachedProvider";

export type EvmNetwork = {
  name: string;
  chainId: number;
  rpcUrl: string;
  provider: CachedProvider;
};
