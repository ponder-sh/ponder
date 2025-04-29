import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";

import { FactoryAbi } from "./abis/FactoryAbi";
import { PairAbi } from "./abis/PairAbi";

export default createConfig({
  chains: {
    mainnet: {
      id: 1,
      rpcUrl: process.env.PONDER_RPC_URL_1!,
    },
  },
  contracts: {
    Factory: {
      chain: "mainnet",
      abi: FactoryAbi,
      address: "0x5C69bee701ef814a2B6a3edd4b1652CB9cc5aA6f",
      startBlock: 18700000,
      endBlock: 18700500,
    },
    Pair: {
      chain: "mainnet",
      abi: PairAbi,
      address: factory({
        address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
        event: getAbiItem({ abi: FactoryAbi, name: "PairCreated" }),
        parameter: "pair",
      }),
      startBlock: 18700000,
      endBlock: 18700500,
    },
  },
});
