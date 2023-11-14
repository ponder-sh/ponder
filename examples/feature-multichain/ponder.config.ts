import { createConfig } from "@ponder/core";
import { http } from "viem";

import { weth9Abi } from "./abis/weth9Abi";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
    base: {
      chainId: 8453,
      transport: http(process.env.PONDER_RPC_URL_8453),
    },
    optimism: {
      chainId: 10,
      transport: http(process.env.PONDER_RPC_URL_10),
    },
  },
  contracts: {
    weth9: {
      network: "mainnet",
      abi: weth9Abi,
      address: "0x4200000000000000000000000000000000000006",
      startBlock: 0,
      networks: {
        mainnet: {
          address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          startBlock: 4719568,
          endBlock: 4720568,
        },
        optimism: {
          endBlock: 1200,
        },
        base: {
          endBlock: 1500,
        },
      },
    },
  },
});
