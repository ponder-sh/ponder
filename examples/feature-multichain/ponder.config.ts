import { createConfig } from "ponder";

import { weth9Abi } from "./abis/weth9Abi";

export default createConfig({
  ordering: "multichain",
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1,
    },
    unichain: {
      id: 130,
      rpc: process.env.PONDER_RPC_URL_130,
    },
    arbitrum: {
      id: 42161,
      rpc: process.env.PONDER_RPC_URL_42161,
    },
    optimism: {
      id: 10,
      rpc: process.env.PONDER_RPC_URL_10,
    },
    base: {
      id: 8453,
      rpc: process.env.PONDER_RPC_URL_8453,
    },
    polygon: {
      id: 137,
      rpc: process.env.PONDER_RPC_URL_137,
    },
    worldchain: {
      id: 480,
      rpc: process.env.PONDER_RPC_URL_480,
    },
    blast: {
      id: 81457,
      rpc: process.env.PONDER_RPC_URL_81457,
    },
  },
  contracts: {
    weth9: {
      abi: weth9Abi,
      startBlock: "latest",
      chain: {
        mainnet: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
        unichain: { address: "0x4200000000000000000000000000000000000006" },
        arbitrum: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" },
        base: { address: "0x4200000000000000000000000000000000000006" },
        optimism: { address: "0x4200000000000000000000000000000000000006" },
        polygon: { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" },
        worldchain: { address: "0x4200000000000000000000000000000000000006" },
        blast: { address: "0x4300000000000000000000000000000000000004" },
      },
    },
  },
});
