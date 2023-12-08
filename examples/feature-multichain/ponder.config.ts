import { createConfig } from "@ponder/core";
import { createPublicClient, http } from "viem";

import { weth9Abi } from "./abis/weth9Abi";

const latestBlockMainnet = await createPublicClient({
  transport: http(process.env.PONDER_RPC_URL_1),
}).getBlock();
const latestBlockBase = await createPublicClient({
  transport: http(process.env.PONDER_RPC_URL_8453),
}).getBlock();
const latestBlockOptimism = await createPublicClient({
  transport: http(process.env.PONDER_RPC_URL_10),
}).getBlock();

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
    base: {
      chainId: 8453,
      transport: http(process.env.PONDER_RPC_URL_8453),
    },
    optimism: {
      chainId: 10,
      transport: http(process.env.PONDER_RPC_URL_10),
    },
  },
  contracts: {
    weth9: {
      abi: weth9Abi,
      address: "0x4200000000000000000000000000000000000006",
      network: {
        mainnet: {
          address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          startBlock: Number(latestBlockMainnet.number) - 50,
        },
        base: {
          startBlock: Number(latestBlockBase.number) - 50,
        },
        optimism: {
          startBlock: Number(latestBlockOptimism.number) - 50,
        },
      },
    },
  },
});
