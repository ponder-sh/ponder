import { createConfig } from "@ponder/core";
import { http } from "viem";

import { CurioERC1155WrapperAbi } from "./abis/CurioERC1155WrapperAbi";

export default createConfig({
  networks: {
    mainnet: { chainId: 1, transport: http(process.env.PONDER_RPC_URL_1) },
  },
  contracts: {
    CurioERC1155Wrapper: {
      abi: CurioERC1155WrapperAbi,
      address: "0x73da73ef3a6982109c4d5bdb0db9dd3e3783f313",
      network: "mainnet",
      startBlock: 12129118,
    },
  },
});
