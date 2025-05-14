import { createConfig } from "ponder";

import { FriendtechSharesV1Abi } from "./abis/FriendtechSharesV1Abi";

export default createConfig({
  chains: {
    base: {
      id: 8453,
      rpc: process.env.PONDER_RPC_URL_8453,
    },
  },
  contracts: {
    FriendtechSharesV1: {
      chain: "base",
      abi: FriendtechSharesV1Abi,
      address: "0xcf205808ed36593aa40a44f10c7f7c2f67d4a4d4",
      startBlock: 2430440,
    },
  },
});
