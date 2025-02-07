import { createConfig } from "ponder";
import { http } from "viem";

import { weth9Abi } from "./abis/Weth9Abi";

export default createConfig({
  networks: {
    base: {
      chainId: 8453,
      transport: http(process.env.PONDER_RPC_URL_8453),
    },
  },
  contracts: {
    weth9: {
      abi: weth9Abi,
      network: "base",
      address: "0x4200000000000000000000000000000000000006",
      startBlock: "latest",
    },
  },
});
