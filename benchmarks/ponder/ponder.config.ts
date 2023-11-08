import { createConfig } from "@ponder/core";
import { http } from "viem";

import { RocketTokenRETHAbi } from "./abis/RocketTokenRETH";

export const config = createConfig({
  networks: [
    {
      name: "mainnet",
      chainId: 1,
      transport: http(process.env.ANVIL_FORK_URL),
    },
  ],
  contracts: [
    {
      name: "RocketTokenRETH",
      network: [{ name: "mainnet" }],
      abi: RocketTokenRETHAbi,
      address: "0xae78736cd615f374d3085123a210448e74fc6393",
      startBlock:
        Number(process.env.ANVIL_FORK_BLOCK_NUMBER) -
        Number(process.env.BLOCK_COUNT),
      endBlock: Number(process.env.ANVIL_FORK_BLOCK_NUMBER),
    },
  ],
});
