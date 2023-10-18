import { http } from "viem";

import ArtGobblersAbi from "./ArtGobblers.json";

export const config = {
  networks: [
    { name: "mainnet", chainId: 1, transport: http("http://127.0.0.1:8545") },
  ],
  contracts: [
    {
      name: "ArtGobblers",
      network: "mainnet",
      abi: ArtGobblersAbi,
      address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
      startBlock: 15870400,
      endBlock: 15870405, // 5 blocks
    },
  ],
};
