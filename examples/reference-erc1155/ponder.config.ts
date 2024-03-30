import { createConfig } from "@ponder/core";
import { http } from "viem";
import { mainnet } from "viem/chains";
import { erc1155ABI } from "./abis/erc1155Abi";

export default createConfig({
  networks: {
    mainnet: {
      chain: mainnet,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
  },
  contracts: {
    ERC1155: {
      network: "mainnet",
      abi: erc1155ABI,
      address: "0x73da73ef3a6982109c4d5bdb0db9dd3e3783f313",
      startBlock: 12129118,
    },
  },
});
