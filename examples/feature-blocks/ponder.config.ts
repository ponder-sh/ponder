import { createConfig } from "@ponder/core";
import { http } from "viem";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  },
  blocks: {
    mainnet: {
      startBlock: 19_750_000,
      frequency: 5, // every minute
    },
  },
});
