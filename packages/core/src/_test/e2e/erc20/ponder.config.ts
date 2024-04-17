import { http } from "viem";

import { createConfig } from "../../../config/config.js";
import { CONTRACTS } from "../../constants.js";
import { erc20ABI } from "../../generated.js";

const poolId = Number(process.env.VITEST_POOL_ID ?? 1);

function getDatabase() {
  if (process.env.DATABASE_URL) {
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.pathname = `/vitest_${poolId}`;
    const connectionString = databaseUrl.toString();
    return { kind: "postgres", connectionString } as const;
  } else {
    return { kind: "sqlite" } as const;
  }
}

export default createConfig({
  database: getDatabase(),
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(`http://127.0.0.1:8545/${poolId}`),
    },
  },
  contracts: {
    Erc20: {
      network: "mainnet",
      abi: erc20ABI,
      address: CONTRACTS.erc20Address,
      filter: {
        event:
          "Transfer(address indexed from, address indexed to, uint256 amount)",
      },
    },
  },
});
