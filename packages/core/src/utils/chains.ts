import * as _chains from "viem/chains";
import { defineChain } from "viem/utils";

export const chains = _chains as unknown as Record<string, _chains.Chain>;

// Note: wanchain testnet uses the same id as hyperliquid evm
export const hyperliquidEvm = defineChain({
  id: 999,
  name: "Hyperliquid EVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc.hyperliquid.xyz/evm"],
    },
  },
  contracts: {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11",
      blockCreated: 13051,
    },
  },
});
