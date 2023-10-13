import type { Config } from "@ponder/core";
import { http } from "viem";

export const config: Config = {
  networks: [
    {
      name: "base",
      chainId: 8453,
      transport: http(process.env.PONDER_RPC_URL_8453),
    },
  ],
  contracts: [
    {
      name: "FriendtechSharesV1",
      network: "base",
      abi: "./abis/FriendtechSharesV1.json",
      address: "0xcf205808ed36593aa40a44f10c7f7c2f67d4a4d4",
      startBlock: 2430440,
      maxBlockRange: 100,
    },
  ],
};
