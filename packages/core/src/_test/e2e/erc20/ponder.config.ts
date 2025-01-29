import { createConfig } from "../../../config/index.js";
import { erc20ABI } from "../../generated.js";

const poolId = Number(process.env.VITEST_POOL_ID ?? 1);

function getDatabase() {
  if (process.env.DATABASE_URL) {
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.pathname = `/vitest_${poolId}`;
    const connectionString = databaseUrl.toString();
    return { kind: "postgres", connectionString } as const;
  } else {
    return { kind: "pglite" } as const;
  }
}

export default createConfig({
  database: getDatabase(),
  networks: {
    mainnet: {
      chainId: 1,
      rpcUrl: `http://127.0.0.1:8545/${poolId}`,
    },
  },
  contracts: {
    Erc20: {
      network: "mainnet",
      abi: erc20ABI,
      address: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    },
  },
});
