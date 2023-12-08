import { createConfig } from "@ponder/core";
import { http } from "viem";

import { PrimitiveManagerAbi } from "./abis/PrimitiveManagerAbi";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  },
  contracts: {
    PrimitiveManager: {
      network: "mainnet",
      abi: PrimitiveManagerAbi,
      address: "0x54522dA62a15225C95b01bD61fF58b866C50471f",
      startBlock: 14438081,
      filter: {
        event: "Swap",
      },
    },
  },
});
