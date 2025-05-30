import { createConfig } from "ponder";
import { erc20ABI } from "./abis/erc20ABI";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.PONDER_DATABASE_URL,
    poolConfig: { max: 11 },
  },
  chains: {
    mainnet: { id: 1, rpc: process.env.PONDER_RPC_URL_1 },
  },
  contracts: {
    ERC20: {
      chain: "mainnet",
      abi: erc20ABI,
      address: "0x32353A6C91143bfd6C7d363B546e62a9A2489A20",
      startBlock: 13145000,
      endBlock: 13147000,
    },
  },
});
