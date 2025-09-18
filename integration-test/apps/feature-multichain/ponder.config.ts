import { createConfig } from "ponder";

import { weth9Abi } from "./abis/weth9Abi";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
    poolConfig: { max: 17 },
  },
  chains: {
    mainnet: { id: 1, rpc: process.env.PONDER_RPC_URL_1 },
    optimism: { id: 10, rpc: process.env.PONDER_RPC_URL_10 },
    base: { id: 8453, rpc: process.env.PONDER_RPC_URL_8453 },
  },
  contracts: {
    weth9: {
      abi: weth9Abi,
      chain: {
        mainnet: {
          address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          startBlock: 22_547_400, // May-23-2025 06:37:35 PM
          endBlock: 22_547_650,
        },
        optimism: {
          address: "0x4200000000000000000000000000000000000006",
          startBlock: 136_213_300, // May-23-2025 06:36:17 PM
          endBlock: 136_213_550,
        },
        base: {
          address: "0x4200000000000000000000000000000000000006",
          startBlock: 30_618_000, // May-23-2025 06:35:47 PM
          endBlock: 30_618_250,
        },
      },
    },
  },
});
