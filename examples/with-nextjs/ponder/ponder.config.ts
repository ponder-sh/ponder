import { createConfig } from "@ponder/core";
import { http, createPublicClient } from "viem";

import { Weth9Abi } from "./abis/Weth9Abi";

const transport = http(process.env.PONDER_RPC_URL_1);

const latestBlock = await createPublicClient({ transport }).getBlock();

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport,
    },
  },
  contracts: {
    WETH: {
      network: "mainnet",
      abi: Weth9Abi,
      address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      startBlock: Number(latestBlock) - 100,
      filter: {
        event: "Deposit",
      },
    },
  },
});
