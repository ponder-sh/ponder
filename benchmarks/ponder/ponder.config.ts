import { createConfig } from "@ponder/core";
import { http } from "viem";

import { RocketTokenRETHAbi } from "./abis/RocketTokenRETH";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
      maxRpcRequestConcurrency: 10,
    },
  },
  contracts: {
    RocketTokenRETH: {
      network: "mainnet",
      abi: RocketTokenRETHAbi,
      address: "0xae78736cd615f374d3085123a210448e74fc6393",
      // startBlock: 13325304,
      startBlock: 18600000,
    },
  },
});
