import { createConfig } from "@ponder/core";
import { getAbiItem, getAddress, http } from "viem";

import { FactoryAbi } from "./abis/FactoryAbi";
import { PairAbi } from "./abis/PairAbi";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
      maxRpcRequestConcurrency: 10,
    },
  },
  contracts: {
    Factory: {
      network: "mainnet",
      abi: FactoryAbi,
      address: getAddress("0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"),
      startBlock: 18700000,
    },
    Pair: {
      network: "mainnet",
      abi: PairAbi,
      factory: {
        address: getAddress("0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"),
        event: getAbiItem({ abi: FactoryAbi, name: "PairCreated" }),
        parameter: "pair",
      },
      startBlock: 18700000,
    },
  },
});
