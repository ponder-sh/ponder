import { createConfig } from "@ponder/core";
import { http } from "viem";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  },
  contracts: {},
  blocks: {
    mainnet: {
      startBlock: 19_000_000,
      frequency: 5 * 60, // every hour
    },
  },
});
