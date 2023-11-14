import { createConfig } from "@ponder/core";
import { erc721ABI } from "@wagmi/core";
import { http } from "viem";

export default createConfig({
  networks: {
    arbitrum: {
      chainId: 42161,
      transport: http(process.env.PONDER_RPC_URL_42161),
    },
  },
  contracts: {
    ERC721: {
      network: "arbitrum",
      abi: erc721ABI,
      address: "0x6325439389E0797Ab35752B4F43a14C004f22A9c",
      startBlock: 3163146,
    },
  },
});
