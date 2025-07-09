import { createConfig } from "ponder";
import { BasePaintAbi } from "./abis/BasePaintAbi";
import { BasePaintBrushAbi } from "./abis/BasePaintBrushAbi";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
    poolConfig: { max: 17 },
  },
  chains: {
    base: { id: 8453, rpc: process.env.PONDER_RPC_URL_8453! },
  },
  contracts: {
    BasePaintBrush: {
      abi: BasePaintBrushAbi,
      address: "0xD68fe5b53e7E1AbeB5A4d0A6660667791f39263a",
      chain: "base",
      startBlock: 0x246523,
      endBlock: 4000000,
    },
    BasePaint: {
      abi: BasePaintAbi,
      address: "0xBa5e05cb26b78eDa3A2f8e3b3814726305dcAc83",
      chain: "base",
      startBlock: 0x246523,
      endBlock: 4000000,
    },
  },
});
