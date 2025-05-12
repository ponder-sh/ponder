import { createConfig } from "ponder";
import { http } from "viem";
import { erc1155ABI } from "./abis/erc1155Abi";

export default createConfig({
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1!,
    },
  },
  contracts: {
    ERC1155: {
      chain: "mainnet",
      abi: erc1155ABI,
      address: "0x73da73ef3a6982109c4d5bdb0db9dd3e3783f313",
      startBlock: 12129118,
    },
  },
});
