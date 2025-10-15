import { createConfig } from "ponder";

import { PoolManagerAbi } from "./abis/PoolManager";

export default createConfig({
  ordering: "isolated",
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1,
      maxRequestsPerSecond: 200,
    },
    unichain: {
      id: 130,
      rpc: process.env.PONDER_RPC_URL_130,
      maxRequestsPerSecond: 200,
    },
    optimism: {
      id: 10,
      rpc: process.env.PONDER_RPC_URL_10,
      maxRequestsPerSecond: 200,
    },
    base: {
      id: 8453,
      rpc: process.env.PONDER_RPC_URL_8453,
      maxRequestsPerSecond: 200,
    },
  },
  contracts: {
    PoolManager: {
      chain: {
        mainnet: {
          address: "0x000000000004444c5dc75cb358380d2e3de08a90",
          startBlock: 21_700_000,
          endBlock: 22_500_000,
        },
        unichain: {
          address: "0x1f98400000000000000000000000000000000004",
          startBlock: 0,
          endBlock: 15_500_000,
        },
        optimism: {
          address: "0x9a13f98cb987694c9f086b1f5eb990eea8264ec3",
          startBlock: 131_000_000,
          endBlock: 136_000_000,
        },
        base: {
          address: "0x498581ff718922c3f8e6a244956af099b2652b2b",
          startBlock: 25_500_000,
          endBlock: 28_500_000,
        },
      },
      abi: PoolManagerAbi,
    },
  },
});
