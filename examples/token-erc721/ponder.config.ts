import { createConfig } from "@ponder/core";
import { http } from "viem";

import { SmolBrainAbi } from "./abis/SmolBrain.abi";

export default createConfig({
  networks: {
    arbitrum: {
      chainId: 42161,
      transport: http(process.env.PONDER_RPC_URL_42161),
    },
  },
  contracts: [
    {
      name: "SmolBrain",
      network: { arbitrum: {} },
      abi: SmolBrainAbi,
      address: "0x6325439389E0797Ab35752B4F43a14C004f22A9c",
      startBlock: 3163146,
    },
  ],
});
