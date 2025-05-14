import { createConfig } from "ponder";
import { erc721Abi } from "viem";

export default createConfig({
  chains: {
    arbitrum: {
      id: 42161,
      rpc: process.env.PONDER_RPC_URL_42161,
    },
  },
  contracts: {
    ERC721: {
      chain: "arbitrum",
      abi: erc721Abi,
      address: "0x6325439389E0797Ab35752B4F43a14C004f22A9c",
      startBlock: 3163146,
      endBlock: 3200000,
    },
  },
});
