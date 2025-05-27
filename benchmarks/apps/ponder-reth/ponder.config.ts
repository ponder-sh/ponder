import { createConfig } from "ponder";

import { RocketTokenRETHAbi } from "./abis/RocketTokenRETH";

export default createConfig({
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1!,
      maxRequestsPerSecond: 200,
    },
  },
  contracts: {
    RocketTokenRETH: {
      chain: "mainnet",
      abi: RocketTokenRETHAbi,
      address: "0xae78736cd615f374d3085123a210448e74fc6393",
      // startBlock: 13325304,
      startBlock: 18900000,
      endBlock: 19000000,
    },
  },
});
