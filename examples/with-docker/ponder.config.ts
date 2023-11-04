import { createConfig } from "@ponder/core";
import { http } from "viem";

import { AdventureGoldAbi } from "./abis/AdventureGold.abi";

if (!process.env.PONDER_RPC_URL_1) {
  throw new Error("Missing PONDER_RPC_URL_1 environment variable");
}

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
      name: "AdventureGold",
      network: [{ name: "mainnet" }],
      abi: AdventureGoldAbi,
      address: "0x32353A6C91143bfd6C7d363B546e62a9A2489A20",
      startBlock: 13142655,
      endBlock: 13150000,
    },
  ],
});
