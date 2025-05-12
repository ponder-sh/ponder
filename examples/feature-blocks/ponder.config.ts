import { createConfig } from "ponder";
import { http } from "viem";

export default createConfig({
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1!,
    },
  },
  blocks: {
    ChainlinkPriceOracle: {
      chain: "mainnet",
      startBlock: 19_750_000,
      interval: 5, // every minute
    },
  },
});
