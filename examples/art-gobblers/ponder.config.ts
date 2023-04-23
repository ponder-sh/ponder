import type { PonderConfig } from "@ponder/core";

import ArtGobblersAbi from "./abis/ArtGobblers.json";

export const config: PonderConfig = {
  networks: [
    {
      name: "mainnet",
      chainId: 1,
      rpcUrl: process.env.PONDER_RPC_URL_1,
    },
  ],
  contracts: [
    {
      name: "ArtGobblers",
      network: "mainnet",
      abi: ArtGobblersAbi,
      address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
      startBlock: 15863321,
    },
  ],
};
