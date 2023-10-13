import type { Config } from "@ponder/core";
import { http } from "viem";

export const config: Config = {
  networks: [
    {
      name: "mainnet",
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
      maxRpcRequestConcurrency: 25,
    },
  ],
  contracts: [
    {
      name: "RocketTokenRETH",
      network: "mainnet",
      abi: "./abis/RocketTokenRETH.json",
      address: "0xae78736cd615f374d3085123a210448e74fc6393",
      startBlock: 13325304,
    },
  ],
};
