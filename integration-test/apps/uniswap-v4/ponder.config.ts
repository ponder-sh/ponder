import { createConfig } from "ponder";

import { PoolManagerAbi } from "./abis/PoolManager";

export default createConfig({
  // @ts-ignore
  ordering: process.env.ORDERING,
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
    PoolManager: {
      chain: {
        mainnet: {
          address: "0x000000000004444c5dc75cb358380d2e3de08a90",
          startBlock: 22_569_300, // May-26-2025 08:18:47 PM
          endBlock: 22_569_550,
        },
        optimism: {
          address: "0x9a13f98cb987694c9f086b1f5eb990eea8264ec3",
          startBlock: 136_346_000, // May-26-2025 08:19:37 PM
          endBlock: 136_346_250,
        },
        base: {
          address: "0x498581ff718922c3f8e6a244956af099b2652b2b",
          startBlock: 30_750_700, // May-26-2025 08:19:07 PM
          endBlock: 30_750_950,
        },
      },
      abi: PoolManagerAbi,
    },
  },
});
