import { createConfig } from "ponder";

import { WETH9Abi } from "./abis/WETH9";

export default createConfig({
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1!,
    },
  },
  contracts: {
    WETH: {
      chain: "mainnet",
      abi: WETH9Abi,
      address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      // Start at the chain tip so the workload is steady-state live indexing.
      startBlock: "latest",
    },
  },
});
