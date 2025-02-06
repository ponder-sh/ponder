import { createConfig } from "ponder";
import { http } from "viem";

import { weth9Abi } from "./abis/weth9Abi";

export default createConfig({
  ordering: "multichain",
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
      pollingInterval: 1_000,
    },
    base: {
      chainId: 8453,
      transport: http(process.env.PONDER_RPC_URL_8453),
      pollingInterval: 1_000,
    },
    optimism: {
      chainId: 10,
      transport: http(process.env.PONDER_RPC_URL_10),
      pollingInterval: 1_000,
    },
    polygon: {
      chainId: 137,
      transport: http(process.env.PONDER_RPC_URL_137),
      pollingInterval: 1_000,
    },
  },
  contracts: {
    weth9: {
      abi: weth9Abi,
      address: "0x4200000000000000000000000000000000000006",
      startBlock: "latest",
      network: {
        mainnet: {
          address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        },
        base: {},
        optimism: {},
        polygon: {
          address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
        },
      },
    },
  },
});
