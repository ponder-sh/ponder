import type { Config } from "@ponder/core";

export const config: Config = {
  network: {
    name: "mainnet",
    chainId: 1,
    rpcUrl: process.env.PONDER_RPC_URL_1,
  },
  contracts: [
    {
      name: "AdventureGold",
      abi: "./abis/AdventureGold.json",
      address: "0x32353A6C91143bfd6C7d363B546e62a9A2489A20",
      startBlock: 13142655,
      endBlock: 13150000,
    },
  ],
};
