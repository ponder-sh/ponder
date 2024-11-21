import { createConfig } from "ponder";
import { http } from "viem";

import { FriendtechSharesV1Abi } from "./abis/FriendtechSharesV1Abi";

export default createConfig({
  networks: {
    base: {
      chainId: 8453,
      transport: http(process.env.PONDER_RPC_URL_8453),
    },
  },
  contracts: {
    FriendtechSharesV1: {
      network: "base",
      abi: FriendtechSharesV1Abi,
      address: "0xcf205808ed36593aa40a44f10c7f7c2f67d4a4d4",
      startBlock: 2430440,
    },
  },
});
