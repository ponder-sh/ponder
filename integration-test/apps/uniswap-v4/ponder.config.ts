import { createConfig } from "ponder";

import { PoolManagerAbi } from "./abis/PoolManager";

export default createConfig({
  chains: {
    mainnet: { id: 1, rpc: process.env.PONDER_RPC_URL_1 },
    unichain: { id: 130, rpc: process.env.PONDER_RPC_URL_130 },
    arbitrum: { id: 42161, rpc: process.env.PONDER_RPC_URL_42161 },
    optimism: { id: 10, rpc: process.env.PONDER_RPC_URL_10 },
    base: { id: 8453, rpc: process.env.PONDER_RPC_URL_8453 },
    polygon: { id: 137, rpc: process.env.PONDER_RPC_URL_137 },
    worldchain: { id: 480, rpc: process.env.PONDER_RPC_URL_480 },
    blast: { id: 81457, rpc: process.env.PONDER_RPC_URL_81457 },
  },
  contracts: {
    PoolManager: {
      chain: {
        mainnet: {
          address: "0x000000000004444c5dc75cb358380d2e3de08a90",
          startBlock: 22_568_400,
          endBlock: 22_569_400,
        },
        unichain: {
          address: "0x1f98400000000000000000000000000000000004",
          startBlock: 17_543_000,
          endBlock: 17_544_000,
        },
        arbitrum: {
          address: "0x360e68faccca8ca495c1b759fd9eee466db9fb32",
          startBlock: 340_842_000,
          endBlock: 340_843_000,
        },
        optimism: {
          address: "0x9a13f98cb987694c9f086b1f5eb990eea8264ec3",
          startBlock: 136_346_000,
          endBlock: 136_347_000,
        },
        base: {
          address: "0x498581ff718922c3f8e6a244956af099b2652b2b",
          startBlock: 30_750_500,
          endBlock: 30_751_500,
        },
        polygon: {
          address: "0x67366782805870060151383f4bbff9dab53e5cd6",
          startBlock: 72_002_100,
          endBlock: 72_003_100,
        },
        worldchain: {
          address: "0xb1860d529182ac3bc1f51fa2abd56662b7d13f33",
          startBlock: 14_477_500,
          endBlock: 14_478_500,
        },
        blast: {
          address: "0x1631559198a9e474033433b2958dabc135ab6446",
          startBlock: 19_740_400,
          endBlock: 19_741_400,
        },
      },
      abi: PoolManagerAbi,
    },
  },
});
