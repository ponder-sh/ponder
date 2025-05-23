import { createConfig } from "ponder";

import { weth9Abi } from "./abis/weth9Abi";

export default createConfig({
  chains: {
    mainnet: { id: 1, rpc: process.env.PONDER_RPC_URL_1 },
    base: { id: 8453, rpc: process.env.PONDER_RPC_URL_8453 },
    optimism: { id: 10, rpc: process.env.PONDER_RPC_URL_10 },
    polygon: { id: 137, rpc: process.env.PONDER_RPC_URL_137 },
  },
  contracts: {
    weth9: {
      abi: weth9Abi,
      chain: {
        mainnet: {
          address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          startBlock: 22_546_000,
          endBlock: 22_547_000,
        },
        base: {
          address: "0x4200000000000000000000000000000000000006",
          startBlock: 30_618_000,
          endBlock: 30_619_000,
        },
        optimism: {
          address: "0x4200000000000000000000000000000000000006",
          startBlock: 136_213_000,
          endBlock: 136_214_000,
        },
        polygon: {
          address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
          startBlock: 71_878_000,
          endBlock: 71_879_000,
        },
      },
    },
  },
});
