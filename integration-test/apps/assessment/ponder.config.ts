import { createConfig } from "ponder";
import { parseAbi } from "viem";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
    poolConfig: { max: 17 },
  },
  chains: {
    mainnet: { id: 1, rpc: process.env.PONDER_RPC_URL_1 },
    base: { id: 8453, rpc: process.env.PONDER_RPC_URL_8453 },
    optimism: { id: 10, rpc: process.env.PONDER_RPC_URL_10 },
  },
  contracts: {
    weth9: {
      chain: {
        mainnet: {
          address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          startBlock: 22_547_400,
          endBlock: 22_547_800,
        },
        base: {
          address: "0x4200000000000000000000000000000000000006",
          startBlock: 30_618_000,
          endBlock: 30_618_400,
        },
        optimism: {
          address: "0x4200000000000000000000000000000000000006",
          startBlock: 136_213_000,
          endBlock: 136_213_400,
        },
      },
      abi: parseAbi([
        "event Transfer(address indexed from, address indexed to, uint256 value)",
        "function transfer(address to, uint256 amount) external returns (bool)",
      ]),
      includeCallTraces: true,
    },
  },
});
