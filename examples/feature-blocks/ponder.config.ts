import { createConfig } from "@ponder/core";
import { http, Abi } from "viem";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  },
  blocks: {
    ChainlinkPriceOracle: {
      network: "mainnet",
      startBlock: 19_750_000,
      interval: 5, // every minute
    },
  },
});
