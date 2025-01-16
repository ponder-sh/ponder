import { createConfig } from "ponder";
import { http, createPublicClient } from "viem";

import { weth9Abi } from "./abis/Weth9Abi";

const latestBlockBase = await createPublicClient({
  transport: http(process.env.PONDER_RPC_URL_8453),
}).getBlock();

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
      startBlock: Number(latestBlockBase.number),
    },
  },
});
