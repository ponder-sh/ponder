import { createConfig } from "ponder";

import { weth9Abi } from "./abis/Weth9Abi";

export default createConfig({
  chains: {
    base: {
      id: 8453,
      rpc: process.env.PONDER_RPC_URL_8453,
    },
  },
  contracts: {
    weth9: {
      abi: weth9Abi,
      chain: "base",
      address: "0x4200000000000000000000000000000000000006",
      startBlock: "latest",
    },
  },
});
