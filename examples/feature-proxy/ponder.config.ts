import { createConfig, mergeAbis } from "@ponder/core";
import { http } from "viem";

import { RouterImplAbi } from "./abis/RouterImplAbi";
import { RouterProxyAbi } from "./abis/RouterProxyAbi";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  },
  contracts: {
    AstariaRouter: {
      network: "mainnet",
      abi: mergeAbis([RouterProxyAbi, RouterImplAbi]),
      address: "0x42CDc5D4B05E8dACc2FCD181cbe0Cc86Ee14c439",
      startBlock: 17942156,
    },
  },
});
