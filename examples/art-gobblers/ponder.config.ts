import { createConfig } from "@ponder/core";
import { http } from "viem";

import { ArtGobblersAbi } from "./abis/ArtGobblers.abi";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  },
  contracts: {
    ArtGobblers: {
      network: "mainnet",
      abi: ArtGobblersAbi,
      address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
      startBlock: 15863321,
      filter: { event: "ArtGobbled" },
    },
  },
});
