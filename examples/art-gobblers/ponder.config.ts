import { createConfig } from "@ponder/core";
import { http } from "viem";

import { ArtGobblersAbi } from "./ArtGobblers.abi";

export const config = createConfig({
  networks: [
    {
      name: "mainnet",
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  ],
  contracts: [
    {
      name: "ArtGobblers",
      network: [{ name: "mainnet" }],
      abi: ArtGobblersAbi,
      address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
      startBlock: 15863321,
    },
  ],
});
