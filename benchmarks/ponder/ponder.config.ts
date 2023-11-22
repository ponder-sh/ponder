import { createConfig } from "@ponder/core";
import { http } from "viem";

import { RocketTokenRETHAbi } from "./abis/RocketTokenRETH";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http("http://127.0.0.1:8545"),
      maxRpcRequestConcurrency: 30,
    },
  },
  contracts: {
    RocketTokenRETH: {
      network: "mainnet",
      abi: RocketTokenRETHAbi,
      address: "0xae78736cd615f374d3085123a210448e74fc6393",
      startBlock: 17480000,
      endBlock: 17500000,
    },
  },
});
