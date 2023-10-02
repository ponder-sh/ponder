import type { Config } from "@ponder/core";

import LlamaCoreAbi from "./abis/LlamaCore.json";
import LlamaFactoryAbi from "./abis/LlamaFactory.json";

export const config: Config = {
  networks: [
    {
      name: "sepolia",
      chainId: 1,
      rpcUrl: process.env.PONDER_RPC_URL_1,
    },
  ],
  factories: [{}],
};
