import { createConfig } from "../../../config/index.js";
import { erc20ABI } from "../../generated.js";

const poolId = Number(process.env.VITEST_POOL_ID ?? 1);

export default createConfig({
  database: { kind: "pglite", directory: "memory://" },
  chains: {
    mainnet: {
      id: 1,
      rpc: `http://127.0.0.1:8545/${poolId}`,
    },
  },
  contracts: {
    Erc20: {
      chain: "mainnet",
      abi: erc20ABI,
      address: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    },
  },
});
