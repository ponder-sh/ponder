import { createConfig } from "@ponder/core";
import { http, createPublicClient } from "viem";

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
const latestBlockPolygon = await createPublicClient({
  transport: http(process.env.PONDER_RPC_URL_137),
}).getBlock();

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
      pollingInterval: 15_000,
    },
    base: {
      chainId: 8453,
      transport: http(process.env.PONDER_RPC_URL_8453),
      pollingInterval: 15_000,
    },
    optimism: {
      chainId: 10,
      transport: http(process.env.PONDER_RPC_URL_10),
      pollingInterval: 15_000,
    },
    polygon: {
      chainId: 137,
      transport: http(process.env.PONDER_RPC_URL_137),
      pollingInterval: 15_000,
    },
  },
  contracts: {
    weth9: {
      abi: weth9Abi,
      address: "0x4200000000000000000000000000000000000006",
      network: {
        mainnet: {
          address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          startBlock: Number(latestBlockMainnet.number),
        },
        base: {
          startBlock: Number(latestBlockBase.number),
        },
        optimism: {
          startBlock: Number(latestBlockOptimism.number),
        },
        polygon: {
          address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
          startBlock: Number(latestBlockPolygon.number),
        },
      },
    },
  },
});
