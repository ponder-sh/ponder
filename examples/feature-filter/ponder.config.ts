import { createConfig } from "ponder";

import { PrimitiveManagerAbi } from "./abis/PrimitiveManagerAbi";

export default createConfig({
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1,
    },
  },
  contracts: {
    PrimitiveManager: {
      chain: "mainnet",
      abi: PrimitiveManagerAbi,
      address: "0x54522dA62a15225C95b01bD61fF58b866C50471f",
      startBlock: 14438081,
      filter: {
        event: "Swap",
      },
    },
  },
});
