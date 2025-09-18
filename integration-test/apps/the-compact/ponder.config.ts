import { createConfig } from "ponder";

import { TheCompactAbi } from "./abis/TheCompactAbi";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
    poolConfig: { max: 17 },
  },
  chains: {
    mainnet: { id: 1, rpc: process.env.PONDER_RPC_URL_1 },
    optimism: { id: 10, rpc: process.env.PONDER_RPC_URL_10 },
    unichain: { id: 130, rpc: process.env.PONDER_RPC_URL_130 },
    base: { id: 8453, rpc: process.env.PONDER_RPC_URL_8453 },
  },
  contracts: {
    TheCompact: {
      abi: TheCompactAbi,
      address: "0x00000000000018DF021Ff2467dF97ff846E09f48",
      chain: {
        mainnet: { startBlock: 21124904, endBlock: 22569400 },
        optimism: { startBlock: 127708222, endBlock: 136347000 },
        unichain: { startBlock: 8624343, endBlock: 17544000 },
        base: { startBlock: 22031390, endBlock: 30751500 },
      },
    },
  },
});
