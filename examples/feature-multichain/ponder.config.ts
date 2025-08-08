import { createConfig } from "ponder";

import { weth9Abi } from "./abis/weth9Abi";

export default createConfig({
  ordering: "multichain",
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1,
      ws: process.env.PONDER_WS_URL_1,
    },
    base: {
      id: 8453,
      rpc: process.env.PONDER_RPC_URL_8453,
      ws: process.env.PONDER_WS_URL_8453,
    },
    optimism: {
      id: 10,
      rpc: process.env.PONDER_RPC_URL_10,
      ws: process.env.PONDER_WS_URL_10,
    },
    polygon: {
      id: 137,
      rpc: process.env.PONDER_RPC_URL_137,
      ws: process.env.PONDER_WS_URL_137,
    },
  },
  contracts: {
    weth9: {
      abi: weth9Abi,
      startBlock: "latest",
      chain: {
        mainnet: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
        base: { address: "0x4200000000000000000000000000000000000006" },
        optimism: { address: "0x4200000000000000000000000000000000000006" },
        polygon: { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" },
      },
    },
  },
});
